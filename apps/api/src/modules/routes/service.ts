import type pg from 'pg';
import { HttpError } from '../../errors.js';
import type { Bus } from '../../realtime/bus.js';
import type { LocationService } from '../location/service.js';
import { type PublicProfile, toPublicProfile } from '../users/repo.js';

export type RouteMode = 'walk' | 'drive';

/** Сессия маршрута гарантированно закрывается через час. */
export const ROUTE_TTL_MS = 60 * 60_000;

export interface RouteView {
  id: string;
  requester: PublicProfile;
  target: PublicProfile;
  mode: RouteMode;
  etaAt: string | null;
  distanceM: number | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: 'arrived' | 'stopped' | null;
}

interface RouteRow {
  id: string;
  requester_id: string;
  target_id: string;
  mode: RouteMode;
  eta_at: Date | null;
  distance_m: number | null;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: 'arrived' | 'stopped' | null;
}

const PROFILE = (alias: string, prefix: string) =>
  `${alias}.id AS ${prefix}_id, ${alias}.username AS ${prefix}_username, ` +
  `${alias}.display_name AS ${prefix}_display_name, ${alias}.avatar_url AS ${prefix}_avatar_url`;

const SELECT_VIEW = `
  SELECT r.*, ${PROFILE('rq', 'rq')}, ${PROFILE('tg', 'tg')}
  FROM route_sessions r
  JOIN users rq ON rq.id = r.requester_id
  JOIN users tg ON tg.id = r.target_id`;

const ACTIVE = 'r.ended_at IS NULL AND r.expires_at > now()';

/**
 * «Дойти до друга» (фича 1). Маршрут и ETA считает устройство идущего; сервер
 * хранит сессию, чтобы друг видел, кто к нему идёт, и мог остановить это одним тапом.
 */
export class RouteService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly bus: Bus,
    private readonly location: LocationService,
  ) {}

  async start(requesterId: string, targetId: string, mode: RouteMode): Promise<RouteView> {
    if (requesterId === targetId) throw new HttpError(400, 'cannot_route_to_self');
    // Только к другу, который показывает тебе свою геолокацию (точно или примерно).
    if (!(await this.location.visibleLocationOf(targetId, requesterId))) {
      throw new HttpError(409, 'target_location_hidden');
    }

    await this.pool.query(
      `UPDATE route_sessions r SET ended_at = now(), end_reason = 'stopped'
       WHERE r.requester_id = $1 AND r.target_id = $2 AND ${ACTIVE}`,
      [requesterId, targetId],
    );
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO route_sessions (requester_id, target_id, mode, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond') RETURNING id`,
      [requesterId, targetId, mode, ROUTE_TTL_MS],
    );
    const id = rows[0]!.id;
    await this.bus.publish(targetId, { type: 'route.updated', routeId: id });
    return (await this.get(id, requesterId))!;
  }

  async get(id: string, userId: string): Promise<RouteView | null> {
    const { rows } = await this.pool.query(
      `${SELECT_VIEW} WHERE r.id = $1 AND (r.requester_id = $2 OR r.target_id = $2)`,
      [id, userId],
    );
    return rows[0] ? toView(rows[0]) : null;
  }

  /** Активные сессии: куда иду я и кто идёт ко мне. */
  async listActive(userId: string): Promise<RouteView[]> {
    const { rows } = await this.pool.query(
      `${SELECT_VIEW} WHERE (r.requester_id = $1 OR r.target_id = $1) AND ${ACTIVE} ORDER BY r.started_at DESC`,
      [userId],
    );
    return rows.map(toView);
  }

  /** Идущий сообщает ETA и расстояние — цель видит «будет через ~7 мин». */
  async update(id: string, userId: string, patch: { etaSec: number; distanceM: number; mode?: RouteMode }): Promise<RouteView> {
    const { rows } = await this.pool.query<RouteRow>(
      `UPDATE route_sessions r SET
         eta_at = now() + $3 * interval '1 second', distance_m = $4, mode = COALESCE($5, mode)
       WHERE r.id = $1 AND r.requester_id = $2 AND ${ACTIVE}
       RETURNING r.*`,
      [id, userId, patch.etaSec, Math.round(patch.distanceM), patch.mode ?? null],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'route_not_found');
    await this.bus.publish(row.target_id, { type: 'route.updated', routeId: id });
    return (await this.get(id, userId))!;
  }

  /** Завершить может любая сторона: идущий («дошёл»/«передумал») или цель («не надо ко мне идти»). */
  async stop(id: string, userId: string, reason: 'arrived' | 'stopped'): Promise<RouteView> {
    const { rows } = await this.pool.query<RouteRow>(
      `UPDATE route_sessions r SET ended_at = now(), end_reason = $3
       WHERE r.id = $1 AND (r.requester_id = $2 OR r.target_id = $2) AND ${ACTIVE}
       RETURNING r.*`,
      [id, userId, reason],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'route_not_found');
    const other = row.requester_id === userId ? row.target_id : row.requester_id;
    await this.bus.publish(other, { type: 'route.updated', routeId: id });
    return (await this.get(id, userId))!;
  }
}

function profile(row: Record<string, unknown>, prefix: string): PublicProfile {
  return toPublicProfile({
    id: row[`${prefix}_id`] as string,
    username: row[`${prefix}_username`] as string | null,
    display_name: row[`${prefix}_display_name`] as string | null,
    avatar_url: row[`${prefix}_avatar_url`] as string | null,
  });
}

function toView(row: RouteRow & Record<string, unknown>): RouteView {
  return {
    id: row.id,
    requester: profile(row, 'rq'),
    target: profile(row, 'tg'),
    mode: row.mode,
    etaAt: row.eta_at?.toISOString() ?? null,
    distanceM: row.distance_m,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    endReason: row.end_reason,
  };
}
