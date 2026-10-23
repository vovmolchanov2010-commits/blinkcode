// Типы ответов API — зеркало apps/api (см. apps/api/README.md).

export type Precision = 'exact' | 'approx' | 'hidden';

export interface PublicProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Me extends PublicProfile {
  phone: string;
  ghostUntil: string | null;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  /** мс с эпохи */
  ts: number;
}

export type PlaceKind = 'home' | 'work';
export type PlaceVisibility = 'all' | 'close' | 'none';

export interface VisibleLocation extends LocationPoint {
  precision: 'exact' | 'approx';
  /** Друг сейчас дома / на работе (позиция внутри зоны всегда примерная). */
  place?: PlaceKind;
}

export interface SavedPlace {
  kind: PlaceKind;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface MyPlaces {
  /** Кто из друзей видит статус «дома» / «на работе». */
  visibility: PlaceVisibility;
  places: SavedPlace[];
}

// --- Сборы ---

export type Rsvp = 'pending' | 'going' | 'declined';
export type Chip = 'leaving' | 'on_the_way' | 'stuck' | 'late' | 'arrived';

export interface Participant {
  user: PublicProfile;
  rsvp: Rsvp;
  chip: Chip | null;
  comment: string | null;
  etaAt: string | null;
  etaSource: 'auto' | 'manual' | null;
  arrivedAt: string | null;
  updatedAt: string;
}

export interface Gathering {
  id: string;
  ownerId: string;
  title: string;
  lat: number;
  lng: number;
  placeName: string | null;
  startsAt: string;
  status: 'active' | 'closed' | 'ended';
  participants: Participant[];
}

// --- Маршрут до друга ---

export type RouteMode = 'walk' | 'drive';

export interface RouteSession {
  id: string;
  requester: PublicProfile;
  target: PublicProfile;
  mode: RouteMode;
  etaAt: string | null;
  distanceM: number | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: 'arrived' | 'stopped' | null;
}

// --- SOS ---

export interface SosContact {
  position: number;
  user: PublicProfile | null;
  phone: string | null;
  name: string | null;
}

export type SosContactInput = { userId: string } | { phone: string; name: string };

export interface SosSession {
  id: string;
  isTest: boolean;
  startedAt: string;
  expiresAt: string;
}

export interface SosStatus {
  hasPin: boolean;
  contacts: SosContact[];
  active: SosSession | null;
}

export interface Friend extends PublicProfile {
  isClose: boolean;
  /** Как друг видит мою геолокацию. */
  sharing: { precision: Precision };
  /** Как я вижу его геолокацию. */
  location: VisibleLocation | null;
}

export interface FriendRequests {
  incoming: PublicProfile[];
  outgoing: PublicProfile[];
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export type ServerEvent =
  | { type: 'snapshot'; locations: { userId: string; location: VisibleLocation }[] }
  | { type: 'location'; userId: string; location: VisibleLocation }
  | { type: 'location.removed'; userId: string }
  | { type: 'friend.request'; fromUserId: string }
  | { type: 'friend.added'; userId: string }
  | { type: 'friend.removed'; userId: string }
  | {
      type: 'gathering.updated';
      gatheringId: string;
      reason: 'invited' | 'changed' | 'closed' | 'status' | 'arrived';
      userId?: string;
      startsAtFrom?: string;
      startsAtTo?: string;
      placeChanged?: boolean;
    }
  | { type: 'route.updated'; routeId: string }
  | { type: 'sos.started'; sessionId: string; userId: string; url: string; isTest: boolean }
  | { type: 'sos.ended'; sessionId: string; userId: string }
  | { type: 'location.ack'; accepted: number; rejected: number }
  | { type: 'pong' }
  | { type: 'error'; error: string };
