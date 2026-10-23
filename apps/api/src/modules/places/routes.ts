import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import { deletePlace, getOwnerPlaces, setPlaceVisibility, upsertPlace } from './repo.js';

const kindParams = z.object({ kind: z.enum(['home', 'work']) });
const placeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(1000).default(150),
});
const visibilitySchema = z.object({ visibility: z.enum(['all', 'close', 'none']) });

/**
 * Дом и работа (фича 9, способ A). Координаты мест видит только владелец;
 * друзьям уходит статус, а позиция внутри зоны размывается (см. privacy.ts).
 */
export function registerPlaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };

  app.get('/v1/me/places', auth, async (req) => getOwnerPlaces(ctx.pool, currentUserId(req)));

  app.put('/v1/me/places/:kind', auth, async (req) => {
    const me = currentUserId(req);
    const { kind } = parse(kindParams, req.params);
    const place = parse(placeSchema, req.body);
    await upsertPlace(ctx.pool, me, { kind, ...place });
    await ctx.location.broadcast(me, { notifyHidden: false });
    return getOwnerPlaces(ctx.pool, me);
  });

  app.delete('/v1/me/places/:kind', auth, async (req) => {
    const me = currentUserId(req);
    const { kind } = parse(kindParams, req.params);
    if (!(await deletePlace(ctx.pool, me, kind))) throw new HttpError(404, 'place_not_found');
    await ctx.location.broadcast(me, { notifyHidden: false });
    return getOwnerPlaces(ctx.pool, me);
  });

  app.put('/v1/me/places-visibility', auth, async (req) => {
    const me = currentUserId(req);
    const { visibility } = parse(visibilitySchema, req.body);
    await setPlaceVisibility(ctx.pool, me, visibility);
    await ctx.location.broadcast(me, { notifyHidden: false });
    return getOwnerPlaces(ctx.pool, me);
  });
}
