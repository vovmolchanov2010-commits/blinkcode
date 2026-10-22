import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, secondsUntilExpiry, type TokenStore } from '../src/lib/api';
import type { Tokens } from '../src/lib/types';

function jwt(expInSec: number): string {
  const payload = btoa(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + expInSec }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function memoryStore(initial: Tokens | null = null) {
  let tokens = initial;
  const store: TokenStore & { current: () => Tokens | null } = {
    load: async () => tokens,
    save: async (t) => {
      tokens = t;
    },
    clear: async () => {
      tokens = null;
    },
    current: () => tokens,
  };
  return store;
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe('secondsUntilExpiry', () => {
  it('reads exp from a JWT', () => {
    const ttl = secondsUntilExpiry(jwt(600))!;
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('returns null for garbage', () => {
    expect(secondsUntilExpiry('nope')).toBeNull();
  });
});

describe('ApiClient', () => {
  it('stores tokens after OTP verification and sends the access token', async () => {
    const store = memoryStore();
    const access = jwt(900);
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('/v1/auth/otp/verify')) {
        return json(200, { accessToken: access, refreshToken: 'r1', user: { id: 'u1' }, isNewUser: true });
      }
      return json(200, { id: 'u1' });
    });
    const client = new ApiClient('http://api', store, fetch);

    await client.verifyOtp('+79991234567', '123456');
    expect(store.current()).toEqual({ accessToken: access, refreshToken: 'r1' });

    await client.me();
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${access}`);
  });

  it('refreshes an expiring token before the request', async () => {
    const fresh = jwt(900);
    const store = memoryStore({ accessToken: jwt(10), refreshToken: 'old' });
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith('/v1/auth/refresh') ? json(200, { accessToken: fresh, refreshToken: 'new' }) : json(200, {}),
    );
    const client = new ApiClient('http://api', store, fetch);

    await client.me();
    expect(calls.map((c) => c.url)).toEqual(['http://api/v1/auth/refresh', 'http://api/v1/me']);
    expect(store.current()).toEqual({ accessToken: fresh, refreshToken: 'new' });
  });

  it('retries once after a 401 with a refreshed token', async () => {
    const fresh = jwt(900);
    const store = memoryStore({ accessToken: jwt(900), refreshToken: 'old' });
    let meCalls = 0;
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/v1/auth/refresh')) return json(200, { accessToken: fresh, refreshToken: 'new' });
      meCalls++;
      return meCalls === 1 ? json(401, { error: 'unauthorized' }) : json(200, { id: 'u1' });
    });
    const client = new ApiClient('http://api', store, fetch);

    expect(await client.me()).toEqual({ id: 'u1' });
    expect(meCalls).toBe(2);
  });

  it('runs a single refresh for concurrent requests', async () => {
    const store = memoryStore({ accessToken: jwt(0), refreshToken: 'old' });
    let refreshes = 0;
    const { fetch } = fakeFetch(async (url) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: jwt(900), refreshToken: `new${refreshes}` });
      }
      return json(200, {});
    });
    const client = new ApiClient('http://api', store, fetch);

    await Promise.all([client.me(), client.friends().catch(() => {}), client.friendRequests()]);
    expect(refreshes).toBe(1);
  });

  it('expires the session when the refresh token is rejected', async () => {
    const store = memoryStore({ accessToken: jwt(0), refreshToken: 'stolen' });
    const { fetch } = fakeFetch(() => json(401, { error: 'invalid_refresh_token' }));
    const client = new ApiClient('http://api', store, fetch);
    const onExpired = vi.fn();
    client.onSessionExpired = onExpired;

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalled();
    expect(store.current()).toBeNull();
  });

  it('keeps the session on network errors', async () => {
    const store = memoryStore({ accessToken: jwt(0), refreshToken: 'r' });
    const fetch = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof globalThis.fetch;
    const client = new ApiClient('http://api', store, fetch);

    await expect(client.me()).rejects.toThrow('Network request failed');
    expect(store.current()).not.toBeNull();
  });

  it('maps error responses to ApiError', async () => {
    const store = memoryStore({ accessToken: jwt(900), refreshToken: 'r' });
    const { fetch } = fakeFetch(() => json(409, { error: 'username_taken', message: 'taken' }));
    const client = new ApiClient('http://api', store, fetch);

    const err = await client.updateMe({ username: 'vitya' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'username_taken' });
  });

  it('builds the websocket URL with a fresh token', async () => {
    const access = jwt(900);
    const client = new ApiClient('https://api.example.com', memoryStore({ accessToken: access, refreshToken: 'r' }), vi.fn() as unknown as typeof fetch);
    expect(await client.realtimeUrl()).toBe(`wss://api.example.com/v1/ws?token=${encodeURIComponent(access)}`);
  });

  it('logs out locally even if the server is unreachable', async () => {
    const store = memoryStore({ accessToken: jwt(900), refreshToken: 'r' });
    const fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof globalThis.fetch;
    const client = new ApiClient('http://api', store, fetch);

    await client.logout();
    expect(store.current()).toBeNull();
    expect(await client.hasSession()).toBe(false);
  });
});
