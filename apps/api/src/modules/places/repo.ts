import type { Db } from '../../db/index.js';
import { distanceMeters } from '../location/geo.js';
import type { PlaceKind, PlaceZone } from '../location/privacy.js';

export type PlaceVisibility = 'all' | 'close' | 'none';

export interface SavedPlace {
  kind: PlaceKind;
  lat: number;
  lng: number;
  radiusM: number;
}

/** Места владельца и кому из друзей он показывает статус «дома» / «на работе». */
export interface OwnerPlaces {
  visibility: PlaceVisibility;
  places: SavedPlace[];
}

const NO_PLACES: OwnerPlaces = { visibility: 'none', places: [] };

export async function listPlaces(db: Db, userId: string): Promise<SavedPlace[]> {
  return (await placesOf(db, [userId])).get(userId)?.places ?? [];
}

/** Места сразу нескольких владельцев — одним запросом (для списка друзей). */
export async function placesOf(db: Db, userIds: string[]): Promise<Map<string, OwnerPlaces>> {
  const result = new Map<string, OwnerPlaces>();
  if (userIds.length === 0) return result;
  const { rows } = await db.query<{
    id: string;
    place_visibility: PlaceVisibility;
    kind: PlaceKind | null;
    lat: number | null;
    lng: number | null;
    radius_m: number | null;
  }>(
    `SELECT u.id, u.place_visibility, p.kind, p.lat, p.lng, p.radius_m
     FROM users u LEFT JOIN saved_places p ON p.user_id = u.id
     WHERE u.id = ANY($1::uuid[])
     ORDER BY p.kind`,
    [userIds],
  );
  for (const row of rows) {
    let entry = result.get(row.id);
    if (!entry) {
      entry = { visibility: row.place_visibility, places: [] };
      result.set(row.id, entry);
    }
    if (row.kind) entry.places.push({ kind: row.kind, lat: row.lat!, lng: row.lng!, radiusM: row.radius_m! });
  }
  return result;
}

export async function getOwnerPlaces(db: Db, userId: string): Promise<OwnerPlaces> {
  return (await placesOf(db, [userId])).get(userId) ?? NO_PLACES;
}

/** Зона, в которой сейчас владелец (с точки зрения конкретного зрителя), или null. */
export function zoneFor(
  owner: OwnerPlaces,
  location: { lat: number; lng: number } | null,
  viewerIsClose: boolean,
): PlaceZone | null {
  if (!location) return null;
  const place = owner.places.find((p) => distanceMeters(p, location) <= p.radiusM);
  if (!place) return null;
  const showPlace = owner.visibility === 'all' || (owner.visibility === 'close' && viewerIsClose);
  return { kind: place.kind, showPlace };
}

export async function upsertPlace(db: Db, userId: string, place: SavedPlace): Promise<void> {
  await db.query(
    `INSERT INTO saved_places (user_id, kind, lat, lng, radius_m) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, kind) DO UPDATE
       SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m, updated_at = now()`,
    [userId, place.kind, place.lat, place.lng, place.radiusM],
  );
}

export async function deletePlace(db: Db, userId: string, kind: PlaceKind): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM saved_places WHERE user_id = $1 AND kind = $2', [
    userId,
    kind,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function setPlaceVisibility(db: Db, userId: string, visibility: PlaceVisibility): Promise<void> {
  await db.query('UPDATE users SET place_visibility = $2, updated_at = now() WHERE id = $1', [userId, visibility]);
}
