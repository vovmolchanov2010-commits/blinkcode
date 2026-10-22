import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('postgres://blink:blink@localhost:5432/blink'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32).default(DEV_SECRET),
  OTP_SECRET: z.string().min(32).default(DEV_SECRET),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Config = z.infer<typeof schema>;

/** Подхватывает .env из текущей директории, если он есть (для локальной разработки). */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env нет — используем переменные окружения как есть.
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const config = schema.parse(env);
  if (
    config.NODE_ENV === 'production' &&
    (config.JWT_SECRET === DEV_SECRET || config.OTP_SECRET === DEV_SECRET)
  ) {
    throw new Error('JWT_SECRET and OTP_SECRET must be set in production');
  }
  return config;
}
