import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { befriend, createTestContext, signUp, type TestContext, type TestUser } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.headers, payload });

describe('friend requests', () => {
  it('sends, lists and accepts a request', async () => {
    const a = await signUp(ctx, 'alice');
    const b = await signUp(ctx, 'bob');

    const sent = await call(a, 'POST', '/v1/friends/requests', { userId: b.id });
    expect(sent.json()).toEqual({ status: 'pending' });

    const requests = (await call(b, 'GET', '/v1/friends/requests')).json();
    expect(requests.incoming.map((u: { id: string }) => u.id)).toEqual([a.id]);
    expect(requests.outgoing).toEqual([]);

    expect((await call(b, 'POST', `/v1/friends/requests/${a.id}/accept`)).statusCode).toBe(200);

    const friends = (await call(a, 'GET', '/v1/friends')).json().friends;
    expect(friends).toEqual([
      expect.objectContaining({ id: b.id, username: 'bob', isClose: false, sharing: { precision: 'exact' } }),
    ]);
    expect((await call(b, 'GET', '/v1/friends/requests')).json().incoming).toEqual([]);
  });

  it('auto-accepts when both users request each other', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    await call(a, 'POST', '/v1/friends/requests', { userId: b.id });
    const res = await call(b, 'POST', '/v1/friends/requests', { userId: a.id });
    expect(res.json()).toEqual({ status: 'accepted' });
    expect((await call(a, 'GET', '/v1/friends')).json().friends).toHaveLength(1);
  });

  it('rejects requests to self, to friends and to unknown users', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    await befriend(ctx, a, b);

    expect((await call(a, 'POST', '/v1/friends/requests', { userId: a.id })).statusCode).toBe(400);
    expect((await call(a, 'POST', '/v1/friends/requests', { userId: b.id })).statusCode).toBe(409);
    const unknown = await call(a, 'POST', '/v1/friends/requests', {
      userId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('declines and cancels requests', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    await call(a, 'POST', '/v1/friends/requests', { userId: b.id });
    expect((await call(b, 'DELETE', `/v1/friends/requests/${a.id}`)).statusCode).toBe(204);
    expect((await call(b, 'POST', `/v1/friends/requests/${a.id}/accept`)).statusCode).toBe(404);
  });
});

describe('friend settings', () => {
  it('updates precision and close-friend flag only for my own side', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    await befriend(ctx, a, b);

    const res = await call(a, 'PATCH', `/v1/friends/${b.id}`, { precision: 'approx', isClose: true });
    expect(res.json()).toEqual({ userId: b.id, isClose: true, sharing: { precision: 'approx' } });

    const bView = (await call(b, 'GET', '/v1/friends')).json().friends[0];
    expect(bView).toMatchObject({ id: a.id, isClose: false, sharing: { precision: 'exact' } });
  });

  it('returns 404 for non-friends', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    expect((await call(a, 'PATCH', `/v1/friends/${b.id}`, { precision: 'hidden' })).statusCode).toBe(404);
  });

  it('removes a friend for both sides', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    await befriend(ctx, a, b);
    expect((await call(a, 'DELETE', `/v1/friends/${b.id}`)).statusCode).toBe(204);
    expect((await call(b, 'GET', '/v1/friends')).json().friends).toEqual([]);
  });
});

describe('blocks', () => {
  it('breaks friendship and hides users from each other', async () => {
    const a = await signUp(ctx, 'blocker');
    const b = await signUp(ctx, 'blocked');
    await befriend(ctx, a, b);

    expect((await call(a, 'POST', `/v1/blocks/${b.id}`)).statusCode).toBe(204);
    expect((await call(a, 'GET', '/v1/friends')).json().friends).toEqual([]);
    expect((await call(b, 'GET', '/v1/friends')).json().friends).toEqual([]);

    expect((await call(b, 'GET', '/v1/users/by-username/blocker')).statusCode).toBe(404);
    expect((await call(b, 'POST', '/v1/friends/requests', { userId: a.id })).statusCode).toBe(404);
    expect((await call(a, 'POST', '/v1/friends/requests', { userId: b.id })).statusCode).toBe(404);

    expect((await call(a, 'DELETE', `/v1/blocks/${b.id}`)).statusCode).toBe(204);
    expect((await call(b, 'POST', '/v1/friends/requests', { userId: a.id })).json()).toEqual({
      status: 'pending',
    });
  });
});
