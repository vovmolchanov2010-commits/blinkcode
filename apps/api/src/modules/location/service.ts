import type { Redis } from 'ioredis';
import type pg from 'pg';
import { z } from 'zod';
import type { Bus } from '../../realtime/bus.js';
import { getPrecisionFor, listOwnersVisibleTo, listViewersOf } from '../friends/repo.js';
import { findUserById, isGhost } from '../users/repo.js';
import { distanceMeters } from './geo.js';
import { type StoredLocation, type VisibleLocation, visibleLocation } from './privacy.js';

export const locationPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  speed: z.number().min(0).max(1_000).optional(),
  heading: z.number().min(0).max(360).optional(),
  battery: z.number().int().min(0).max(100).optional(),
  ts: z.number().int().positive(),
});

export const locationBatchSchema = z.array(locationPointSchema).min(1).max(100);

export type LocationPoint = z.infer<typeof locationPointSchema>;

/** Последняя позиция живёт в Redis сутки; историю перемещений не храним (см. NF-04). */
const LOCATION_TTL_SEC = 24 * 60 * 60;
/** Быстрее любого самолёта: такие скачки — подмена геолокации или сбой GPS. */
const MAX_PLAUSIBLE_SPEED_MPS = 300;
/** Небольшие скачки не проверяем: на коротких интервалах шум GPS даёт большие «скорости». */
const JUMP_CHECK_MIN_DISTANCE_M = 1_000;
const MAX_CLOCK_SKEW_MS = 60_000;

const locationKey = (userId: string) => `loc:${userId}`;

export interface IngestResult {
  accepted: number;
  rejected: number;
}

export class LocationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly redis: Redis,
    private readonly bus: Bus,
  ) {}

  async getLocation(userId: string): Promise<StoredLocation | null> {
    const raw = await this.redis.get(locationKey(userId));
    return raw ? (JSON.parse(raw) as StoredLocation) : null;
  }

  /**
   * Принимает пачку точек с устройства. Точки из будущего, устаревшие и
   * неправдоподобные скачки отбрасываются. Сохраняется последняя принятая точка,
   * после чего она рассылается друзьям.
   */
  async ingest(userId: string, points: LocationPoint[], now = Date.now()): Promise<IngestResult> {
    let last = await this.getLocation(userId);
    let accepted = 0;

    for (const point of [...points].sort((a, b) => a.ts - b.ts)) {
      if (point.ts > now + MAX_CLOCK_SKEW_MS) continue;
      if (last && point.ts <= last.ts) continue;
      if (last) {
        const distance = distanceMeters(last, point);
        const seconds = (point.ts - last.ts) / 1000;
        if (distance > JUMP_CHECK_MIN_DISTANCE_M && distance / seconds > MAX_PLAUSIBLE_SPEED_MPS) {
          continue;
        }
      }
      last = point;
      accepted++;
    }

    if (accepted > 0 && last) {
      await this.redis.set(locationKey(userId), JSON.stringify(last), 'EX', LOCATION_TTL_SEC);
      await this.broadcast(userId, { notifyHidden: false });
    }
    return { accepted, rejected: points.length - accepted };
  }

  /**
   * Рассылает текущую позицию владельца всем друзьям с учётом их точности.
   * notifyHidden: отправить `location.removed` тем, кому позиция не видна
   * (нужно при включении «призрака» или понижении точности, но не при каждой новой точке).
   */
  async broadcast(ownerId: string, { notifyHidden }: { notifyHidden: boolean }): Promise<void> {
    const owner = await findUserById(this.pool, ownerId);
    if (!owner) return;
    const location = await this.getLocation(ownerId);
    const ghost = isGhost(owner);
    const viewers = await listViewersOf(this.pool, ownerId);

    await Promise.all(
      viewers.map(({ viewerId, precision }) => {
        const visible = visibleLocation(location, precision, ghost);
        if (visible) return this.bus.publish(viewerId, { type: 'location', userId: ownerId, location: visible });
        if (notifyHidden) return this.bus.publish(viewerId, { type: 'location.removed', userId: ownerId });
        return undefined;
      }),
    );
  }

  /** Отправляет одному другу актуальную видимую ему позицию владельца (или её отсутствие). */
  async pushTo(ownerId: string, viewerId: string): Promise<void> {
    const visible = await this.visibleLocationOf(ownerId, viewerId);
    await this.bus.publish(
      viewerId,
      visible
        ? { type: 'location', userId: ownerId, location: visible }
        : { type: 'location.removed', userId: ownerId },
    );
  }

  async visibleLocationOf(ownerId: string, viewerId: string): Promise<VisibleLocation | null> {
    const precision = await getPrecisionFor(this.pool, ownerId, viewerId);
    if (!precision) return null;
    const owner = await findUserById(this.pool, ownerId);
    if (!owner) return null;
    return visibleLocation(await this.getLocation(ownerId), precision, isGhost(owner));
  }

  /** Все позиции друзей, которые видит зритель. */
  async visibleFor(viewerId: string): Promise<{ userId: string; location: VisibleLocation }[]> {
    const owners = await listOwnersVisibleTo(this.pool, viewerId);
    if (owners.length === 0) return [];

    const raw = await this.redis.mget(owners.map((o) => locationKey(o.ownerId)));
    const now = new Date();
    const result: { userId: string; location: VisibleLocation }[] = [];
    owners.forEach((owner, i) => {
      const stored = raw[i] ? (JSON.parse(raw[i]!) as StoredLocation) : null;
      const ghost = isGhost({ ghost_until: owner.ghostUntil }, now);
      const visible = visibleLocation(stored, owner.precision, ghost);
      if (visible) result.push({ userId: owner.ownerId, location: visible });
    });
    return result;
  }
}
