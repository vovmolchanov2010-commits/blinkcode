import { cellToLatLng, latLngToCell } from 'h3-js';

export type Precision = 'exact' | 'approx' | 'hidden';

export interface StoredLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  /** Время замера на устройстве, мс с эпохи. */
  ts: number;
}

export interface VisibleLocation {
  lat: number;
  lng: number;
  precision: 'exact' | 'approx';
  accuracy?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  ts: number;
}

/**
 * «Примерная» точность — центр H3-ячейки разрешения 7 (~5 км², ребро ~1.4 км).
 * Центр ячейки не зависит от положения внутри неё, поэтому по серии примерных
 * позиций нельзя восстановить точную.
 */
export const APPROX_H3_RESOLUTION = 7;
export const APPROX_ACCURACY_M = 1500;

/** Что видит друг: точную позицию, примерную или ничего (null). */
export function visibleLocation(
  location: StoredLocation | null,
  precision: Precision,
  ownerIsGhost: boolean,
): VisibleLocation | null {
  if (!location || ownerIsGhost || precision === 'hidden') return null;

  if (precision === 'exact') {
    return { ...location, precision: 'exact' };
  }

  // Скорость и направление выдают движение внутри ячейки — не отдаём.
  const [lat, lng] = cellToLatLng(latLngToCell(location.lat, location.lng, APPROX_H3_RESOLUTION));
  return {
    lat,
    lng,
    precision: 'approx',
    accuracy: APPROX_ACCURACY_M,
    battery: location.battery,
    ts: location.ts,
  };
}
