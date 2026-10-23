import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  befriend,
  connectWs,
  createTestContext,
  point,
  signUp,
  type TestContext,
  type TestUser,
} from './helpers.js';

let ctx: TestContext;
let baseUrl: string;

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = (await ctx.app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws');
});

afterAll(async () => {
  await ctx.close();
});

const inject = (user: TestUser, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.headers, payload });

const tokenFrom = (url: string) => url.split('/s/')[1]!;

async function prepared() {
  const user = await signUp(ctx);
  const friend = await signUp(ctx);
  await befriend(ctx, user, friend);
  await inject(user, 'PUT', '/v1/sos/contacts', {
    contacts: [{ userId: friend.id }, { phone: '+79990001122', name: 'Мама' }],
  });
  expect((await inject(user, 'PUT', '/v1/sos/pin', { pin: '1234' })).statusCode).toBe(204);
  return { user, friend };
}

describe('SOS', () => {
  it('requires a PIN and at least one contact', async () => {
    const user = await signUp(ctx);
    expect((await inject(user, 'POST', '/v1/sos', {})).json().error).toBe('pin_required');
    await inject(user, 'PUT', '/v1/sos/pin', { pin: '1234' });
    expect((await inject(user, 'POST', '/v1/sos', {})).json().error).toBe('no_contacts');

    // Сменить PIN можно только зная текущий.
    expect((await inject(user, 'PUT', '/v1/sos/pin', { pin: '5678' })).statusCode).toBe(403);
    expect((await inject(user, 'PUT', '/v1/sos/pin', { pin: '5678', currentPin: '1234' })).statusCode).toBe(204);
  });

  it('accepts only friends and up to 3 contacts', async () => {
    const user = await signUp(ctx);
    const stranger = await signUp(ctx);
    let res = await inject(user, 'PUT', '/v1/sos/contacts', { contacts: [{ userId: stranger.id }] });
    expect(res.json().error).toBe('not_friends');
    const phone = (n: number) => ({ phone: `+7999000000${n}`, name: `C${n}` });
    res = await inject(user, 'PUT', '/v1/sos/contacts', { contacts: [1, 2, 3, 4].map(phone) });
    expect(res.statusCode).toBe(400);
  });

  it('sends SMS with a live link, streams the track and cancels only with the PIN', async () => {
    const { user, friend } = await prepared();
    const ws = await connectWs(baseUrl, friend.accessToken);
    await ws.next((m) => m.type === 'snapshot');
    await inject(user, 'POST', '/v1/location', { points: [point()] });

    const res = await inject(user, 'POST', '/v1/sos', {});
    expect(res.statusCode).toBe(201);
    const { url, smsFailed } = res.json();
    expect(smsFailed).toBe(0);
    expect(url).toMatch(/\/s\/[\w-]{32}$/);

    const sms = ctx.sms.sent.filter((m) => m.text.includes(url));
    expect(sms.map((m) => m.phone).sort()).toEqual(['+79990001122', friend.phone].sort());
    expect(await ws.next((m) => m.type === 'sos.started')).toMatchObject({ userId: user.id, url, isTest: false });
    expect((await inject(user, 'POST', '/v1/sos', {})).json().error).toBe('sos_already_active');

    await inject(user, 'POST', '/v1/location', { points: [point({ lat: 0.001, ts: Date.now() + 1000 })] });
    const page = await ctx.app.inject({ method: 'GET', url: `/s/${tokenFrom(url)}` });
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['x-robots-tag']).toContain('noindex');
    const data = (await ctx.app.inject({ method: 'GET', url: `/s/${tokenFrom(url)}/data` })).json();
    expect(data).toMatchObject({ status: 'active', isTest: false, cancelled: false });
    expect(data.points).toHaveLength(2);

    expect((await inject(user, 'POST', '/v1/sos/cancel', { pin: '0000' })).statusCode).toBe(403);
    expect((await inject(user, 'POST', '/v1/sos/cancel', { pin: '1234' })).statusCode).toBe(204);
    await ws.next((m) => m.type === 'sos.ended');
    expect(ctx.sms.sent.at(-1)?.text).toContain('отменил');

    const ended = (await ctx.app.inject({ method: 'GET', url: `/s/${tokenFrom(url)}/data` })).json();
    expect(ended).toMatchObject({ status: 'ended', cancelled: true });
    await ws.close();
  });

  it('marks test mode, extends the session and limits PIN attempts', async () => {
    const { user } = await prepared();
    const { url, session } = (await inject(user, 'POST', '/v1/sos', { test: true })).json();
    expect(ctx.sms.sent.at(-1)?.text).toMatch(/^ТЕСТ\./);

    const extended = (await inject(user, 'POST', '/v1/sos/extend')).json();
    expect(Date.parse(extended.expiresAt) - Date.parse(session.expiresAt)).toBeGreaterThan(14 * 60_000);

    for (let i = 0; i < 5; i++) await inject(user, 'POST', '/v1/sos/cancel', { pin: '9999' });
    const blocked = await inject(user, 'POST', '/v1/sos/cancel', { pin: '1234' });
    expect(blocked.statusCode).toBe(429);
    expect((await ctx.app.inject({ method: 'GET', url: `/s/${tokenFrom(url)}/data` })).json().status).toBe('active');
  });

  it('returns 404 for unknown and expired links', async () => {
    const { user } = await prepared();
    const { url, session } = (await inject(user, 'POST', '/v1/sos', {})).json();
    expect((await ctx.app.inject({ method: 'GET', url: '/s/unknown-token-unknown-token/data' })).statusCode).toBe(404);

    await ctx.pool.query(
      `UPDATE sos_sessions SET started_at = now() - interval '3 hours', expires_at = now() - interval '2 hours' WHERE id = $1`,
      [session.id],
    );
    expect((await ctx.app.inject({ method: 'GET', url: `/s/${tokenFrom(url)}/data` })).statusCode).toBe(404);
  });
});
