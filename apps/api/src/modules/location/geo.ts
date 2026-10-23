const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние по большому кругу в метрах. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Скорость, начиная с которой считаем, что человек едет, а не идёт. */
const DRIVING_SPEED_MPS = 4;
const WALK_SPEED_MPS = 1.3;
const CITY_DRIVE_SPEED_MPS = 7;
/** Реальный путь по улицам длиннее прямой примерно на треть. */
const DETOUR_FACTOR = 1.3;

/**
 * Оценка времени в пути по прямой — пока не подключён провайдер маршрутов.
 * Пешком, если человек стоит или идёт; на машине/транспорте — если уже едет.
 */
export function estimateEtaSec(distanceM: number, speedMps?: number): number {
  const speed = speedMps !== undefined && speedMps >= DRIVING_SPEED_MPS ? CITY_DRIVE_SPEED_MPS : WALK_SPEED_MPS;
  return Math.round((distanceM * DETOUR_FACTOR) / speed);
}
