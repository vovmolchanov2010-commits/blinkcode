import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { befriend, createTestContext, MOSCOW, point, signUp, type TestContext, type TestUser } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const inject = (user: TestUser, method: 'GET' | 'PUT' | 'DELETE' | 'PATCH' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.headers, payload });

const seenBy = async (viewer: TestUser, ownerId: string) => {
  const res = await inject(viewer, 'GET', '/v1/friends/locations');
  return (res.json().locations as { userId: string; location: Record<string, unknown> }[]).find(
    (l) => l.userId === ownerId,
  )?.location;
};

describe('home and work places', () => {
  it('saves, lists and deletes places', async () => {
    const user = await signUp(ctx);
    const res = await inject(user, 'PUT', '/v1/me/places/home', { lat: MOSCOW.lat, lng: MOSCOW.lng });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      visibility: 'close',
      places: [{ kind: 'home', lat: MOSCOW.lat, lng: MOSCOW.lng, radiusM: 150 }],
    });

    expect((await inject(user, 'DELETE', '/v1/me/places/home')).json().places).toEqual([]);
    expect((await inject(user, 'DELETE', '/v1/me/places/home')).statusCode).toBe(404);
    expect((await inject(user, 'PUT', '/v1/me/places/gym', { lat: 1, lng: 1 })).statusCode).toBe(400);
  });

  it('shows "home" to close friends only and never the exact address', async () => {
    const owner = await signUp(ctx);
    const close = await signUp(ctx);
    const regular = await signUp(ctx);
    await befriend(ctx, owner, close);
    await befriend(ctx, owner, regular);
    await inject(owner, 'PATCH', `/v1/friends/${close.id}`, { isClose: true });
    await inject(owner, 'PUT', '/v1/me/places/home', { lat: MOSCOW.lat, lng: MOSCOW.lng });

    await inject(owner, 'POST', '/v1/location', { points: [point({ lat: 0.0003 })] });

    const forClose = await seenBy(close, owner.id);
    expect(forClose).toMatchObject({ precision: 'approx', place: 'home' });
    const forRegular = await seenBy(regular, owner.id);
    expect(forRegular).toMatchObject({ precision: 'approx' });
    expect(forRegular?.place).toBeUndefined();

    await inject(owner, 'PUT', '/v1/me/places-visibility', { visibility: 'all' });
    expect(await seenBy(regular, owner.id)).toMatchObject({ place: 'home' });

    // Вне зоны — снова точная позиция.
    await inject(owner, 'POST', '/v1/location', { points: [point({ lat: 0.02, ts: Date.now() + 30_000 })] });
    expect(await seenBy(regular, owner.id)).toMatchObject({ precision: 'exact', lat: MOSCOW.lat + 0.02 });
  });
});
