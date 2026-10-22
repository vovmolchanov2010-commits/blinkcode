import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import { locationBatchSchema } from './service.js';

/**
 * HTTP-вариант отправки позиций — для фоновых задач на устройстве, когда
 * WebSocket не открыт. В онлайне клиент шлёт то же самое по WebSocket.
 */
export function registerLocationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };

  app.post('/v1/location', auth, async (req) => {
    const { points } = parse(z.object({ points: locationBatchSchema }), req.body);
    return ctx.location.ingest(currentUserId(req), points);
  });

  app.get('/v1/friends/locations', auth, async (req) => {
    return { locations: await ctx.location.visibleFor(currentUserId(req)) };
  });
}
