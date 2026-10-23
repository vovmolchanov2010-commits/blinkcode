import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import { CHIPS, MAX_PARTICIPANTS } from './service.js';

const idParams = z.object({ id: z.string().uuid() });
const title = z.string().trim().min(1).max(80);
const placeName = z.string().trim().min(1).max(120);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const startsAt = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

const createSchema = z.object({
  title,
  lat,
  lng,
  placeName: placeName.optional(),
  startsAt,
  participantIds: z.array(z.string().uuid()).min(1).max(MAX_PARTICIPANTS - 1),
});

const updateSchema = z
  .object({ title: title.optional(), lat: lat.optional(), lng: lng.optional(), placeName: placeName.nullable().optional(), startsAt: startsAt.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to update')
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), 'lat and lng go together');

const statusSchema = z
  .object({
    rsvp: z.enum(['going', 'declined']).optional(),
    chip: z.enum(CHIPS).nullable().optional(),
    comment: z.string().trim().max(140).nullable().optional(),
    etaMinutes: z.number().int().min(0).max(600).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to update');

/** Умные сборы (фича 2). */
export function registerGatheringRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };

  app.get('/v1/gatherings', auth, async (req) => ({
    gatherings: await ctx.gatherings.listActive(currentUserId(req)),
  }));

  app.post('/v1/gatherings', auth, async (req, reply) => {
    const input = parse(createSchema, req.body);
    // Сбор в прошлом бессмыслен; небольшой запас — на «прямо сейчас».
    if (input.startsAt.getTime() < Date.now() - 5 * 60_000) {
      throw new HttpError(400, 'validation_error', 'startsAt must be in the future');
    }
    return reply.code(201).send(await ctx.gatherings.create(currentUserId(req), input));
  });

  app.get('/v1/gatherings/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const gathering = await ctx.gatherings.get(id, currentUserId(req));
    if (!gathering) throw new HttpError(404, 'gathering_not_found');
    return gathering;
  });

  /** Только организатор: сдвинуть время или точку. Участники получают дифф. */
  app.patch('/v1/gatherings/:id', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return ctx.gatherings.update(id, currentUserId(req), parse(updateSchema, req.body));
  });

  app.post('/v1/gatherings/:id/close', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return ctx.gatherings.close(id, currentUserId(req));
  });

  /** Мой ответ: иду / не смогу, статус-чип, комментарий, «буду через N минут». */
  app.put('/v1/gatherings/:id/me', auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return ctx.gatherings.setMyStatus(id, currentUserId(req), parse(statusSchema, req.body));
  });
}
