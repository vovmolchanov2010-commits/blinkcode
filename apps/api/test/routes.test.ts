import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { befriend, createTestContext, point, signUp, type TestContext, type TestUser } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const inject = (user: TestUser, method: 'GET' | 'PATCH' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.headers, payload });

describe('route to a friend', () => {
  it('requires the target to share location with the requester', async () => {
    const walker = await signUp(ctx);
    const target = await signUp(ctx);
    await befriend(ctx, walker, target);

    let res = await inject(walker, 'POST', '/v1/routes', { targetId: target.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('target_location_hidden');

    await inject(target, 'POST', '/v1/location', { points: [point()] });
    await inject(target, 'PATCH', `/v1/friends/${walker.id}`, { precision: 'hidden' });
    res = await inject(walker, 'POST', '/v1/routes', { targetId: target.id });
    expect(res.statusCode).toBe(409);

    const stranger = await signUp(ctx);
    res = await inject(stranger, 'POST', '/v1/routes', { targetId: target.id });
    expect(res.statusCode).toBe(409);
  });

  it('shows the target who is coming with ETA and lets either side stop', async () => {
    const walker = await signUp(ctx, `walker_${Date.now() % 1_000_000}`);
    const target = await signUp(ctx);
    await befriend(ctx, walker, target);
    await inject(target, 'POST', '/v1/location', { points: [point()] });

    const started = await inject(walker, 'POST', '/v1/routes', { targetId: target.id, mode: 'walk' });
    expect(started.statusCode).toBe(201);
    const route = started.json();
    expect(route).toMatchObject({ mode: 'walk', etaAt: null, endedAt: null });

    await inject(walker, 'PATCH', `/v1/routes/${route.id}`, { etaSec: 420, distanceM: 500 });
    const forTarget = (await inject(target, 'GET', '/v1/routes')).json().routes;
    expect(forTarget).toHaveLength(1);
    expect(forTarget[0]).toMatchObject({ id: route.id, requester: { id: walker.id }, distanceM: 500 });
    const etaSec = (Date.parse(forTarget[0].etaAt) - Date.now()) / 1000;
    expect(etaSec).toBeGreaterThan(400);
    expect(etaSec).toBeLessThanOrEqual(420);

    // Обновлять ETA может только идущий.
    expect((await inject(target, 'PATCH', `/v1/routes/${route.id}`, { etaSec: 1, distanceM: 1 })).statusCode).toBe(404);

    const stopped = await inject(target, 'POST', `/v1/routes/${route.id}/stop`, { reason: 'stopped' });
    expect(stopped.json()).toMatchObject({ endReason: 'stopped' });
    expect((await inject(walker, 'GET', '/v1/routes')).json().routes).toEqual([]);
  });
});
