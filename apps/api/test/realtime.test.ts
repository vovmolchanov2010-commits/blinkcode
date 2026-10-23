import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { befriend, connectWs, createTestContext, point, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let baseUrl: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await ctx.close();
});

describe('websocket gateway', () => {
  it('rejects connections without a valid token', async () => {
    const ws = new WebSocket(`${baseUrl}/v1/ws?token=nope`);
    const status = await new Promise<number>((resolve) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => resolve(101));
    });
    expect(status).toBe(401);
  });

  it('sends a snapshot and live location updates from friends', async () => {
    const owner = await signUp(ctx);
    const viewer = await signUp(ctx);
    await befriend(ctx, owner, viewer);
    const first = point({ ts: Date.now() - 5000 });
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/location',
      headers: owner.headers,
      payload: { points: [first] },
    });

    const viewerWs = await connectWs(baseUrl, viewer.accessToken);
    const snapshot = await viewerWs.next((m) => m.type === 'snapshot');
    expect(snapshot.locations).toEqual([{ userId: owner.id, location: { ...first, precision: 'exact' } }]);

    // Владелец шлёт позицию по своему WebSocket — друг получает её сразу.
    const ownerWs = await connectWs(baseUrl, owner.accessToken);
    await ownerWs.next((m) => m.type === 'snapshot');
    const second = point({ lat: 0.001 });
    ownerWs.send({ type: 'location', points: [second] });
    expect(await ownerWs.next((m) => m.type === 'location.ack')).toEqual({
      type: 'location.ack',
      accepted: 1,
      rejected: 0,
    });

    const update = await viewerWs.next((m) => m.type === 'location');
    expect(update).toEqual({ type: 'location', userId: owner.id, location: { ...second, precision: 'exact' } });

    // Включение «призрака» убирает позицию у друзей.
    await ctx.app.inject({ method: 'PUT', url: '/v1/me/ghost', headers: owner.headers });
    expect(await viewerWs.next((m) => m.type === 'location.removed')).toEqual({
      type: 'location.removed',
      userId: owner.id,
    });

    await Promise.all([viewerWs.close(), ownerWs.close()]);
  });

  it('notifies about friend requests and new friendships', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    const bWs = await connectWs(baseUrl, b.accessToken);
    await bWs.next((m) => m.type === 'snapshot');

    await ctx.app.inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers: a.headers,
      payload: { userId: b.id },
    });
    expect(await bWs.next((m) => m.type === 'friend.request')).toEqual({
      type: 'friend.request',
      fromUserId: a.id,
    });

    await ctx.app.inject({ method: 'POST', url: `/v1/friends/requests/${a.id}/accept`, headers: b.headers });
    expect(await bWs.next((m) => m.type === 'friend.added')).toEqual({ type: 'friend.added', userId: a.id });

    await bWs.close();
  });

  it('answers ping and reports invalid messages', async () => {
    const user = await signUp(ctx);
    const ws = await connectWs(baseUrl, user.accessToken);
    ws.send({ type: 'ping' });
    expect(await ws.next((m) => m.type === 'pong')).toEqual({ type: 'pong' });
    ws.ws.send('not json');
    expect(await ws.next((m) => m.type === 'error')).toEqual({ type: 'error', error: 'invalid_json' });
    ws.send({ type: 'location', points: [] });
    expect(await ws.next((m) => m.type === 'error')).toEqual({ type: 'error', error: 'validation_error' });
    await ws.close();
  });
});
