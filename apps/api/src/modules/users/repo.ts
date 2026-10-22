import type { Db } from '../../db/index.js';

export interface UserRow {
  id: string;
  phone: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ghost_until: Date | null;
}

export interface PublicProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const COLUMNS = 'id, phone, username, display_name, avatar_url, ghost_until';

export function toPublicProfile(row: Omit<UserRow, 'phone' | 'ghost_until'>): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export function toMe(row: UserRow) {
  return {
    ...toPublicProfile(row),
    phone: row.phone,
    ghostUntil: row.ghost_until?.toISOString() ?? null,
  };
}

export function isGhost(row: Pick<UserRow, 'ghost_until'>, now = new Date()): boolean {
  return row.ghost_until !== null && row.ghost_until > now;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findUserByUsername(db: Db, username: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return rows[0] ?? null;
}

export async function upsertUserByPhone(
  db: Db,
  phone: string,
): Promise<{ user: UserRow; isNew: boolean }> {
  const { rows } = await db.query<UserRow & { inserted: boolean }>(
    `INSERT INTO users (phone) VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
    [phone],
  );
  const { inserted, ...user } = rows[0]!;
  return { user, isNew: inserted };
}

export async function updateUserProfile(
  db: Db,
  id: string,
  patch: { username?: string; displayName?: string },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET
       username = COALESCE($2, username),
       display_name = COALESCE($3, display_name),
       updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, patch.username ?? null, patch.displayName ?? null],
  );
  return rows[0]!;
}

export async function setGhostUntil(db: Db, id: string, until: Date | null): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET ghost_until = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, until],
  );
  return rows[0]!;
}
