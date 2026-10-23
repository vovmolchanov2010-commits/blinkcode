import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError, parse } from '../../errors.js';
import { currentUserId } from '../auth/authenticate.js';
import { SOS_PAGE } from './page.js';
import { MAX_CONTACTS } from './service.js';

const pin = z.string().regex(/^\d{4,6}$/, '4–6 digits');
const contactSchema = z.union([
  z.object({ userId: z.string().uuid() }),
  z.object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'E.164, e.g. +79991234567'),
    name: z.string().trim().min(1).max(50),
  }),
]);
const contactsSchema = z.object({ contacts: z.array(contactSchema).max(MAX_CONTACTS) });
const pinSchema = z.object({ pin, currentPin: pin.optional() });
const startSchema = z.object({ test: z.boolean().default(false) });
const cancelSchema = z.object({ pin });
const tokenParams = z.object({ token: z.string().regex(/^[\w-]{20,64}$/) });

/** Страница ссылки не должна попадать в поиск, кэш и Referer. */
function privateHeaders(reply: FastifyReply): FastifyReply {
  return reply
    .header('cache-control', 'no-store')
    .header('x-robots-tag', 'noindex, nofollow')
    .header('referrer-policy', 'no-referrer');
}

/** SOS (фича 7). */
export function registerSosRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: app.authenticate };
  const baseUrl = (req: FastifyRequest) => ctx.config.PUBLIC_URL ?? `${req.protocol}://${req.host}`;

  app.get('/v1/sos', auth, async (req) => ctx.sos.status(currentUserId(req)));

  app.put('/v1/sos/contacts', auth, async (req) => {
    const { contacts } = parse(contactsSchema, req.body);
    return { contacts: await ctx.sos.setContacts(currentUserId(req), contacts) };
  });

  app.put('/v1/sos/pin', auth, async (req, reply) => {
    const body = parse(pinSchema, req.body);
    await ctx.sos.setPin(currentUserId(req), body.pin, body.currentPin);
    return reply.code(204).send();
  });

  /** Запуск: SMS контактам со ссылкой. test — пометка «ТЕСТ» в сообщениях. */
  app.post('/v1/sos', auth, async (req, reply) => {
    const { test } = parse(startSchema, req.body ?? {});
    return reply.code(201).send(await ctx.sos.start(currentUserId(req), { test, baseUrl: baseUrl(req) }));
  });

  app.post('/v1/sos/extend', auth, async (req) => ctx.sos.extend(currentUserId(req)));

  app.post('/v1/sos/cancel', auth, async (req, reply) => {
    const { pin: value } = parse(cancelSchema, req.body);
    await ctx.sos.cancel(currentUserId(req), value);
    return reply.code(204).send();
  });

  // Публичная страница по ссылке из SMS — без входа.
  app.get('/s/:token', async (req, reply) => {
    parse(tokenParams, req.params);
    return privateHeaders(reply).type('text/html; charset=utf-8').send(SOS_PAGE);
  });

  app.get('/s/:token/data', async (req, reply) => {
    const { token } = parse(tokenParams, req.params);
    const view = await ctx.sos.publicView(token);
    if (!view) throw new HttpError(404, 'not_found');
    return privateHeaders(reply).send(view);
  });
}
