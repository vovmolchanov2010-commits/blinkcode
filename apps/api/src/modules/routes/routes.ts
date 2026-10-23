import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';

const idParams = z.object({ id: z.string().uuid() });
const mode = z.enum(['walk', 'drive']);
const startSchema = z.object({ targetId: z.string().uuid(), mode: mode.default('walk') });
const updateSchema = z.object({
  etaSec: z.number().int().min(0).max(24 * 3600),
  distanceM: z.number().min(0).max(1_000_000),
  mode: mode.optional(),
});
const stopSchema = z.object({ reason: z.enum(['arrived', 'stopped']).default('stopped') });

/** Маршрут до друга (фича 1). */
export function registerRouteRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };

  app.get('/v1/routes', auth, async (req) => ({ routes: await ctx.routes.listActive(currentUserId(req)) }));

  app.post('/v1/routes', auth, async (req, reply) => {
    const { targetId, mode } = parse(startSchema, req.body);
    return reply.code(201).send(await ctx.routes.start(currentUserId(req), targetId, mode));
  });

  app.get('/v1/routes/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const route = await ctx.routes.get(id, currentUserId(req));
    if (!route) throw new HttpError(404, 'route_not_found');
    return route;
  });

  app.patch('/v1/routes/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return ctx.routes.update(id, currentUserId(req), parse(updateSchema, req.body));
  });

  app.post('/v1/routes/:id/stop', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(stopSchema, req.body ?? {});
    return ctx.routes.stop(id, currentUserId(req), reason);
  });
}
