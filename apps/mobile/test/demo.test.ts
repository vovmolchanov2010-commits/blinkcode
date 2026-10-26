import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api';
import { DemoBackend } from '../src/lib/demo';
import { distanceMeters } from '../src/lib/format';
import type { ServerEvent } from '../src/lib/types';

const memoryStore = () => {
  let saved: { accessToken: string; refreshToken: string } | null = null;
  return {
    load: async () => saved,
    save: async (t: typeof saved) => {
      saved = t;
    },
    clear: async () => {
      saved = null;
    },
  };
};

function demoClient(now = () => Date.parse('2026-10-26T15:00:00Z')) {
  const demo = new DemoBackend(now);
  const fetchImpl = (() => {
    throw new Error('demo mode must not touch the network');
  }) as unknown as typeof fetch;
  const api = new ApiClient('http://unused', memoryStore(), fetchImpl);
  api.useLocalBackend(demo);
  return { api, demo };
}

describe('demo mode', () => {
  it('signs in without a server and never calls fetch', async () => {
    const { api } = demoClient();
    expect(await api.hasSession()).toBe(true);
    expect(await api.realtimeUrl()).toBeNull();
    expect((await api.me()).displayName).toBe('Ты');
    const friends = await api.friends();
    expect(friends.map((f) => f.displayName)).toEqual(['Витя', 'Катя', 'Дима']);
    expect(friends.find((f) => f.displayName === 'Катя')?.location).toMatchObject({ precision: 'approx', place: 'home' });
    expect((await api.friendRequests()).incoming.map((p) => p.displayName)).toEqual(['Лена']);
  });

  it('moves the demo world to the real position of the phone', async () => {
    const { api, demo } = demoClient();
    const events: ServerEvent[] = [];
    demo.subscribe((e) => events.push(e));
    const spb = { lat: 59.9386, lng: 30.3141 };
    await api.sendLocation([{ ...spb, ts: 1 }]);

    const vitya = (await api.friends()).find((f) => f.displayName === 'Витя')!;
    expect(distanceMeters(spb, vitya.location!)).toBeLessThan(3000);
    const [gathering] = await api.gatherings();
    expect(distanceMeters(spb, gathering!)).toBeLessThan(3000);
    expect(events.some((e) => e.type === 'snapshot')).toBe(true);
  });

  it('friends walk towards you and the incoming route updates', async () => {
    const { api, demo } = demoClient();
    await api.sendLocation([{ lat: 55.75, lng: 37.61, ts: 1 }]);
    const before = (await api.friends()).find((f) => f.displayName === 'Витя')!.location!;
    const events: ServerEvent[] = [];
    demo.subscribe((e) => events.push(e));
    demo.tick();
    const after = (await api.friends()).find((f) => f.displayName === 'Витя')!.location!;
    const me = { lat: 55.75, lng: 37.61 };
    expect(distanceMeters(me, after)).toBeLessThan(distanceMeters(me, before));
    expect(events.map((e) => e.type)).toContain('route.updated');
    expect((await api.routes())[0]).toMatchObject({ requester: { displayName: 'Дима' } });
  });

  it('runs the gathering, route and SOS flows', async () => {
    const { api } = demoClient();
    const [bar] = await api.gatherings();
    const updated = await api.setGatheringStatus(bar!.id, { chip: 'on_the_way', comment: 'бегу' });
    expect(updated.participants.find((p) => p.user.id === 'demo-me')).toMatchObject({ rsvp: 'going', comment: 'бегу' });

    const created = await api.createGathering({
      title: 'Кино',
      lat: 55.75,
      lng: 37.61,
      startsAt: '2026-10-26T18:00:00Z',
      participantIds: ['demo-vitya'],
    });
    expect((await api.gatherings()).map((g) => g.id)).toContain(created.id);

    const route = await api.startRoute('demo-katya', 'walk');
    expect((await api.stopRoute(route.id, 'arrived')).endReason).toBe('arrived');

    const { url } = await api.startSos(true);
    expect(url).toContain('demo');
    await expect(api.cancelSos('0000')).rejects.toMatchObject({ code: 'wrong_pin' });
    await api.cancelSos('1234');
    expect((await api.sosStatus()).active).toBeNull();
  });

  it('answers unknown requests with 404 and leaves demo on logout', async () => {
    const { api } = demoClient();
    await expect(api.request('GET', '/v1/nope')).rejects.toBeInstanceOf(ApiError);
    await api.logout();
    expect(api.isLocal).toBe(false);
  });
});
