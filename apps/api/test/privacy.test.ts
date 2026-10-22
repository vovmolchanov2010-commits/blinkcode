import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../src/modules/location/geo.js';
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

describe('distanceMeters', () => {
  it('is ~111 km per degree of latitude', () => {
    const d = distanceMeters(MOSCOW, { lat: MOSCOW.lat + 1, lng: MOSCOW.lng });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
  });
});
