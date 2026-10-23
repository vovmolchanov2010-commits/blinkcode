import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { isUniqueViolation } from '../../db/index.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import { isBlockedEitherWay } from '../friends/repo.js';
import {
  findUserById,
  findUserByUsername,
  setGhostUntil,
  toMe,
  toPublicProfile,
  updateUserProfile,
} from './repo.js';

const usernameSchema = z.string().regex(/^[a-z0-9_.]{3,24}$/, 'lowercase latin, digits, "_" or ".", 3–24 chars');

const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => v.username !== undefined || v.displayName !== undefined, 'nothing to update');

const ghostSchema = z.object({
  /** Не указано — «пока не выключу». */
  until: z.string().datetime({ offset: true }).optional(),
});

/** «Пока не выключу» храним как дату в далёком будущем. */
export const GHOST_FOREVER = new Date('9999-12-31T00:00:00Z');

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/v1/me', { preHandler: app.authenticate }, async (req) => {
    const user = await findUserById(ctx.pool, currentUserId(req));
    if (!user) throw new HttpError(401, 'unauthorized');
    return toMe(user);
  });

  app.patch('/v1/me', { preHandler: app.authenticate }, async (req) => {
    const patch = parse(updateProfileSchema, req.body);
    try {
      return toMe(await updateUserProfile(ctx.pool, currentUserId(req), patch));
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'username_taken');
      throw err;
    }
  });

  app.put('/v1/me/ghost', { preHandler: app.authenticate }, async (req) => {
    const { until } = parse(ghostSchema, req.body ?? {});
    const untilDate = until ? new Date(until) : GHOST_FOREVER;
    if (untilDate <= new Date()) throw new HttpError(400, 'validation_error', 'until must be in the future');

    const userId = currentUserId(req);
    const user = await setGhostUntil(ctx.pool, userId, untilDate);
    await ctx.location.broadcast(userId, { notifyHidden: true });
    return toMe(user);
  });

  app.delete('/v1/me/ghost', { preHandler: app.authenticate }, async (req) => {
    const userId = currentUserId(req);
    const user = await setGhostUntil(ctx.pool, userId, null);
    await ctx.location.broadcast(userId, { notifyHidden: false });
    return toMe(user);
  });

  app.get('/v1/users/by-username/:username', { preHandler: app.authenticate }, async (req) => {
    const { username } = parse(z.object({ username: z.string() }), req.params);
    const user = await findUserByUsername(ctx.pool, username);
    // Заблокированные пользователи не находят друг друга — как будто аккаунта нет.
    if (!user || (await isBlockedEitherWay(ctx.pool, currentUserId(req), user.id))) {
      throw new HttpError(404, 'user_not_found');
    }
    return toPublicProfile(user);
  });
}
