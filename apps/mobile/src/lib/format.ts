import type { LocationPoint, PublicProfile } from './types';

/**
 * Приводит номер к E.164. Российские форматы («8 999…», «9991234567») — к +7,
 * номера с «+» — как есть. Возвращает null, если номер не похож на телефон.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Адрес сервера из того, что ввёл пользователь: «192.168.1.5:3000» → «http://192.168.1.5:3000».
 * null — если это не http(s)-адрес.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  // Без URL(): в React Native у него реализованы не все свойства.
  const match = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?(\/[^\s?#]*)?$/i.exec(withScheme);
  if (!match) return null;
  const [, scheme, host, port = '', path = ''] = match;
  return `${scheme!.toLowerCase()}://${host!.toLowerCase()}${port}${path.replace(/\/+$/, '')}`;
}

export function displayName(user: Pick<PublicProfile, 'displayName' | 'username'>): string {
  return user.displayName ?? (user.username ? `@${user.username}` : 'Без имени');
}

export function initials(user: Pick<PublicProfile, 'displayName' | 'username'>): string {
  const source = user.displayName ?? user.username ?? '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : source.slice(0, 2);
  return letters.toUpperCase();
}

/** «только что», «5 мин назад», «2 ч назад», «3 дн назад». */
export function timeAgo(ts: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
  return `${Math.round(meters / 1000)} км`;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Структура совпадает с LocationObject из expo-location. */
export interface DeviceLocation {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
  timestamp: number;
}

/** LocationObject → точка API. Отрицательные speed/heading на iOS означают «неизвестно». */
export function toLocationPoint(location: DeviceLocation, battery?: number): LocationPoint {
  const { latitude, longitude, accuracy, speed, heading } = location.coords;
  const point: LocationPoint = { lat: latitude, lng: longitude, ts: Math.round(location.timestamp) };
  if (accuracy !== null && accuracy >= 0) point.accuracy = accuracy;
  if (speed !== null && speed >= 0) point.speed = speed;
  if (heading !== null && heading >= 0 && heading <= 360) point.heading = heading;
  if (battery !== undefined) point.battery = battery;
  return point;
}
