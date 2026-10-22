import { describe, expect, it } from 'vitest';
import {
  displayName,
  formatDistance,
  initials,
  normalizePhone,
  timeAgo,
  toLocationPoint,
} from '../src/lib/format';
import { applyEvent } from '../src/lib/friendLocations';
import type { VisibleLocation } from '../src/lib/types';

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
