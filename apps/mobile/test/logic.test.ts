import { describe, expect, it } from 'vitest';
import {
  displayName,
  formatDistance,
  initials,
  normalizePhone,
  normalizeServerUrl,
  timeAgo,
  toLocationPoint,
} from '../src/lib/format';
import { applyEvent } from '../src/lib/friendLocations';
import {
  defaultStartTime,
  estimateEtaSec,
  formatDuration,
  formatWhen,
  isLate,
  participantStatus,
  sortParticipants,
  yandexRouteUrl,
} from '../src/lib/meet';
import type { Participant, VisibleLocation } from '../src/lib/types';

const loc = (ts: number, lat = 55.75): VisibleLocation => ({ lat, lng: 37.61, ts, precision: 'exact' });

describe('applyEvent', () => {
  it('replaces state with a snapshot', () => {
    const state = applyEvent({ old: loc(1) }, { type: 'snapshot', locations: [{ userId: 'a', location: loc(2) }] });
    expect(state).toEqual({ a: loc(2) });
  });

  it('applies newer locations and ignores older ones', () => {
    let state = applyEvent({}, { type: 'location', userId: 'a', location: loc(10) });
    state = applyEvent(state, { type: 'location', userId: 'a', location: loc(5, 1) });
    expect(state.a).toEqual(loc(10));
    state = applyEvent(state, { type: 'location', userId: 'a', location: loc(20, 2) });
    expect(state.a).toEqual(loc(20, 2));
  });

  it('removes locations on location.removed and friend.removed', () => {
    const state = { a: loc(1), b: loc(1) };
    expect(applyEvent(state, { type: 'location.removed', userId: 'a' })).toEqual({ b: loc(1) });
    expect(applyEvent(state, { type: 'friend.removed', userId: 'b' })).toEqual({ a: loc(1) });
  });

  it('keeps the same object for unrelated events', () => {
    const state = { a: loc(1) };
    expect(applyEvent(state, { type: 'pong' })).toBe(state);
    expect(applyEvent(state, { type: 'location.removed', userId: 'zzz' })).toBe(state);
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+7 999 123-45-67', '+79991234567'],
    ['8 (999) 123-45-67', '+79991234567'],
    ['9991234567', '+79991234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects non-phones', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('normalizeServerUrl', () => {
  it.each([
    ['192.168.1.5:3000', 'http://192.168.1.5:3000'],
    [' https://51.250.1.2.sslip.io/ ', 'https://51.250.1.2.sslip.io'],
    ['HTTP://Example.RU/api/', 'http://example.ru/api'],
    ['localhost:3000', 'http://localhost:3000'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it('rejects garbage and other schemes', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('ftp://example.ru')).toBeNull();
    expect(normalizeServerUrl('не адрес')).toBeNull();
    expect(normalizeServerUrl('http://exa mple.ru')).toBeNull();
  });
});

describe('formatting', () => {
  const now = 1_700_000_000_000;

  it('formats time ago', () => {
    expect(timeAgo(now - 10_000, now)).toBe('только что');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 мин назад');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 ч назад');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2 дн назад');
  });

  it('formats distance', () => {
    expect(formatDistance(234)).toBe('230 м');
    expect(formatDistance(1530)).toBe('1,5 км');
    expect(formatDistance(23_400)).toBe('23 км');
  });

  it('builds names and initials', () => {
    expect(displayName({ displayName: 'Витя', username: 'vitya' })).toBe('Витя');
    expect(displayName({ displayName: null, username: 'vitya' })).toBe('@vitya');
    expect(initials({ displayName: 'Витя Петров', username: null })).toBe('ВП');
    expect(initials({ displayName: null, username: 'masha' })).toBe('MA');
  });
});

describe('toLocationPoint', () => {
  it('drops unknown (negative) speed and heading', () => {
    const point = toLocationPoint({
      coords: { latitude: 55.75, longitude: 37.61, accuracy: 12, speed: -1, heading: -1 },
      timestamp: 1_700_000_000_123.7,
    });
    expect(point).toEqual({ lat: 55.75, lng: 37.61, accuracy: 12, ts: 1_700_000_000_124 });
  });

  it('keeps valid movement data', () => {
    const point = toLocationPoint(
      { coords: { latitude: 1, longitude: 2, accuracy: null, speed: 1.5, heading: 90 }, timestamp: 5 },
      77,
    );
    expect(point).toEqual({ lat: 1, lng: 2, speed: 1.5, heading: 90, battery: 77, ts: 5 });
  });
});

describe('meet helpers', () => {
  const startsAt = '2026-10-23T18:00:00.000Z';
  const participant = (patch: Partial<Participant>): Participant => ({
    user: { id: 'u', username: 'u', displayName: null, avatarUrl: null },
    rsvp: 'going',
    chip: null,
    comment: null,
    etaAt: null,
    etaSource: null,
    arrivedAt: null,
    updatedAt: startsAt,
    ...patch,
  });

  it('estimates and formats ETA', () => {
    expect(estimateEtaSec(1000, 'walk')).toBe(1000);
    expect(estimateEtaSec(7000, 'drive')).toBe(1300);
    expect(formatDuration(20)).toBe('~1 мин');
    expect(formatDuration(25 * 60)).toBe('~25 мин');
    expect(formatDuration(70 * 60)).toBe('~1 ч 10 мин');
    expect(formatDuration(120 * 60)).toBe('~2 ч');
  });

  it('rounds the default start time up to 15 minutes', () => {
    const date = defaultStartTime(new Date(2026, 9, 23, 17, 7, 42));
    expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([17, 45, 0]);
  });

  it('formats the day of a gathering', () => {
    const now = new Date(2026, 9, 23, 12, 0);
    expect(formatWhen(new Date(2026, 9, 23, 20, 0).toISOString(), now)).toBe('сегодня в 20:00');
    expect(formatWhen(new Date(2026, 9, 24, 9, 30).toISOString(), now)).toBe('завтра в 09:30');
    expect(formatWhen(new Date(2026, 9, 26, 18, 0).toISOString(), now)).toBe('26.10 в 18:00');
  });

  it('detects lateness only beyond 5 minutes', () => {
    expect(isLate(participant({ etaAt: '2026-10-23T18:04:00.000Z' }), startsAt)).toBe(false);
    expect(isLate(participant({ etaAt: '2026-10-23T18:06:00.000Z' }), startsAt)).toBe(true);
    expect(isLate(participant({ etaAt: '2026-10-23T18:30:00.000Z', arrivedAt: startsAt }), startsAt)).toBe(false);
  });

  it('describes and sorts participants', () => {
    const arrived = participant({ arrivedAt: startsAt, chip: 'arrived' });
    const late = participant({ chip: 'stuck', etaAt: '2026-10-23T18:20:00.000Z', etaSource: 'manual' });
    const pending = participant({ rsvp: 'pending' });
    const declined = participant({ rsvp: 'declined' });
    expect(participantStatus(arrived, startsAt)).toBe('на месте');
    expect(participantStatus(pending, startsAt)).toBe('ещё не ответил(а)');
    expect(participantStatus(declined, startsAt)).toBe('не сможет');
    expect(participantStatus(late, startsAt)).toMatch(/^застрял в пробке · будет в \d\d:\d\d · опаздывает$/);
    expect(sortParticipants([declined, pending, late, arrived])).toEqual([arrived, late, pending, declined]);
  });

  it('builds a Yandex Maps route link', () => {
    expect(yandexRouteUrl({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, 'walk')).toBe(
      'https://yandex.ru/maps/?rtext=1,2~3,4&rtt=pd',
    );
    expect(yandexRouteUrl(null, { lat: 3, lng: 4 }, 'drive')).toBe('https://yandex.ru/maps/?rtext=~3,4&rtt=auto');
  });
});
