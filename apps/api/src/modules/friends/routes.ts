import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { tx } from '../../db/index.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import type { Precision } from '../location/privacy.js';
import { findUserById, toPublicProfile } from '../users/repo.js';
import {
  areFriends,
  createFriendship,
  deleteFriendship,
  deleteRequestsBetween,
  isBlockedEitherWay,
} from './repo.js';

const userIdParams = z.object({ userId: z.string().uuid() });
const sendRequestSchema = z.object({ userId: z.string().uuid() });
const updateFriendSchema = z
  .object({
    precision: z.enum(['exact', 'approx', 'hidden']).optional(),
    isClose: z.boolean().optional(),
  })
  .refine((v) => v.precision !== undefined || v.isClose !== undefined, 'nothing to update');

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export function registerFriendRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };

  /** Список друзей: мои настройки для каждого («кто видит меня и как») и их видимая мне позиция. */
  app.get('/v1/friends', auth, async (req) => {
    const me = currentUserId(req);
    const { rows } = await ctx.pool.query<ProfileRow & { precision: Precision; is_close: boolean }>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, f.precision, f.is_close
       FROM friendships f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY lower(coalesce(u.display_name, u.username, '')), u.id`,
      [me],
    );
    const locations = new Map(
      (await ctx.location.visibleFor(me)).map((l) => [l.userId, l.location] as const),
    );
    return {
      friends: rows.map((row) => ({
        ...toPublicProfile(row),
        isClose: row.is_close,
        sharing: { precision: row.precision },
        location: locations.get(row.id) ?? null,
      })),
    };
  });

  /** Настройки для конкретного друга: точность моей геолокации для него и «близкий друг». */
  app.patch('/v1/friends/:userId', auth, async (req) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);
    const patch = parse(updateFriendSchema, req.body);

    const { rows } = await ctx.pool.query<{ precision: Precision; is_close: boolean }>(
      `UPDATE friendships SET
         precision = COALESCE($3, precision),
         is_close = COALESCE($4, is_close)
       WHERE user_id = $1 AND friend_id = $2
       RETURNING precision, is_close`,
      [me, userId, patch.precision ?? null, patch.isClose ?? null],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'friend_not_found');

    if (patch.precision !== undefined) await ctx.location.pushTo(me, userId);
    return { userId, isClose: row.is_close, sharing: { precision: row.precision } };
  });

  app.delete('/v1/friends/:userId', auth, async (req, reply) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);
    if (!(await deleteFriendship(ctx.pool, me, userId))) throw new HttpError(404, 'friend_not_found');
    await ctx.bus.publish(userId, { type: 'friend.removed', userId: me });
    return reply.code(204).send();
  });

  app.get('/v1/friends/requests', auth, async (req) => {
    const me = currentUserId(req);
    const incoming = await ctx.pool.query<ProfileRow>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM friend_requests r JOIN users u ON u.id = r.from_user_id
       WHERE r.to_user_id = $1 ORDER BY r.created_at DESC`,
      [me],
    );
    const outgoing = await ctx.pool.query<ProfileRow>(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM friend_requests r JOIN users u ON u.id = r.to_user_id
       WHERE r.from_user_id = $1 ORDER BY r.created_at DESC`,
      [me],
    );
    return {
      incoming: incoming.rows.map(toPublicProfile),
      outgoing: outgoing.rows.map(toPublicProfile),
    };
  });

  /** Заявка в друзья. Если адресат уже звал меня — дружба создаётся сразу. */
  app.post('/v1/friends/requests', auth, async (req) => {
    const me = currentUserId(req);
    const { userId } = parse(sendRequestSchema, req.body);
    if (userId === me) throw new HttpError(400, 'cannot_befriend_self');

    const status = await tx(ctx.pool, async (db) => {
      const target = await findUserById(db, userId);
      if (!target || (await isBlockedEitherWay(db, me, userId))) {
        throw new HttpError(404, 'user_not_found');
      }
      if (await areFriends(db, me, userId)) throw new HttpError(409, 'already_friends');

      const reverse = await db.query(
        'DELETE FROM friend_requests WHERE from_user_id = $1 AND to_user_id = $2',
        [userId, me],
      );
      if ((reverse.rowCount ?? 0) > 0) {
        await createFriendship(db, me, userId);
        return 'accepted' as const;
      }
      await db.query(
        'INSERT INTO friend_requests (from_user_id, to_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [me, userId],
      );
      return 'pending' as const;
    });

    if (status === 'accepted') {
      await announceFriendship(ctx, me, userId);
    } else {
      await ctx.bus.publish(userId, { type: 'friend.request', fromUserId: me });
    }
    return { status };
  });

  app.post('/v1/friends/requests/:userId/accept', auth, async (req) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);

    await tx(ctx.pool, async (db) => {
      const { rowCount } = await db.query(
        'DELETE FROM friend_requests WHERE from_user_id = $1 AND to_user_id = $2',
        [userId, me],
      );
      if (!rowCount) throw new HttpError(404, 'request_not_found');
      await deleteRequestsBetween(db, me, userId);
      await createFriendship(db, me, userId);
    });

    await announceFriendship(ctx, me, userId);
    return { status: 'accepted' };
  });

  /** Отклонить входящую или отменить исходящую заявку. */
  app.delete('/v1/friends/requests/:userId', auth, async (req, reply) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);
    const { rowCount } = await ctx.pool.query(
      `DELETE FROM friend_requests
       WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
      [me, userId],
    );
    if (!rowCount) throw new HttpError(404, 'request_not_found');
    return reply.code(204).send();
  });

  /** Блокировка разрывает дружбу, удаляет заявки и скрывает пользователей друг от друга. */
  app.post('/v1/blocks/:userId', auth, async (req, reply) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);
    if (userId === me) throw new HttpError(400, 'cannot_block_self');

    const wereFriends = await tx(ctx.pool, async (db) => {
      if (!(await findUserById(db, userId))) throw new HttpError(404, 'user_not_found');
      await db.query(
        'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [me, userId],
      );
      await deleteRequestsBetween(db, me, userId);
      return deleteFriendship(db, me, userId);
    });

    if (wereFriends) {
      await Promise.all([
        ctx.bus.publish(userId, { type: 'friend.removed', userId: me }),
        ctx.bus.publish(me, { type: 'friend.removed', userId }),
      ]);
    }
    return reply.code(204).send();
  });

  app.delete('/v1/blocks/:userId', auth, async (req, reply) => {
    const me = currentUserId(req);
    const { userId } = parse(userIdParams, req.params);
    await ctx.pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [me, userId]);
    return reply.code(204).send();
  });
}

async function announceFriendship(ctx: AppContext, a: string, b: string): Promise<void> {
  await Promise.all([
    ctx.bus.publish(a, { type: 'friend.added', userId: b }),
    ctx.bus.publish(b, { type: 'friend.added', userId: a }),
  ]);
  await Promise.all([ctx.location.pushTo(a, b), ctx.location.pushTo(b, a)]);
}
