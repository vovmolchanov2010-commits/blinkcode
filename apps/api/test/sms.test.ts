import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { SmsRuSender } from '../src/modules/auth/otp.js';
import { createTestContext, type TestContext } from './helpers.js';

const smsRuResponse = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('SmsRuSender', () => {
  it('sends the message without the leading plus', async () => {
    let sent: URLSearchParams | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response(JSON.stringify({ status: 'OK', sms: { '79991234567': { status: 'OK' } } }));
    }) as unknown as typeof fetch;

    await new SmsRuSender('key', fetchImpl).send('+79991234567', 'Код: 123456');
    expect(Object.fromEntries(sent!)).toEqual({ api_id: 'key', to: '79991234567', msg: 'Код: 123456', json: '1' });
  });

  it('fails when the provider rejects the message', async () => {
    const rejected = smsRuResponse({
      status: 'OK',
      sms: { '79991234567': { status: 'ERROR', status_text: 'Неправильно указан номер' } },
    });
    await expect(new SmsRuSender('key', rejected).send('+79991234567', 'x')).rejects.toThrow(
      'Неправильно указан номер',
    );
    const unauthorized = smsRuResponse({ status: 'ERROR', status_text: 'Неправильный api_id' });
    await expect(new SmsRuSender('bad', unauthorized).send('+79991234567', 'x')).rejects.toThrow('api_id');
  });
});

describe('config', () => {
  const prod = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), OTP_SECRET: 'y'.repeat(40) };

  it('requires an explicit SMS provider in production', () => {
    expect(() => loadConfig(prod)).toThrow('SMS_PROVIDER');
    expect(loadConfig({ ...prod, SMS_PROVIDER: 'log' }).SMS_PROVIDER).toBe('log');
  });

  it('requires an API id for SMS.ru and treats empty variables as unset', () => {
    expect(() => loadConfig({ ...prod, SMS_PROVIDER: 'smsru' })).toThrow('SMSRU_API_ID');
    expect(() => loadConfig({ ...prod, SMS_PROVIDER: 'smsru', SMSRU_API_ID: '' })).toThrow('SMSRU_API_ID');
    expect(() => loadConfig({ ...prod, SMS_PROVIDER: '' })).toThrow('SMS_PROVIDER');
  });
});

describe('OTP request when SMS delivery fails', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns 502 and lets the user retry immediately', async () => {
    const failing = { send: async () => Promise.reject(new Error('balance: 0')) };
    const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), pool: ctx.pool, redis: ctx.redis, sms: failing, logger: false });
    const phone = '+79990000099';

    const first = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    expect(first.statusCode).toBe(502);
    expect(first.json()).toEqual({ error: 'sms_failed', message: 'could not send SMS' });

    const retry = await ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    expect(retry.statusCode).toBe(204);
    await app.close();
  });
});
