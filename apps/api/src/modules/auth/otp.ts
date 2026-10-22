import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { HttpError } from '../../errors.js';

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Пишет SMS в лог. Для разработки и закрытого теста, где коды смотрят в логах сервера. */
export class LogSmsSender implements SmsSender {
  constructor(private readonly log: { info: (obj: object, msg: string) => void }) {}

  async send(phone: string, text: string): Promise<void> {
    this.log.info({ phone }, `SMS: ${text}`);
  }
}

/** Отправка через SMS.ru (https://sms.ru/api/send). */
export class SmsRuSender implements SmsSender {
  constructor(
    private readonly apiId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phone: string, text: string): Promise<void> {
    const to = phone.replace(/^\+/, '');
    const res = await this.fetchImpl('https://sms.ru/sms/send', {
      method: 'POST',
      body: new URLSearchParams({ api_id: this.apiId, to, msg: text, json: '1' }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      status_text?: string;
      sms?: Record<string, { status?: string; status_text?: string }>;
    } | null;
    const sms = body?.sms?.[to];
    if (!res.ok || body?.status !== 'OK' || sms?.status !== 'OK') {
      throw new Error(`sms.ru: ${sms?.status_text ?? body?.status_text ?? `HTTP ${res.status}`}`);
    }
  }
}

const CODE_TTL_SEC = 5 * 60;
const RESEND_INTERVAL_SEC = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export class OtpService {
  constructor(
    private readonly redis: Redis,
    private readonly secret: string,
    private readonly sms: SmsSender,
  ) {}

  async request(phone: string): Promise<void> {
    const resendKey = `otp:resend:${phone}`;
    if (await this.redis.exists(resendKey)) {
      throw new HttpError(429, 'otp_resend_too_soon');
    }

    const hourlyKey = `otp:hourly:${phone}`;
    const requests = await this.redis.incr(hourlyKey);
    if (requests === 1) await this.redis.expire(hourlyKey, 3600);
    if (requests > MAX_REQUESTS_PER_HOUR) {
      throw new HttpError(429, 'otp_rate_limited');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeKey = `otp:code:${phone}`;
    await this.redis
      .multi()
      .del(codeKey)
      .hset(codeKey, { hash: this.hash(phone, code), attempts: 0 })
      .expire(codeKey, CODE_TTL_SEC)
      .set(resendKey, '1', 'EX', RESEND_INTERVAL_SEC)
      .exec();

    try {
      await this.sms.send(phone, `Код для входа: ${code}`);
    } catch (err) {
      // Код не дошёл — разрешаем сразу запросить новый.
      await this.redis.del(codeKey, resendKey);
      throw new HttpError(502, 'sms_failed', 'could not send SMS', { cause: err });
    }
  }

  /** Проверяет код и сжигает его. Бросает 400/429, если код неверный. */
  async verify(phone: string, code: string): Promise<void> {
    const codeKey = `otp:code:${phone}`;
    const stored = await this.redis.hget(codeKey, 'hash');
    if (!stored) throw new HttpError(400, 'otp_invalid');

    const attempts = await this.redis.hincrby(codeKey, 'attempts', 1);
    if (attempts > MAX_ATTEMPTS) {
      await this.redis.del(codeKey);
      throw new HttpError(429, 'otp_too_many_attempts');
    }

    const expected = Buffer.from(stored, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new HttpError(400, 'otp_invalid');
    }
    // del возвращает 0, если параллельный запрос уже использовал этот код.
    if ((await this.redis.del(codeKey)) === 0) throw new HttpError(400, 'otp_invalid');
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.secret).update(`${phone}:${code}`).digest('hex');
  }
}
