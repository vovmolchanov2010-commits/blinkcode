import type pg from 'pg';
import { type Db, tx } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { Bus, GatheringChangeReason } from '../../realtime/bus.js';
import { distanceMeters, estimateEtaSec } from '../location/geo.js';
import type { StoredLocation } from '../location/privacy.js';
import { findUserById, isGhost, type PublicProfile, toPublicProfile } from '../users/repo.js';

export type Rsvp = 'pending' | 'going' | 'declined';
export const CHIPS = ['leaving', 'on_the_way', 'stuck', 'late', 'arrived'] as const;
export type Chip = (typeof CHIPS)[number];

/** Радиус геозоны прибытия. */
export const ARRIVAL_RADIUS_M = 100;
/** Ручной статус перекрывает авто-ETA на 15 минут. */
const MANUAL_PRIORITY_MS = 15 * 60_000;
/** «Опоздаю» без точного времени — на 10 минут. */
const LATE_DEFAULT_MS = 10 * 60_000;
/** Авто-ETA меньше чем на минуту не обновляем — меньше событий участникам. */
const ETA_MIN_CHANGE_MS = 60_000;
/** Авто-ETA и авто-«на месте» работают от 2 ч до начала до 3 ч после. */
const AUTO_WINDOW_BEFORE = '2 hours';
const ACTIVE_AFTER_START = '3 hours';
export const MAX_PARTICIPANTS = 30;

export interface ParticipantView {
  user: PublicProfile;
  rsvp: Rsvp;
  chip: Chip | null;
  comment: string | null;
  etaAt: string | null;
  etaSource: 'auto' | 'manual' | null;
  arrivedAt: string | null;
  updatedAt: string;
}

export interface GatheringView {
  id: string;
  ownerId: string;
  title: string;
  lat: number;
  lng: number;
  placeName: string | null;
  startsAt: string;
  /** ended — прошло 3 часа после начала. */
  status: 'active' | 'closed' | 'ended';
  participants: ParticipantView[];
}

interface GatheringRow {
  id: string;
  owner_id: string;
  title: string;
  lat: number;
  lng: number;
  place_name: string | null;
  starts_at: Date;
  status: 'active' | 'closed';
}

interface ParticipantRow {
  gathering_id: string;
  user_id: string;
  rsvp: Rsvp;
  chip: Chip | null;
  comment: string | null;
  eta_at: Date | null;
  eta_source: 'auto' | 'manual' | null;
  manual_until: Date | null;
  arrived_at: Date | null;
  updated_at: Date;
}

const ACTIVE_CONDITION = `g.status = 'active' AND g.starts_at > now() - interval '${ACTIVE_AFTER_START}'`;

export interface CreateGathering {
  title: string;
  lat: number;
  lng: number;
  placeName?: string;
  startsAt: Date;
  participantIds: string[];
}

export interface UpdateGathering {
  title?: string;
  lat?: number;
  lng?: number;
  placeName?: string | null;
  startsAt?: Date;
}

export interface MyStatus {
  rsvp?: Rsvp;
  chip?: Chip | null;
  comment?: string | null;
  /** «Буду через N минут». */
  etaMinutes?: number;
}

