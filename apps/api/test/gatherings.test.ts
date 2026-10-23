import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  befriend,
  connectWs,
  createTestContext,
  MOSCOW,
  point,
  signUp,
  type TestContext,
  type TestUser,
} from './helpers.js';

let ctx: TestContext;
let baseUrl: string;

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = (await ctx.app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws');
});

afterAll(async () => {
  await ctx.close();
});

const inject = (user: TestUser, method: 'GET' | 'PUT' | 'PATCH' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.headers, payload });

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

async function setup() {
  const owner = await signUp(ctx);
  const friend = await signUp(ctx);
  await befriend(ctx, owner, friend);
  const res = await inject(owner, 'POST', '/v1/gatherings', {
    title: 'Бар на Покровке',
    lat: MOSCOW.lat,
    lng: MOSCOW.lng,
    startsAt: inAnHour(),
    participantIds: [friend.id],
  });
  expect(res.statusCode).toBe(201);
  return { owner, friend, gathering: res.json() };
}

const participant = (gathering: { participants: { user: { id: string } }[] }, user: TestUser) =>
  gathering.participants.find((p) => p.user.id === user.id) as Record<string, unknown>;

describe('gatherings', () => {
  it('creates a gathering with the owner going and friends invited', async () => {
    const { owner, friend, gathering } = await setup();
    expect(gathering).toMatchObject({ ownerId: owner.id, title: 'Бар на Покровке', status: 'active' });
    expect(participant(gathering, owner).rsvp).toBe('going');
    expect(participant(gathering, friend).rsvp).toBe('pending');

    const list = (await inject(friend, 'GET', '/v1/gatherings')).json().gatherings;
    expect(list.map((g: { id: string }) => g.id)).toEqual([gathering.id]);
  });

  it('invites only friends and hides gatherings from outsiders', async () => {
    const { owner, gathering } = await setup();
    const stranger = await signUp(ctx);
    const res = await inject(owner, 'POST', '/v1/gatherings', {
      title: 'x',
      lat: 1,
      lng: 1,
      startsAt: inAnHour(),
      participantIds: [stranger.id],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_friends');
    expect((await inject(stranger, 'GET', `/v1/gatherings/${gathering.id}`)).statusCode).toBe(404);
  });

  it('records RSVP, chips and comments', async () => {
    const { friend, gathering } = await setup();
    const res = await inject(friend, 'PUT', `/v1/gatherings/${gathering.id}/me`, {
      chip: 'stuck',
      comment: 'застрял в пробке',
      etaMinutes: 25,
    });
    expect(res.statusCode).toBe(200);
    expect(participant(res.json(), friend)).toMatchObject({
      rsvp: 'going',
      chip: 'stuck',
      comment: 'застрял в пробке',
      etaSource: 'manual',
    });

    const declined = await inject(friend, 'PUT', `/v1/gatherings/${gathering.id}/me`, { rsvp: 'declined' });
    expect(participant(declined.json(), friend)).toMatchObject({ rsvp: 'declined', chip: null, etaAt: null });
    expect((await inject(friend, 'GET', '/v1/gatherings')).json().gatherings).toEqual([]);
  });

  it('computes auto ETA and marks arrival inside 100 m', async () => {
    const { friend, gathering } = await setup();
    await inject(friend, 'PUT', `/v1/gatherings/${gathering.id}/me`, { rsvp: 'going' });

    await inject(friend, 'POST', '/v1/location', { points: [point({ lat: 0.01 })] });
    let view = (await inject(friend, 'GET', `/v1/gatherings/${gathering.id}`)).json();
    expect(participant(view, friend)).toMatchObject({ etaSource: 'auto', arrivedAt: null });
    const etaMin = (Date.parse(participant(view, friend).etaAt as string) - Date.now()) / 60_000;
    expect(etaMin).toBeGreaterThan(10);
    expect(etaMin).toBeLessThan(25);

    await inject(friend, 'POST', '/v1/location', { points: [point({ lat: 0.0005, ts: Date.now() + 30_000 })] });
    view = (await inject(friend, 'GET', `/v1/gatherings/${gathering.id}`)).json();
    expect(participant(view, friend)).toMatchObject({ chip: 'arrived', etaAt: null });
    expect(participant(view, friend).arrivedAt).not.toBeNull();
  });

  it('lets only the owner move the time and notifies participants with the diff', async () => {
    const { owner, friend, gathering } = await setup();
    const ws = await connectWs(baseUrl, friend.accessToken);
    await ws.next((m) => m.type === 'snapshot');

    const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    expect((await inject(friend, 'PATCH', `/v1/gatherings/${gathering.id}`, { startsAt })).statusCode).toBe(403);
    const res = await inject(owner, 'PATCH', `/v1/gatherings/${gathering.id}`, { startsAt });
    expect(res.statusCode).toBe(200);

    const event = await ws.next((m) => m.type === 'gathering.updated' && m.reason === 'changed');
    expect(event).toMatchObject({ gatheringId: gathering.id, startsAtFrom: gathering.startsAt, startsAtTo: startsAt });

    await inject(owner, 'POST', `/v1/gatherings/${gathering.id}/close`);
    await ws.next((m) => m.type === 'gathering.updated' && m.reason === 'closed');
    expect((await inject(friend, 'PUT', `/v1/gatherings/${gathering.id}/me`, { rsvp: 'going' })).statusCode).toBe(409);
    await ws.close();
  });
});
