import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const post = (url: string, payload: object, headers?: Record<string, string>) =>
  ctx.app.inject({ method: 'POST', url, payload, headers });

describe('OTP sign in', () => {
  it('creates a user on first sign in and returns the same user later', async () => {
    const phone = '+79990000001';
    expect((await post('/v1/auth/otp/request', { phone })).statusCode).toBe(204);

    const first = await post('/v1/auth/otp/verify', { phone, code: ctx.sms.lastCode(phone) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ isNewUser: true, user: { phone } });

    await ctx.redis.del(`otp:resend:${phone}`);
    await post('/v1/auth/otp/request', { phone });
    const second = await post('/v1/auth/otp/verify', { phone, code: ctx.sms.lastCode(phone) });
    expect(second.json()).toMatchObject({ isNewUser: false, user: { id: first.json().user.id } });
  });

  it('rejects malformed phone numbers', async () => {
    const res = await post('/v1/auth/otp/request', { phone: '8 999 000-00-00' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('limits resend frequency', async () => {
    const phone = '+79990000002';
    await post('/v1/auth/otp/request', { phone });
    const res = await post('/v1/auth/otp/request', { phone });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe('otp_resend_too_soon');
  });

  it('burns the code after too many wrong attempts', async () => {
    const phone = '+79990000003';
    await post('/v1/auth/otp/request', { phone });
    const code = ctx.sms.lastCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      expect((await post('/v1/auth/otp/verify', { phone, code: wrong })).statusCode).toBe(400);
    }
    const res = await post('/v1/auth/otp/verify', { phone, code });
    expect(res.statusCode).toBe(429);
    expect((await post('/v1/auth/otp/verify', { phone, code })).statusCode).toBe(400);
  });

  it('does not accept the same code twice', async () => {
    const phone = '+79990000004';
    await post('/v1/auth/otp/request', { phone });
    const code = ctx.sms.lastCode(phone);
    expect((await post('/v1/auth/otp/verify', { phone, code })).statusCode).toBe(200);
    expect((await post('/v1/auth/otp/verify', { phone, code })).statusCode).toBe(400);
  });
});

describe('tokens', () => {
  it('protects endpoints with the access token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const user = await signUp(ctx);
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: user.headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(user.id);
  });

  it('rotates refresh tokens and revokes all sessions on reuse', async () => {
    const user = await signUp(ctx);

    const rotated = await post('/v1/auth/refresh', { refreshToken: user.refreshToken });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().refreshToken as string;
    expect(next).not.toBe(user.refreshToken);

    // Повторное использование старого токена — отзываются все сессии, включая новую.
    expect((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode).toBe(401);
    expect((await post('/v1/auth/refresh', { refreshToken: next })).statusCode).toBe(401);
  });

  it('logs out a single session and all sessions', async () => {
    const user = await signUp(ctx);
    expect((await post('/v1/auth/logout', { refreshToken: user.refreshToken })).statusCode).toBe(204);
    expect((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode).toBe(401);

    const other = await signUp(ctx);
    expect((await post('/v1/auth/logout-all', {}, other.headers)).statusCode).toBe(204);
    expect((await post('/v1/auth/refresh', { refreshToken: other.refreshToken })).statusCode).toBe(401);
  });
});

describe('profile', () => {
  it('updates username and rejects duplicates case-insensitively', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: a.headers,
      payload: { username: 'vitya', displayName: 'Витя' },
    });
    expect(res.json()).toMatchObject({ username: 'vitya', displayName: 'Витя' });

    const dup = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: b.headers,
      payload: { username: 'vitya' },
    });
    expect(dup.statusCode).toBe(409);

    const found = await ctx.app.inject({
      method: 'GET',
      url: '/v1/users/by-username/VITYA',
      headers: b.headers,
    });
    expect(found.json()).toEqual({ id: a.id, username: 'vitya', displayName: 'Витя', avatarUrl: null });
  });
});