export class GatheringService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly bus: Bus,
  ) {}

  async create(ownerId: string, input: CreateGathering): Promise<GatheringView> {
    const invitees = [...new Set(input.participantIds)].filter((id) => id !== ownerId);
    if (invitees.length + 1 > MAX_PARTICIPANTS) throw new HttpError(400, 'too_many_participants');

    const id = await tx(this.pool, async (db) => {
      // Звать можно только друзей.
      const { rowCount } = await db.query(
        'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = ANY($2::uuid[])',
        [ownerId, invitees],
      );
      if ((rowCount ?? 0) !== invitees.length) throw new HttpError(400, 'not_friends');

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO gatherings (owner_id, title, lat, lng, place_name, starts_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ownerId, input.title, input.lat, input.lng, input.placeName ?? null, input.startsAt],
      );
      const gatheringId = rows[0]!.id;
      await db.query(
        `INSERT INTO gathering_participants (gathering_id, user_id, rsvp)
         SELECT $1, u, CASE WHEN u = $2 THEN 'going'::gathering_rsvp ELSE 'pending'::gathering_rsvp END
         FROM unnest($3::uuid[]) AS u`,
        [gatheringId, ownerId, [ownerId, ...invitees]],
      );
      return gatheringId;
    });

    await Promise.all(
      invitees.map((userId) => this.bus.publish(userId, { type: 'gathering.updated', gatheringId: id, reason: 'invited' })),
    );
    return (await this.get(id, ownerId))!;
  }

  /** Сбор глазами участника; null — сбора нет или пользователь в нём не участвует. */
  async get(id: string, userId: string): Promise<GatheringView | null> {
    const { rows } = await this.pool.query<GatheringRow>(
      `SELECT g.* FROM gatherings g
       JOIN gathering_participants p ON p.gathering_id = g.id AND p.user_id = $2
       WHERE g.id = $1`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) return null;
    return (await this.withParticipants([row]))[0]!;
  }

  /** Активные сборы пользователя: ближайшие сначала. */
  async listActive(userId: string): Promise<GatheringView[]> {
    const { rows } = await this.pool.query<GatheringRow>(
      `SELECT g.* FROM gatherings g
       JOIN gathering_participants p ON p.gathering_id = g.id AND p.user_id = $1
       WHERE ${ACTIVE_CONDITION} AND p.rsvp <> 'declined'
       ORDER BY g.starts_at`,
      [userId],
    );
    return this.withParticipants(rows);
  }

  async update(id: string, userId: string, patch: UpdateGathering): Promise<GatheringView> {
    const before = await this.requireOwned(id, userId);
    await this.pool.query(
      `UPDATE gatherings SET
         title = COALESCE($2, title),
         lat = COALESCE($3, lat),
         lng = COALESCE($4, lng),
         place_name = CASE WHEN $5::boolean THEN $6 ELSE place_name END,
         starts_at = COALESCE($7, starts_at),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        patch.title ?? null,
        patch.lat ?? null,
        patch.lng ?? null,
        patch.placeName !== undefined,
        patch.placeName ?? null,
        patch.startsAt ?? null,
      ],
    );

    const timeChanged = patch.startsAt !== undefined && patch.startsAt.getTime() !== before.starts_at.getTime();
    const placeChanged =
      (patch.lat !== undefined && patch.lat !== before.lat) || (patch.lng !== undefined && patch.lng !== before.lng);
    await this.notify(id, {
      reason: 'changed',
      ...(timeChanged && { startsAtFrom: before.starts_at.toISOString(), startsAtTo: patch.startsAt!.toISOString() }),
      ...(placeChanged && { placeChanged: true }),
    }, userId);
    return (await this.get(id, userId))!;
  }

  async close(id: string, userId: string): Promise<GatheringView> {
    await this.requireOwned(id, userId);
    await this.pool.query(`UPDATE gatherings SET status = 'closed', updated_at = now() WHERE id = $1`, [id]);
    await this.notify(id, { reason: 'closed' }, userId);
    return (await this.get(id, userId))!;
  }

  /** Ответ участника: иду / не смогу, быстрый статус, комментарий, «буду через N минут». */
  async setMyStatus(id: string, userId: string, input: MyStatus, now = new Date()): Promise<GatheringView> {
    await tx(this.pool, async (db) => {
      const { rows } = await db.query<ParticipantRow & { starts_at: Date; status: string }>(
        `SELECT p.*, g.starts_at, g.status FROM gathering_participants p
         JOIN gatherings g ON g.id = p.gathering_id
         WHERE p.gathering_id = $1 AND p.user_id = $2 FOR UPDATE OF p`,
        [id, userId],
      );
      const current = rows[0];
      if (!current) throw new HttpError(404, 'gathering_not_found');
      if (current.status === 'closed') throw new HttpError(409, 'gathering_closed');

      const next = applyStatus(current, current.starts_at, input, now);
      await db.query(
        `UPDATE gathering_participants SET
           rsvp = $3, chip = $4, comment = $5, eta_at = $6, eta_source = $7,
           manual_until = $8, arrived_at = $9, updated_at = now()
         WHERE gathering_id = $1 AND user_id = $2`,
        [id, userId, next.rsvp, next.chip, next.comment, next.eta_at, next.eta_source, next.manual_until, next.arrived_at],
      );
    });

    await this.notify(id, { reason: 'status' }, userId);
    return (await this.get(id, userId))!;
  }

  /**
   * Новая позиция участника: авто-«на месте» в радиусе 100 м и авто-ETA.
   * Пока точного провайдера маршрутов нет, ETA — оценка по прямой (см. estimateEtaSec).
   */
  async handleLocation(userId: string, location: StoredLocation, now = new Date()): Promise<void> {
    const { rows } = await this.pool.query<GatheringRow & ParticipantRow>(
      `SELECT g.id, g.lat, g.lng, g.starts_at, p.eta_at, p.eta_source, p.manual_until
       FROM gathering_participants p JOIN gatherings g ON g.id = p.gathering_id
       WHERE p.user_id = $1 AND p.rsvp = 'going' AND p.arrived_at IS NULL
         AND ${ACTIVE_CONDITION} AND g.starts_at < now() + interval '${AUTO_WINDOW_BEFORE}'`,
      [userId],
    );
    if (rows.length === 0) return;
    // В режиме «призрака» не раскрываем даже расстояние до места сбора.
    const user = await findUserById(this.pool, userId);
    if (!user || isGhost(user, now)) return;

    for (const row of rows) {
      const distance = distanceMeters(row, location);
      if (distance <= ARRIVAL_RADIUS_M) {
        await this.pool.query(
          `UPDATE gathering_participants SET
             arrived_at = now(), chip = 'arrived', eta_at = NULL, eta_source = NULL, updated_at = now()
           WHERE gathering_id = $1 AND user_id = $2`,
          [row.id, userId],
        );
        await this.notify(row.id, { reason: 'arrived', userId });
        continue;
      }

      if (row.manual_until && row.manual_until > now) continue;
      const eta = new Date(now.getTime() + estimateEtaSec(distance, location.speed) * 1000);
      if (
        row.eta_source === 'auto' &&
        row.eta_at &&
        Math.abs(row.eta_at.getTime() - eta.getTime()) < ETA_MIN_CHANGE_MS
      ) {
        continue;
      }
      await this.pool.query(
        `UPDATE gathering_participants SET eta_at = $3, eta_source = 'auto', updated_at = now()
         WHERE gathering_id = $1 AND user_id = $2`,
        [row.id, userId, eta],
      );
      await this.notify(row.id, { reason: 'status' });
    }
  }

  private async requireOwned(id: string, userId: string): Promise<GatheringRow> {
    const { rows } = await this.pool.query<GatheringRow>('SELECT * FROM gatherings WHERE id = $1', [id]);
    const row = rows[0];
    if (!row) throw new HttpError(404, 'gathering_not_found');
    if (row.owner_id !== userId) {
      const isParticipant = await participantIds(this.pool, id).then((ids) => ids.includes(userId));
      throw isParticipant ? new HttpError(403, 'not_owner') : new HttpError(404, 'gathering_not_found');
    }
    if (row.status === 'closed') throw new HttpError(409, 'gathering_closed');
    return row;
  }

  /** Событие всем участникам, кроме отказавшихся (и автора изменения — у него ответ на запрос). */
  private async notify(
    gatheringId: string,
    details: { reason: GatheringChangeReason; userId?: string; startsAtFrom?: string; startsAtTo?: string; placeChanged?: boolean },
    exceptUserId?: string,
  ): Promise<void> {
    const ids = await participantIds(this.pool, gatheringId, { includeDeclined: false });
    await Promise.all(
      ids
        .filter((id) => id !== exceptUserId)
        .map((id) => this.bus.publish(id, { type: 'gathering.updated', gatheringId, ...details })),
    );
  }

  private async withParticipants(gatherings: GatheringRow[]): Promise<GatheringView[]> {
    if (gatherings.length === 0) return [];
    const { rows } = await this.pool.query<
      ParticipantRow & { id: string; username: string | null; display_name: string | null; avatar_url: string | null }
    >(
      `SELECT p.*, u.id, u.username, u.display_name, u.avatar_url
       FROM gathering_participants p JOIN users u ON u.id = p.user_id
       WHERE p.gathering_id = ANY($1::uuid[])
       ORDER BY p.arrived_at NULLS LAST, p.eta_at NULLS LAST, lower(coalesce(u.display_name, u.username, ''))`,
      [gatherings.map((g) => g.id)],
    );
    const now = Date.now();
    return gatherings.map((g) => ({
      id: g.id,
      ownerId: g.owner_id,
      title: g.title,
      lat: g.lat,
      lng: g.lng,
      placeName: g.place_name,
      startsAt: g.starts_at.toISOString(),
      status:
        g.status === 'closed' ? 'closed' : g.starts_at.getTime() + 3 * 3_600_000 < now ? 'ended' : 'active',
      participants: rows
        .filter((p) => p.gathering_id === g.id)
        .map((p) => ({
          user: toPublicProfile(p),
          rsvp: p.rsvp,
          chip: p.chip,
          comment: p.comment,
          etaAt: p.eta_at?.toISOString() ?? null,
          etaSource: p.eta_source,
          arrivedAt: p.arrived_at?.toISOString() ?? null,
          updatedAt: p.updated_at.toISOString(),
        })),
    }));
  }
}

async function participantIds(db: Db, gatheringId: string, { includeDeclined = true } = {}): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM gathering_participants WHERE gathering_id = $1 ${includeDeclined ? '' : `AND rsvp <> 'declined'`}`,
    [gatheringId],
  );
  return rows.map((r) => r.user_id);
}

