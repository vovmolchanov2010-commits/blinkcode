import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from './config.js';
import type { OtpService } from './modules/auth/otp.js';
import type { TokenService } from './modules/auth/tokens.js';
import type { LocationService } from './modules/location/service.js';
import type { Bus } from './realtime/bus.js';

/** Общие зависимости, которые получают модули с маршрутами. */
export interface AppContext {
  config: Config;
  pool: pg.Pool;
  redis: Redis;
  bus: Bus;
  otp: OtpService;
  tokens: TokenService;
  location: LocationService;
}
