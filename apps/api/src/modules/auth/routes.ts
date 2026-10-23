import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parse } from '../../errors.js';
import { toMe, upsertUserByPhone } from '../users/repo.js';
import { currentUserId } from './authenticate.js';

/** Номер в формате E.164; нормализует клиент. */
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'expected E.164 phone number');

const otpRequestSchema = z.object({ phone: phoneSchema });
const otpVerifySchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/v1/auth/otp/request', async (req, reply) => {
    const { phone } = parse(otpRequestSchema, req.body);
    const code = await ctx.otp.request(phone);
    if (ctx.config.OTP_DEV_ECHO) return { devCode: code };
    return reply.code(204).send();
  });

  app.post('/v1/auth/otp/verify', async (req) => {
    const { phone, code } = parse(otpVerifySchema, req.body);
    await ctx.otp.verify(phone, code);
    const { user, isNew } = await upsertUserByPhone(ctx.pool, phone);
    const tokens = await ctx.tokens.issue(user.id);
    return { ...tokens, user: toMe(user), isNewUser: isNew };
  });

  app.post('/v1/auth/refresh', async (req) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    const { accessToken, refreshToken: next } = await ctx.tokens.rotate(refreshToken);
    return { accessToken, refreshToken: next };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    await ctx.tokens.revoke(refreshToken);
    return reply.code(204).send();
  });

  app.post('/v1/auth/logout-all', { preHandler: app.authenticate }, async (req, reply) => {
    await ctx.tokens.revokeAll(currentUserId(req));
    return reply.code(204).send();
  });
}
