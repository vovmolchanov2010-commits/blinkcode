import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { tx } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { Bus } from '../../realtime/bus.js';
import type { SmsSender } from '../auth/otp.js';
import type { StoredLocation } from '../location/privacy.js';
import type { LocationService } from '../location/service.js';
import { findUserById, type PublicProfile, toPublicProfile } from '../users/repo.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const MAX_CONTACTS = 3;
/** Трансляция длится 15 минут, продление — ещё на 15. */
export const SOS_DURATION_MS = 15 * 60_000;
/** Дольше 4 часов одна трансляция не живёт даже с продлениями. */
const SOS_MAX_TOTAL_MS = 4 * 60 * 60_000;
/** Ссылка показывает данные ещё час после окончания, затем — «Трансляция завершена». */
export const LINK_GRACE_MS = 60 * 60_000;
/** Трек удаляется через 30 дней. */
const RETENTION_DAYS = 30;
const MAX_PIN_ATTEMPTS = 5;
const PUBLIC_POINTS_LIMIT = 500;

export type ContactInput = { userId: string } | { phone: string; name: string };

export interface ContactView {
  position: number;
  /** Друг в приложении (получает событие в приложении и SMS). */
  user: PublicProfile | null;
  /** Контакт без приложения (только SMS). */
  phone: string | null;
  name: string | null;
}

export interface SosSessionView {
  id: string;
  isTest: boolean;
  startedAt: string;
  expiresAt: string;
}

export interface PublicSosView {
  status: 'active' | 'ended';
  name: string;
  isTest: boolean;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  cancelled: boolean;
  points: { ts: number; lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; battery: number | null }[];
}

