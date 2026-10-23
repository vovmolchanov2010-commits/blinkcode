import { cellToLatLng, latLngToCell } from 'h3-js';

export type Precision = 'exact' | 'approx' | 'hidden';
export type PlaceKind = 'home' | 'work';

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
  /** Владелец сейчас в своей зоне «дом» / «работа» (только если ему разрешено это видеть). */
  place?: PlaceKind;
}

/** Владелец внутри своей зоны дома или работы; showPlace — может ли зритель видеть статус. */
export interface PlaceZone {
  kind: PlaceKind;
  showPlace: boolean;
}

/**
 * «Примерная» точность — центр H3-ячейки разрешения 7 (~5 км², ребро ~1.4 км).
 * Центр ячейки не зависит от положения внутри неё, поэтому по серии примерных
 * позиций нельзя восстановить точную.
 */
export const APPROX_H3_RESOLUTION = 7;
export const APPROX_ACCURACY_M = 1500;

/**
 * Что видит друг: точную позицию, примерную или ничего (null).
 * Внутри зоны дома или работы позиция всегда примерная — адрес не раскрывается никому,
 * а разрешённые друзья вместо него видят статус «дома» / «на работе».
 */
export function visibleLocation(
  location: StoredLocation | null,
  precision: Precision,
  ownerIsGhost: boolean,
  zone: PlaceZone | null = null,
): VisibleLocation | null {
  if (!location || ownerIsGhost || precision === 'hidden') return null;

  if (precision === 'exact' && !zone) {
    return { ...location, precision: 'exact' };
  }

  // Скорость и направление выдают движение внутри ячейки — не отдаём.
  const [lat, lng] = cellToLatLng(latLngToCell(location.lat, location.lng, APPROX_H3_RESOLUTION));
  const approx: VisibleLocation = {
    lat,
    lng,
    precision: 'approx',
    accuracy: APPROX_ACCURACY_M,
    battery: location.battery,
    ts: location.ts,
  };
  if (zone?.showPlace) approx.place = zone.kind;
  return approx;
}
