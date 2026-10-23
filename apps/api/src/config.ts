import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production';

/** Пустая переменная (`SMSRU_API_ID=` в .env) — то же, что не заданная. */
const optional = <T extends z.ZodTypeAny>(type: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), type.optional());

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
  /** log — коды входа пишутся в лог сервера; smsru — отправка через SMS.ru. */
  SMS_PROVIDER: optional(z.enum(['log', 'smsru'])),
  SMSRU_API_ID: optional(z.string()),
  /**
   * Тестовый режим: код входа возвращается в ответе на запрос кода, и приложение
   * подставляет его само. Только для локального запуска — в production запрещён.
   */
  /** Внешний адрес сервера для ссылок SOS в SMS, например https://blink.example.ru. */
  PUBLIC_URL: optional(z.string().url().transform((v) => v.replace(/\/+$/, ''))),
  OTP_DEV_ECHO: optional(z.enum(['true', 'false'])).transform((v) => v === 'true'),
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
  // В production способ доставки кодов выбирается явно, чтобы коды случайно не ушли в лог.
  if (config.NODE_ENV === 'production' && !config.SMS_PROVIDER) {
    throw new Error('SMS_PROVIDER must be set in production (smsru, or log for a closed test)');
  }
  if (config.NODE_ENV === 'production' && config.OTP_DEV_ECHO) {
    throw new Error('OTP_DEV_ECHO must not be enabled in production');
  }
  if (config.SMS_PROVIDER === 'smsru' && !config.SMSRU_API_ID) {
    throw new Error('SMSRU_API_ID is required when SMS_PROVIDER=smsru');
  }
  return config;
}
