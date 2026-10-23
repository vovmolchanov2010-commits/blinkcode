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
import { registerGatheringRoutes } from './modules/gatherings/routes.js';
import { GatheringService } from './modules/gatherings/service.js';
import { registerLocationRoutes } from './modules/location/routes.js';
import { LocationService } from './modules/location/service.js';
import { registerPlaceRoutes } from './modules/places/routes.js';
import { registerRouteRoutes } from './modules/routes/routes.js';
import { RouteService } from './modules/routes/service.js';
import { registerSosRoutes } from './modules/sos/routes.js';
import { SosService } from './modules/sos/service.js';
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
  const sms = deps.sms ?? createSmsSender(config, app);
  const location = new LocationService(pool, redis, bus);
  const ctx: AppContext = {
    config,
    pool,
    redis,
    bus,
    otp: new OtpService(redis, config.OTP_SECRET, sms),
    tokens: new TokenService(pool, app, config.REFRESH_TOKEN_TTL_DAYS),
    location,
    gatherings: new GatheringService(pool, bus),
    routes: new RouteService(pool, bus, location),
    sos: new SosService(pool, redis, bus, sms, location, app.log),
  };

  // Сбои сборов и SOS не должны мешать приёму позиций — только логируем.
  location.onAccepted((userId, point) =>
    ctx.gatherings.handleLocation(userId, point).catch((err) => app.log.error(err, 'gathering location update failed')),
  );
  location.onAccepted((userId, point) =>
    ctx.sos.handleLocation(userId, point).catch((err) => app.log.error(err, 'SOS point write failed')),
  );

  app.get('/health', async () => {
    await Promise.all([pool.query('SELECT 1'), redis.ping()]);
    return { ok: true };
  });

  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerFriendRoutes(app, ctx);
  registerLocationRoutes(app, ctx);
  registerPlaceRoutes(app, ctx);
  registerGatheringRoutes(app, ctx);
  registerRouteRoutes(app, ctx);
  registerSosRoutes(app, ctx);
  registerGateway(app, ctx);

  // Трек SOS храним 30 дней.
  const purge = () =>
    void ctx.sos.purgeOld().catch((err) => app.log.error(err, 'SOS purge failed'));
  const purgeTimer = setInterval(purge, 60 * 60_000);
  purgeTimer.unref();
  app.addHook('onReady', async () => purge());
  app.addHook('onClose', async () => clearInterval(purgeTimer));

  return app;
}

function createSmsSender(config: Config, app: FastifyInstance): SmsSender {
  if (config.SMS_PROVIDER === 'smsru') return new SmsRuSender(config.SMSRU_API_ID!);
  if (config.NODE_ENV === 'production') {
    app.log.warn('SMS_PROVIDER=log: login codes are written to the server log');
  }
  return new LogSmsSender(app.log);
}
