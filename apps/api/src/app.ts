import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { registerAuthenticate } from './modules/auth/authenticate.js';
import { LogSmsSender, OtpService, type SmsSender, SmsRuSender } from './modules/auth/otp.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { TokenService } from './modules/auth/tokens.js';
import { registerFriendRoutes } from './modules/friends/routes.js';
import { registerLocationRoutes } from './modules/location/routes.js';
import { LocationService } from './modules/location/service.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { Bus } from './realtime/bus.js';
import { registerGateway } from './realtime/gateway.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  redis: Redis;
  sms?: SmsSender;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, pool, redis } = deps;
  const app = Fastify({ logger: deps.logger ?? true });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: `${config.ACCESS_TOKEN_TTL_SEC}s` },
  });
  await app.register(websocket);
  registerAuthenticate(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 500) req.log.error({ err, cause: err.cause }, err.message);
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    // Ошибки самого Fastify (неверный JSON, неподдерживаемый Content-Type и т.п.).
    const { statusCode, message } = err as { statusCode?: number; message?: string };
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'bad_request', message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  // Pub/sub в Redis требует отдельного соединения.
  const subscriber = redis.duplicate();
  app.addHook('onClose', async () => {
    await subscriber.quit();
  });

  const bus = new Bus(redis, subscriber);
  const ctx: AppContext = {
    pool,
    redis,
    bus,
    otp: new OtpService(redis, config.OTP_SECRET, deps.sms ?? createSmsSender(config, app)),
    tokens: new TokenService(pool, app, config.REFRESH_TOKEN_TTL_DAYS),
    location: new LocationService(pool, redis, bus),
  };

  app.get('/health', async () => {
    await Promise.all([pool.query('SELECT 1'), redis.ping()]);
    return { ok: true };
  });

  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerFriendRoutes(app, ctx);
  registerLocationRoutes(app, ctx);
  registerGateway(app, ctx);

  return app;
}

function createSmsSender(config: Config, app: FastifyInstance): SmsSender {
  if (config.SMS_PROVIDER === 'smsru') return new SmsRuSender(config.SMSRU_API_ID!);
  if (config.NODE_ENV === 'production') {
    app.log.warn('SMS_PROVIDER=log: login codes are written to the server log');
  }
  return new LogSmsSender(app.log);
}