type StatusFields = Pick<
  ParticipantRow,
  'rsvp' | 'chip' | 'comment' | 'eta_at' | 'eta_source' | 'manual_until' | 'arrived_at'
>;

/** Новое состояние участника после его ответа. Чистая функция — проверяется в тестах. */
export function applyStatus(current: StatusFields, startsAt: Date, input: MyStatus, now: Date): StatusFields {
  const next: StatusFields = { ...current };
  if (input.comment !== undefined) next.comment = input.comment;
  if (input.rsvp !== undefined) next.rsvp = input.rsvp;

  if (next.rsvp === 'declined') {
    return { ...next, chip: null, eta_at: null, eta_source: null, manual_until: null, arrived_at: null };
  }

  const manualUntil = new Date(now.getTime() + MANUAL_PRIORITY_MS);
  if (input.chip !== undefined) {
    // Статус означает, что человек идёт.
    if (input.chip !== null) next.rsvp = 'going';
    next.chip = input.chip;
    if (input.chip === 'arrived') {
      Object.assign(next, { arrived_at: now, eta_at: null, eta_source: null, manual_until: null });
    } else {
      // Любой другой статус снимает «на месте» (ручная отмена авто-прибытия).
      next.arrived_at = null;
      next.manual_until = manualUntil;
      if (input.chip === 'late' && input.etaMinutes === undefined) {
        const base = Math.max(startsAt.getTime(), current.eta_at?.getTime() ?? 0);
        Object.assign(next, { eta_at: new Date(base + LATE_DEFAULT_MS), eta_source: 'manual' });
      }
    }
  }
  if (input.etaMinutes !== undefined) {
    Object.assign(next, {
      rsvp: 'going',
      eta_at: new Date(now.getTime() + input.etaMinutes * 60_000),
      eta_source: 'manual',
      manual_until: manualUntil,
      arrived_at: null,
    });
  }
  return next;
}
