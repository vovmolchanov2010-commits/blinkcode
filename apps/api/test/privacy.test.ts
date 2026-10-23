import { describe, expect, it } from 'vitest';
import { applyStatus } from '../src/modules/gatherings/service.js';
import { distanceMeters, estimateEtaSec } from '../src/modules/location/geo.js';
import { APPROX_ACCURACY_M, visibleLocation } from '../src/modules/location/privacy.js';
import { MOSCOW, point } from './helpers.js';

describe('visibleLocation', () => {
  const location = point();

  it('returns full data for exact precision', () => {
    expect(visibleLocation(location, 'exact', false)).toEqual({ ...location, precision: 'exact' });
  });

  it('hides location for hidden precision, ghost mode or missing data', () => {
    expect(visibleLocation(location, 'hidden', false)).toBeNull();
    expect(visibleLocation(location, 'exact', true)).toBeNull();
    expect(visibleLocation(location, 'approx', true)).toBeNull();
    expect(visibleLocation(null, 'exact', false)).toBeNull();
  });

  it('snaps approx location to the cell center and drops movement data', () => {
    const approx = visibleLocation(location, 'approx', false)!;
    expect(approx.precision).toBe('approx');
    expect(approx.accuracy).toBe(APPROX_ACCURACY_M);
    expect(approx.speed).toBeUndefined();
    expect(approx.heading).toBeUndefined();
    expect(approx.battery).toBe(location.battery);
    expect(distanceMeters(approx, location)).toBeLessThan(3000);
  });

  it('gives the same approx point for nearby positions in one cell', () => {
    const a = visibleLocation(point(), 'approx', false)!;
    const b = visibleLocation(point({ lat: 0.0005, lng: 0.0005 }), 'approx', false)!;
    expect([b.lat, b.lng]).toEqual([a.lat, a.lng]);
  });
});

describe('visibleLocation inside home/work zones', () => {
  const location = point();

  it('blurs even exact precision and labels the place only when allowed', () => {
    const labeled = visibleLocation(location, 'exact', false, { kind: 'home', showPlace: true })!;
    expect(labeled).toMatchObject({ precision: 'approx', place: 'home' });
    expect(labeled.speed).toBeUndefined();

    const unlabeled = visibleLocation(location, 'exact', false, { kind: 'home', showPlace: false })!;
    expect(unlabeled.precision).toBe('approx');
    expect(unlabeled.place).toBeUndefined();
  });

  it('still respects hidden precision and ghost mode', () => {
    expect(visibleLocation(location, 'hidden', false, { kind: 'work', showPlace: true })).toBeNull();
    expect(visibleLocation(location, 'exact', true, { kind: 'work', showPlace: true })).toBeNull();
  });
});

describe('estimateEtaSec', () => {
  it('assumes walking unless already moving fast', () => {
    expect(estimateEtaSec(1000)).toBe(1000);
    expect(estimateEtaSec(1000, 1.2)).toBe(1000);
    expect(estimateEtaSec(7000, 10)).toBe(1300);
  });
});

describe('applyStatus', () => {
  const now = new Date('2026-10-23T17:00:00Z');
  const startsAt = new Date('2026-10-23T18:00:00Z');
  const empty = {
    rsvp: 'pending' as const,
    chip: null,
    comment: null,
    eta_at: null,
    eta_source: null,
    manual_until: null,
    arrived_at: null,
  };

  it('a chip means going and gives manual priority for 15 minutes', () => {
    const next = applyStatus(empty, startsAt, { chip: 'on_the_way' }, now);
    expect(next.rsvp).toBe('going');
    expect(next.manual_until).toEqual(new Date('2026-10-23T17:15:00Z'));
  });

  it('"late" without minutes moves ETA 10 minutes past the start', () => {
    const next = applyStatus(empty, startsAt, { chip: 'late' }, now);
    expect(next.eta_at).toEqual(new Date('2026-10-23T18:10:00Z'));
    expect(next.eta_source).toBe('manual');
  });

  it('"arrived" clears ETA, another chip clears arrival', () => {
    const arrived = applyStatus(empty, startsAt, { chip: 'arrived', etaMinutes: undefined }, now);
    expect(arrived.arrived_at).toEqual(now);
    expect(arrived.eta_at).toBeNull();
    expect(applyStatus(arrived, startsAt, { chip: 'stuck' }, now).arrived_at).toBeNull();
  });

  it('etaMinutes sets a manual ETA; declining clears everything but the comment', () => {
    const going = applyStatus(empty, startsAt, { etaMinutes: 20, comment: 'бегу' }, now);
    expect(going).toMatchObject({ rsvp: 'going', eta_source: 'manual', comment: 'бегу' });
    expect(going.eta_at).toEqual(new Date('2026-10-23T17:20:00Z'));

    const declined = applyStatus(going, startsAt, { rsvp: 'declined' }, now);
    expect(declined).toMatchObject({ rsvp: 'declined', chip: null, eta_at: null, comment: 'бегу' });
  });
});

describe('distanceMeters', () => {
  it('is ~111 km per degree of latitude', () => {
    const d = distanceMeters(MOSCOW, { lat: MOSCOW.lat + 1, lng: MOSCOW.lng });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
  });
});
