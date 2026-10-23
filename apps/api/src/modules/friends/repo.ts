import type { Db } from '../../db/index.js';
import type { Precision } from '../location/privacy.js';

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2',
    [a, b],
  );
  return (rowCount ?? 0) > 0;
}

export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [a, b],
  );
  return (rowCount ?? 0) > 0;
}

export async function createFriendship(db: Db, a: string, b: string): Promise<void> {
  await db.query(
    `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)
     ON CONFLICT DO NOTHING`,
    [a, b],
  );
}

export async function deleteFriendship(db: Db, a: string, b: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [a, b],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteRequestsBetween(db: Db, a: string, b: string): Promise<void> {
  await db.query(
    `DELETE FROM friend_requests
     WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
    [a, b],
  );
}

/** Настройки владельца для зрителя: точность и «близкий друг». */
export interface Sharing {
  precision: Precision;
  isClose: boolean;
}

/** Друзья, которые видят геолокацию владельца, и настройки для каждого. */
export async function listViewersOf(db: Db, ownerId: string): Promise<({ viewerId: string } & Sharing)[]> {
  const { rows } = await db.query<{ friend_id: string; precision: Precision; is_close: boolean }>(
    'SELECT friend_id, precision, is_close FROM friendships WHERE user_id = $1',
    [ownerId],
  );
  return rows.map((r) => ({ viewerId: r.friend_id, precision: r.precision, isClose: r.is_close }));
}

/** Друзья, чью геолокацию может видеть зритель, с их настройками для него. */
export async function listOwnersVisibleTo(
  db: Db,
  viewerId: string,
): Promise<({ ownerId: string; ghostUntil: Date | null } & Sharing)[]> {
  const { rows } = await db.query<{
    user_id: string;
    precision: Precision;
    is_close: boolean;
    ghost_until: Date | null;
  }>(
    `SELECT f.user_id, f.precision, f.is_close, u.ghost_until
     FROM friendships f JOIN users u ON u.id = f.user_id
     WHERE f.friend_id = $1`,
    [viewerId],
  );
  return rows.map((r) => ({
    ownerId: r.user_id,
    precision: r.precision,
    isClose: r.is_close,
    ghostUntil: r.ghost_until,
  }));
}

export async function getSharingFor(db: Db, ownerId: string, viewerId: string): Promise<Sharing | null> {
  const { rows } = await db.query<{ precision: Precision; is_close: boolean }>(
    'SELECT precision, is_close FROM friendships WHERE user_id = $1 AND friend_id = $2',
    [ownerId, viewerId],
  );
  const row = rows[0];
  return row ? { precision: row.precision, isClose: row.is_close } : null;
}
