import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import type pg from 'pg';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import type { SmsSender } from '../src/modules/auth/otp.js';

export class FakeSms implements SmsSender {
  readonly sent: { phone: string; text: string }[] = [];

  async send(phone: string, text: string): Promise<void> {
    this.sent.push({ phone, text });
  }

  lastCode(phone: string): string {
    const message = this.sent.findLast((m) => m.phone === phone);
    const code = message?.text.match(/\d{6}/)?.[0];
    if (!code) throw new Error(`no OTP sent to ${phone}`);
    return code;
  }
}

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  redis: Redis;
  sms: FakeSms;
  close(): Promise<void>;
}

/**
 * Приложение на реальных Postgres и Redis. Адреса — из TEST_DATABASE_URL и
 * TEST_REDIS_URL (по умолчанию — docker-compose из корня репозитория).
 */
export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://blink:blink@localhost:5432/blink_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  });
  const pool = createPool(config.DATABASE_URL);
  await migrate(pool);
  await pool.query('TRUNCATE users, refresh_tokens, friendships, friend_requests, blocks CASCADE');

  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();

  const sms = new FakeSms();
  const app = await buildApp({ config, pool, redis, sms, logger: false });
  await app.ready();

  return {
    app,
    pool,
    redis,
    sms,
    async close() {
      await app.close();
      await pool.end();
      redis.disconnect();
    },
  };
}

// Уникальные номера в пределах прогона: лимиты OTP привязаны к номеру.
const runId = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
let phoneCounter = 0;

export interface TestUser {
  id: string;
  phone: string;
  accessToken: string;
  refreshToken: string;
  headers: { authorization: string };
}

export async function signUp(ctx: TestContext, username?: string): Promise<TestUser> {
  const phone = `+7998${runId}${String(phoneCounter++).padStart(3, '0')}`;
  await ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, code: ctx.sms.lastCode(phone) },
  });
  if (res.statusCode !== 200) throw new Error(`sign up failed: ${res.body}`);
  const body = res.json();
  const headers = { authorization: `Bearer ${body.accessToken}` };

  if (username) {
    await ctx.app.inject({ method: 'PATCH', url: '/v1/me', headers, payload: { username } });
  }
  return { id: body.user.id, phone, accessToken: body.accessToken, refreshToken: body.refreshToken, headers };
}

export async function befriend(ctx: TestContext, a: TestUser, b: TestUser): Promise<void> {
  await ctx.app.inject({
    method: 'POST',
    url: '/v1/friends/requests',
    headers: a.headers,
    payload: { userId: b.id },
  });
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/friends/requests/${a.id}/accept`,
    headers: b.headers,
  });
  if (res.statusCode !== 200) throw new Error(`befriend failed: ${res.body}`);
}

export const MOSCOW = { lat: 55.7558, lng: 37.6173 };

export function point(offset: { lat?: number; lng?: number; ts?: number } = {}) {
  return {
    lat: MOSCOW.lat + (offset.lat ?? 0),
    lng: MOSCOW.lng + (offset.lng ?? 0),
    accuracy: 10,
    speed: 1.2,
    heading: 90,
    battery: 80,
    ts: offset.ts ?? Date.now(),
  };
}

/** WebSocket-клиент, который складывает входящие сообщения в очередь. */
export async function connectWs(baseUrl: string, token: string) {
  const ws = new WebSocket(`${baseUrl}/v1/ws?token=${encodeURIComponent(token)}`);
  const queue: Record<string, unknown>[] = [];
  const waiters: { match: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    const i = waiters.findIndex((w) => w.match(message));
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(message);
    else queue.push(message);
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return {
    ws,
    send: (message: object) => ws.send(JSON.stringify(message)),
    next(match: (m: Record<string, unknown>) => boolean, timeoutMs = 3000) {
      const i = queue.findIndex(match);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]!);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) {
            waiters.splice(j, 1);
            reject(new Error('timed out waiting for websocket message'));
          }
        }, timeoutMs);
      });
    },
    /** Сообщения, полученные и ещё не разобранные через next(). */
    pending: () => [...queue],
    close: () =>
      new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}
