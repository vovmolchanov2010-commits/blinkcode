import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { HttpError } from '../../errors.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export class TokenService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly app: FastifyInstance,
    private readonly refreshTtlDays: number,
  ) {}

  async issue(userId: string): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))`,
      [userId, sha256(refreshToken), this.refreshTtlDays],
    );
    return { accessToken: this.app.jwt.sign({ sub: userId }), refreshToken };
  }

  /** Ротация: старый refresh-токен отзывается, выдаётся новая пара. */
  async rotate(refreshToken: string): Promise<TokenPair & { userId: string }> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>('SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1', [
      sha256(refreshToken),
    ]);
    const row = rows[0];
    if (!row || row.expires_at <= new Date()) throw new HttpError(401, 'invalid_refresh_token');

    // Повторное использование отозванного токена — признак кражи: отзываем все сессии.
    const revoked = await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [row.id],
    );
    if (row.revoked_at || revoked.rowCount === 0) {
      await this.revokeAll(row.user_id);
      throw new HttpError(401, 'invalid_refresh_token');
    }

    return { ...(await this.issue(row.user_id)), userId: row.user_id };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(refreshToken)],
    );
  }

  async revokeAll(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }
}
