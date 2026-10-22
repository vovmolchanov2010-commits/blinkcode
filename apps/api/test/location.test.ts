import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  befriend,
  createTestContext,
  MOSCOW,
  point,
  signUp,
  type TestContext,
  type TestUser,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const sendPoints = (user: TestUser, points: object[]) =>
  ctx.app.inject({ method: 'POST', url: '/v1/location', headers: user.headers, payload: { points } });

const locationsSeenBy = async (user: TestUser) =>
  (await ctx.app.inject({ method: 'GET', url: '/v1/friends/locations', headers: user.headers })).json()
    .locations as { userId: string; location: Record<string, unknown> }[];

async function pair() {
  const owner = await signUp(ctx);
  const viewer = await signUp(ctx);
  await befriend(ctx, owner, viewer);
  return { owner, viewer };
}

describe('location sharing', () => {
  it('shows the exact location to friends only', async () => {
    const { owner, viewer } = await pair();
    const stranger = await signUp(ctx);
    const p = point();

    expect((await sendPoints(owner, [p])).json()).toEqual({ accepted: 1, rejected: 0 });

    expect(await locationsSeenBy(viewer)).toEqual([
      { userId: owner.id, location: { ...p, precision: 'exact' } },
    ]);
    expect(await locationsSeenBy(stranger)).toEqual([]);

    const friends = (await ctx.app.inject({ method: 'GET', url: '/v1/friends', headers: viewer.headers })).json();
    expect(friends.friends[0].location).toMatchObject({ lat: p.lat, lng: p.lng });
  });

  it('applies per-friend precision', async () => {
    const { owner, viewer } = await pair();
    await sendPoints(owner, [point()]);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/friends/${viewer.id}`,
      headers: owner.headers,
      payload: { precision: 'approx' },
    });
    const [approx] = await locationsSeenBy(viewer);
    expect(approx!.location).toMatchObject({ precision: 'approx', accuracy: 1500 });
    expect(approx!.location.lat).not.toBe(MOSCOW.lat);
    expect(approx!.location).not.toHaveProperty('speed');

    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/friends/${viewer.id}`,
      headers: owner.headers,
      payload: { precision: 'hidden' },
    });
    expect(await locationsSeenBy(viewer)).toEqual([]);
  });

  it('hides location in ghost mode until it is turned off or expires', async () => {
    const { owner, viewer } = await pair();
    await sendPoints(owner, [point()]);

    const ghost = await ctx.app.inject({ method: 'PUT', url: '/v1/me/ghost', headers: owner.headers });
    expect(ghost.json().ghostUntil).toBe('9999-12-31T00:00:00.000Z');
    expect(await locationsSeenBy(viewer)).toEqual([]);

    await ctx.app.inject({ method: 'DELETE', url: '/v1/me/ghost', headers: owner.headers });
    expect(await locationsSeenBy(viewer)).toHaveLength(1);

    // Истёкший «призрак» больше не скрывает позицию.
    await ctx.pool.query("UPDATE users SET ghost_until = now() - interval '1 minute' WHERE id = $1", [owner.id]);
    expect(await locationsSeenBy(viewer)).toHaveLength(1);
  });

  it('rejects ghost mode end dates in the past', async () => {
    const owner = await signUp(ctx);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/ghost',
      headers: owner.headers,
      payload: { until: new Date(Date.now() - 1000).toISOString() },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('location ingest', () => {
  it('keeps the latest point of a batch regardless of order', async () => {
    const { owner, viewer } = await pair();
    const now = Date.now();
    const older = point({ ts: now - 10_000 });
    const newer = point({ lat: 0.0001, ts: now });

    expect((await sendPoints(owner, [newer, older])).json()).toEqual({ accepted: 2, rejected: 0 });
    expect((await locationsSeenBy(viewer))[0]!.location.ts).toBe(newer.ts);
  });

  it('ignores stale points and points from the future', async () => {
    const { owner } = await pair();
    const now = Date.now();
    await sendPoints(owner, [point({ ts: now })]);

    const res = await sendPoints(owner, [point({ ts: now - 1000 }), point({ ts: now + 10 * 60_000 })]);
    expect(res.json()).toEqual({ accepted: 0, rejected: 2 });
  });

  it('rejects implausible jumps but accepts long trips over time', async () => {
    const { owner } = await pair();
    const now = Date.now();
    await sendPoints(owner, [point({ ts: now - 3 * 3600_000 })]);

    // ~650 км за минуту — подмена геолокации.
    const teleport = await sendPoints(owner, [{ lat: 59.9386, lng: 30.3141, ts: now - 3 * 3600_000 + 60_000 }]);
    expect(teleport.json()).toEqual({ accepted: 0, rejected: 1 });

    // Те же ~650 км за полтора часа — нормальный перелёт.
    const flight = await sendPoints(owner, [{ lat: 59.9386, lng: 30.3141, ts: now - 1.5 * 3600_000 }]);
    expect(flight.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it('validates the payload', async () => {
    const owner = await signUp(ctx);
    expect((await sendPoints(owner, [{ lat: 100, lng: 0, ts: Date.now() }])).statusCode).toBe(400);
    expect((await sendPoints(owner, [])).statusCode).toBe(400);
  });
});