interface SessionRow {
  id: string;
  user_id: string;
  is_test: boolean;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = await scryptAsync(pin, Buffer.from(saltHex, 'hex'), 32);
  return timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

/**
 * SOS (фича 7): до 3 доверенных контактов, SMS со ссылкой на live-трансляцию на 15 минут,
 * отмена только по PIN. Не заменяет 112 — это повторяется в SMS и на странице.
 */
export class SosService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly redis: Redis,
    private readonly bus: Bus,
    private readonly sms: SmsSender,
    private readonly location: LocationService,
    private readonly log: { error: (obj: object, msg: string) => void },
  ) {}

  async contacts(userId: string): Promise<ContactView[]> {
    const { rows } = await this.pool.query<{
      position: number;
      phone: string | null;
      name: string | null;
      id: string | null;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT c.position, c.phone, c.name, u.id, u.username, u.display_name, u.avatar_url
       FROM trusted_contacts c LEFT JOIN users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1 ORDER BY c.position`,
      [userId],
    );
    return rows.map((r) => ({
      position: r.position,
      user: r.id ? toPublicProfile({ ...r, id: r.id }) : null,
      phone: r.phone,
      name: r.name,
    }));
  }

  /** Заменяет список контактов целиком. Друзья — из приложения, остальные — по номеру. */
  async setContacts(userId: string, contacts: ContactInput[]): Promise<ContactView[]> {
    if (contacts.length > MAX_CONTACTS) throw new HttpError(400, 'too_many_contacts');
    await tx(this.pool, async (db) => {
      const friendIds = contacts.flatMap((c) => ('userId' in c ? [c.userId] : []));
      if (new Set(friendIds).size !== friendIds.length) throw new HttpError(400, 'duplicate_contact');
      const { rowCount } = await db.query(
        'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = ANY($2::uuid[])',
        [userId, friendIds],
      );
      if ((rowCount ?? 0) !== friendIds.length) throw new HttpError(400, 'not_friends');

      await db.query('DELETE FROM trusted_contacts WHERE user_id = $1', [userId]);
      for (const [i, contact] of contacts.entries()) {
        await db.query(
          `INSERT INTO trusted_contacts (user_id, position, contact_user_id, phone, name)
           VALUES ($1, $2, $3, $4, $5)`,
          'userId' in contact
            ? [userId, i + 1, contact.userId, null, null]
            : [userId, i + 1, null, contact.phone, contact.name],
        );
      }
    });
    return this.contacts(userId);
  }

  /** PIN для отмены SOS. Сменить можно, только зная текущий. */
  async setPin(userId: string, pin: string, currentPin?: string): Promise<void> {
    const stored = await this.pinHash(userId);
    if (stored && !(currentPin && (await verifyPin(currentPin, stored)))) {
      throw new HttpError(403, 'wrong_pin');
    }
    await this.pool.query('UPDATE users SET sos_pin_hash = $2, updated_at = now() WHERE id = $1', [
      userId,
      await hashPin(pin),
    ]);
  }

  async status(userId: string): Promise<{ hasPin: boolean; contacts: ContactView[]; active: SosSessionView | null }> {
    const [stored, contacts, active] = await Promise.all([
      this.pinHash(userId),
      this.contacts(userId),
      this.activeSession(userId),
    ]);
    return { hasPin: stored !== null, contacts, active: active && toSessionView(active) };
  }

  /** Запускает трансляцию и рассылает ссылку контактам. Ссылка возвращается только здесь. */
  async start(
    userId: string,
    { test, baseUrl }: { test: boolean; baseUrl: string },
  ): Promise<{ session: SosSessionView; url: string; smsFailed: number }> {
    const user = await findUserById(this.pool, userId);
    if (!user) throw new HttpError(401, 'unauthorized');
    if (!(await this.pinHash(userId))) throw new HttpError(409, 'pin_required');
    const contacts = await this.contacts(userId);
    if (contacts.length === 0) throw new HttpError(409, 'no_contacts');
    if (await this.activeSession(userId)) throw new HttpError(409, 'sos_already_active');

    const token = randomBytes(24).toString('base64url');
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO sos_sessions (user_id, token_hash, is_test, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond') RETURNING *`,
      [userId, hashToken(token), test, SOS_DURATION_MS],
    );
    const session = rows[0]!;
    // Последняя известная точка — сразу, чтобы страница не была пустой до следующего GPS-замера.
    const last = await this.location.getLocation(userId);
    if (last) await this.insertPoint(session.id, last);

    const url = `${baseUrl}/s/${token}`;
    const name = user.display_name ?? (user.username ? `@${user.username}` : user.phone);
    const text = test
      ? `ТЕСТ. ${name} проверяет SOS в Blink. Ссылка на трансляцию: ${url}`
      : `${name} нажал(а) SOS в Blink. Где сейчас: ${url} Если нужна помощь — звоните 112.`;
    const smsFailed = await this.notifyContacts(contacts, text);

    await Promise.all(
      contacts
        .filter((c) => c.user)
        .map((c) =>
          this.bus.publish(c.user!.id, { type: 'sos.started', sessionId: session.id, userId, url, isTest: test }),
        ),
    );
    return { session: toSessionView(session), url, smsFailed };
  }

  async extend(userId: string): Promise<SosSessionView> {
    const { rows } = await this.pool.query<SessionRow>(
      `UPDATE sos_sessions SET expires_at = LEAST(
         GREATEST(expires_at, now()) + $2 * interval '1 millisecond',
         started_at + $3 * interval '1 millisecond')
       WHERE user_id = $1 AND ended_at IS NULL AND expires_at > now()
       RETURNING *`,
      [userId, SOS_DURATION_MS, SOS_MAX_TOTAL_MS],
    );
    if (!rows[0]) throw new HttpError(404, 'sos_not_active');
    return toSessionView(rows[0]);
  }

  /** Отмена только по PIN: злоумышленник не может «просто нажать отмену». */
  async cancel(userId: string, pin: string): Promise<void> {
    const session = await this.activeSession(userId);
    if (!session) throw new HttpError(404, 'sos_not_active');

    const attemptsKey = `sos:pin:${session.id}`;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, Math.ceil(SOS_MAX_TOTAL_MS / 1000));
    if (attempts > MAX_PIN_ATTEMPTS) throw new HttpError(429, 'too_many_attempts');

    const stored = await this.pinHash(userId);
    if (!stored || !(await verifyPin(pin, stored))) throw new HttpError(403, 'wrong_pin');

    await this.pool.query(
      `UPDATE sos_sessions SET ended_at = now(), end_reason = 'cancelled' WHERE id = $1`,
      [session.id],
    );
    const user = await findUserById(this.pool, userId);
    const name = user?.display_name ?? (user?.username ? `@${user.username}` : 'Пользователь');
    const contacts = await this.contacts(userId);
    await this.notifyContacts(contacts, `${session.is_test ? 'ТЕСТ. ' : ''}${name} отменил(а) SOS в Blink.`);
    await Promise.all(
      contacts
        .filter((c) => c.user)
        .map((c) => this.bus.publish(c.user!.id, { type: 'sos.ended', sessionId: session.id, userId })),
    );
  }

  /** Слушатель новых позиций: пока идёт SOS, пишем трек (даже в режиме «призрака»). */
  async handleLocation(userId: string, location: StoredLocation): Promise<void> {
    const session = await this.activeSession(userId);
    if (session) await this.insertPoint(session.id, location);
  }

  /** Данные для страницы по ссылке; null — ссылки нет или её срок вышел. */
  async publicView(token: string, now = new Date()): Promise<PublicSosView | null> {
    const { rows } = await this.pool.query<SessionRow & { display_name: string | null; username: string | null }>(
      `SELECT s.*, u.display_name, u.username FROM sos_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [hashToken(token)],
    );
    const session = rows[0];
    if (!session) return null;
    const end = session.ended_at && session.ended_at < session.expires_at ? session.ended_at : session.expires_at;
    if (end.getTime() + LINK_GRACE_MS < now.getTime()) return null;

    const points = await this.pool.query<{
      ts: Date;
      lat: number;
      lng: number;
      accuracy: number | null;
      speed: number | null;
      heading: number | null;
      battery: number | null;
    }>(
      `SELECT * FROM (
         SELECT ts, lat, lng, accuracy, speed, heading, battery FROM sos_points
         WHERE session_id = $1 ORDER BY ts DESC LIMIT $2
       ) p ORDER BY ts`,
      [session.id, PUBLIC_POINTS_LIMIT],
    );
    const active = session.ended_at === null && session.expires_at > now;
    return {
      status: active ? 'active' : 'ended',
      name: session.display_name ?? (session.username ? `@${session.username}` : 'Пользователь Blink'),
      isTest: session.is_test,
      startedAt: session.started_at.toISOString(),
      expiresAt: session.expires_at.toISOString(),
      endedAt: active ? null : end.toISOString(),
      cancelled: session.end_reason === 'cancelled',
      points: points.rows.map((p) => ({ ...p, ts: p.ts.getTime() })),
    };
  }

  /** Удаляет сессии и треки старше 30 дней. */
  async purgeOld(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM sos_sessions WHERE started_at < now() - interval '${RETENTION_DAYS} days'`,
    );
    return rowCount ?? 0;
  }

  private async activeSession(userId: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM sos_sessions WHERE user_id = $1 AND ended_at IS NULL AND expires_at > now()
       ORDER BY started_at DESC LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  private async pinHash(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ sos_pin_hash: string | null }>(
      'SELECT sos_pin_hash FROM users WHERE id = $1',
      [userId],
    );
    return rows[0]?.sos_pin_hash ?? null;
  }

  private async insertPoint(sessionId: string, p: StoredLocation): Promise<void> {
    await this.pool.query(
      `INSERT INTO sos_points (session_id, ts, lat, lng, accuracy, speed, heading, battery)
       VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8)`,
      [sessionId, p.ts, p.lat, p.lng, p.accuracy ?? null, p.speed ?? null, p.heading ?? null, p.battery ?? null],
    );
  }

  /** SMS всем контактам (друзьям — на их номер в Blink). Возвращает число неудачных отправок. */
  private async notifyContacts(contacts: ContactView[], text: string): Promise<number> {
    const userIds = contacts.flatMap((c) => (c.user ? [c.user.id] : []));
    const { rows } = await this.pool.query<{ phone: string }>('SELECT phone FROM users WHERE id = ANY($1::uuid[])', [
      userIds,
    ]);
    const phones = [...contacts.flatMap((c) => (c.phone ? [c.phone] : [])), ...rows.map((r) => r.phone)];
    const results = await Promise.allSettled(phones.map((phone) => this.sms.send(phone, text)));
    const failed = results.filter((r) => r.status === 'rejected');
    for (const r of failed) this.log.error({ err: (r as PromiseRejectedResult).reason }, 'SOS SMS failed');
    return failed.length;
  }
}

function toSessionView(row: SessionRow): SosSessionView {
  return {
    id: row.id,
    isTest: row.is_test,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}
