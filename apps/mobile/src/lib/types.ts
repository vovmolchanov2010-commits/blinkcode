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

export interface VisibleLocation extends LocationPoint {
  precision: 'exact' | 'approx';
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
  | { type: 'location.ack'; accepted: number; rejected: number }
  | { type: 'pong' }
  | { type: 'error'; error: string };
