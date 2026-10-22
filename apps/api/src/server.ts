import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createPool } from './db/index.js';

loadEnvFile();
const config = loadConfig();

if (config.NODE_ENV === 'production') {
  // LogSmsSender пишет коды входа в лог — в production нужен настоящий SMS-провайдер.
  throw new Error('SMS provider is not configured yet; refusing to start in production');
}

const pool = createPool(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL);
const app = await buildApp({ config, pool, redis });

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
