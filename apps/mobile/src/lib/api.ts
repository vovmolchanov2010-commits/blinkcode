import type {
  Chip,
  Friend,
  FriendRequests,
  Gathering,
  LocationPoint,
  Me,
  MyPlaces,
  PlaceKind,
  PlaceVisibility,
  Precision,
  PublicProfile,
  RouteMode,
  RouteSession,
  SosContact,
  SosContactInput,
  SosSession,
  SosStatus,
  Tokens,
} from './types';

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

/** «Сервер» внутри приложения (демо-режим): отвечает на те же запросы без сети. */
export interface LocalBackend {
  handle(method: string, path: string, body: unknown): Promise<unknown>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Секунды до истечения JWT; null, если токен не разобрать. */
export function secondsUntilExpiry(jwt: string, now = Date.now()): number | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === 'number' ? exp - now / 1000 : null;
  } catch {
    return null;
  }
}

/** Обновляем access-токен заранее, чтобы он не истёк посреди запроса. */
const REFRESH_MARGIN_SEC = 60;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Клиент API: хранит токены, сам обновляет access-токен и повторяет запрос
 * после 401. Параллельные обновления объединяются в одно — сервер считает
 * повторное использование refresh-токена кражей и разлогинивает все сессии.
 */
export class ApiClient {
  /** Вызывается, когда сессия больше недействительна и нужно войти заново. */
  onSessionExpired: (() => void) | null = null;

  private tokens: Tokens | null | undefined;
  private refreshing: Promise<Tokens | null> | null = null;
  private local: LocalBackend | null = null;

  constructor(
    private url: string,
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get baseUrl(): string {
    return this.url;
  }

  /** Сменить сервер. Токены от другого сервера не подойдут — менять только без сессии. */
  setBaseUrl(url: string): void {
    this.url = url.replace(/\/+$/, '');
  }

  /** Включить демо-режим (backend) или вернуться к настоящему серверу (null). */
  useLocalBackend(backend: LocalBackend | null): void {
    this.local = backend;
  }

  get isLocal(): boolean {
    return this.local !== null;
  }

  async hasSession(): Promise<boolean> {
    if (this.local) return true;
    return (await this.loadTokens()) !== null;
  }

  // --- Вход ---

  /** devCode приходит только с тестового сервера (OTP_DEV_ECHO) — тогда SMS не нужна. */
  async requestOtp(phone: string): Promise<{ devCode?: string }> {
    const res = await this.request<{ devCode?: string } | undefined>(
      'POST',
      '/v1/auth/otp/request',
      { phone },
      { auth: false },
    );
    return res ?? {};
  }

  async verifyOtp(phone: string, code: string): Promise<{ user: Me; isNewUser: boolean }> {
    const res = await this.request<Tokens & { user: Me; isNewUser: boolean }>(
      'POST',
      '/v1/auth/otp/verify',
      { phone, code },
      { auth: false },
    );
    await this.setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    return { user: res.user, isNewUser: res.isNewUser };
  }

  async logout(): Promise<void> {
    if (this.local) {
      this.local = null;
      return;
    }
    const tokens = await this.loadTokens();
    if (tokens) {
      // Если сервер недоступен, всё равно выходим локально.
      await this.request('POST', '/v1/auth/logout', { refreshToken: tokens.refreshToken }, { auth: false }).catch(
        () => {},
      );
    }
    await this.setTokens(null);
  }

  // --- Профиль ---

  me(): Promise<Me> {
    return this.request('GET', '/v1/me');
  }

  updateMe(patch: { username?: string; displayName?: string }): Promise<Me> {
    return this.request('PATCH', '/v1/me', patch);
  }

  /** Без until — «пока не выключу». */
  enableGhost(until?: Date): Promise<Me> {
    return this.request('PUT', '/v1/me/ghost', until ? { until: until.toISOString() } : {});
  }

  disableGhost(): Promise<Me> {
    return this.request('DELETE', '/v1/me/ghost');
  }

  findByUsername(username: string): Promise<PublicProfile> {
    return this.request('GET', `/v1/users/by-username/${encodeURIComponent(username)}`);
  }

  // --- Друзья ---

  async friends(): Promise<Friend[]> {
    return (await this.request<{ friends: Friend[] }>('GET', '/v1/friends')).friends;
  }

  friendRequests(): Promise<FriendRequests> {
    return this.request('GET', '/v1/friends/requests');
  }

  sendFriendRequest(userId: string): Promise<{ status: 'pending' | 'accepted' }> {
    return this.request('POST', '/v1/friends/requests', { userId });
  }

  async acceptFriendRequest(userId: string): Promise<void> {
    await this.request('POST', `/v1/friends/requests/${userId}/accept`);
  }

  async deleteFriendRequest(userId: string): Promise<void> {
    await this.request('DELETE', `/v1/friends/requests/${userId}`);
  }

  updateFriend(
    userId: string,
    patch: { precision?: Precision; isClose?: boolean },
  ): Promise<{ userId: string; isClose: boolean; sharing: { precision: Precision } }> {
    return this.request('PATCH', `/v1/friends/${userId}`, patch);
  }

  async removeFriend(userId: string): Promise<void> {
    await this.request('DELETE', `/v1/friends/${userId}`);
  }

  async block(userId: string): Promise<void> {
    await this.request('POST', `/v1/blocks/${userId}`);
  }

  // --- Геолокация ---

  sendLocation(points: LocationPoint[]): Promise<{ accepted: number; rejected: number }> {
    return this.request('POST', '/v1/location', { points });
  }

  // --- Дом и работа ---

  myPlaces(): Promise<MyPlaces> {
    return this.request('GET', '/v1/me/places');
  }

  setPlace(kind: PlaceKind, place: { lat: number; lng: number; radiusM?: number }): Promise<MyPlaces> {
    return this.request('PUT', `/v1/me/places/${kind}`, place);
  }

  deletePlace(kind: PlaceKind): Promise<MyPlaces> {
    return this.request('DELETE', `/v1/me/places/${kind}`);
  }

  setPlaceVisibility(visibility: PlaceVisibility): Promise<MyPlaces> {
    return this.request('PUT', '/v1/me/places-visibility', { visibility });
  }

  // --- Сборы ---

  async gatherings(): Promise<Gathering[]> {
    return (await this.request<{ gatherings: Gathering[] }>('GET', '/v1/gatherings')).gatherings;
  }

  gathering(id: string): Promise<Gathering> {
    return this.request('GET', `/v1/gatherings/${id}`);
  }

  createGathering(input: {
    title: string;
    lat: number;
    lng: number;
    placeName?: string;
    startsAt: string;
    participantIds: string[];
  }): Promise<Gathering> {
    return this.request('POST', '/v1/gatherings', input);
  }

  updateGathering(
    id: string,
    patch: { title?: string; lat?: number; lng?: number; placeName?: string | null; startsAt?: string },
  ): Promise<Gathering> {
    return this.request('PATCH', `/v1/gatherings/${id}`, patch);
  }

  closeGathering(id: string): Promise<Gathering> {
    return this.request('POST', `/v1/gatherings/${id}/close`);
  }

  setGatheringStatus(
    id: string,
    status: { rsvp?: 'going' | 'declined'; chip?: Chip | null; comment?: string | null; etaMinutes?: number },
  ): Promise<Gathering> {
    return this.request('PUT', `/v1/gatherings/${id}/me`, status);
  }

  // --- Маршрут до друга ---

  async routes(): Promise<RouteSession[]> {
    return (await this.request<{ routes: RouteSession[] }>('GET', '/v1/routes')).routes;
  }

  route(id: string): Promise<RouteSession> {
    return this.request('GET', `/v1/routes/${id}`);
  }

  startRoute(targetId: string, mode: RouteMode): Promise<RouteSession> {
    return this.request('POST', '/v1/routes', { targetId, mode });
  }

  updateRoute(id: string, patch: { etaSec: number; distanceM: number; mode?: RouteMode }): Promise<RouteSession> {
    return this.request('PATCH', `/v1/routes/${id}`, patch);
  }

  stopRoute(id: string, reason: 'arrived' | 'stopped'): Promise<RouteSession> {
    return this.request('POST', `/v1/routes/${id}/stop`, { reason });
  }

  // --- SOS ---

  sosStatus(): Promise<SosStatus> {
    return this.request('GET', '/v1/sos');
  }

  async setSosContacts(contacts: SosContactInput[]): Promise<SosContact[]> {
    return (await this.request<{ contacts: SosContact[] }>('PUT', '/v1/sos/contacts', { contacts })).contacts;
  }

  async setSosPin(pin: string, currentPin?: string): Promise<void> {
    await this.request('PUT', '/v1/sos/pin', { pin, currentPin });
  }

  startSos(test: boolean): Promise<{ session: SosSession; url: string; smsFailed: number }> {
    return this.request('POST', '/v1/sos', { test });
  }

  extendSos(): Promise<SosSession> {
    return this.request('POST', '/v1/sos/extend');
  }

  async cancelSos(pin: string): Promise<void> {
    await this.request('POST', '/v1/sos/cancel', { pin });
  }

  /** Адрес WebSocket со свежим токеном; null, если сессии нет. */
  async realtimeUrl(): Promise<string | null> {
    if (this.local) return null;
    const token = await this.freshAccessToken();
    if (!token) return null;
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/v1/ws?token=${encodeURIComponent(token)}`;
  }

  // --- Внутреннее ---

  async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    { auth = true }: { auth?: boolean } = {},
  ): Promise<T> {
    if (this.local) return (await this.local.handle(method, path, body)) as T;
    let token: string | null = null;
    if (auth) {
      token = await this.freshAccessToken();
      if (!token) throw new ApiError(401, 'unauthorized');
    }

    let res = await this.send(method, path, body, token);
    if (res.status === 401 && auth) {
      const refreshed = await this.refresh();
      if (!refreshed) throw new ApiError(401, 'unauthorized');
      res = await this.send(method, path, body, refreshed.accessToken);
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 401 && auth) this.expireSession();
      throw new ApiError(res.status, data.error ?? 'http_error', data.message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private send(method: Method, path: string, body: unknown, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async freshAccessToken(): Promise<string | null> {
    const tokens = await this.loadTokens();
    if (!tokens) return null;
    const ttl = secondsUntilExpiry(tokens.accessToken);
    if (ttl !== null && ttl > REFRESH_MARGIN_SEC) return tokens.accessToken;
    return (await this.refresh())?.accessToken ?? null;
  }

  private refresh(): Promise<Tokens | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<Tokens | null> {
    const current = await this.loadTokens();
    if (!current) return null;

    // Сетевые ошибки пробрасываем: без сети разлогинивать нельзя.
    const res = await this.send('POST', '/v1/auth/refresh', { refreshToken: current.refreshToken }, null);
    if (res.status === 401) {
      this.expireSession();
      return null;
    }
    if (!res.ok) throw new ApiError(res.status, 'refresh_failed');

    const tokens = (await res.json()) as Tokens;
    await this.setTokens(tokens);
    return tokens;
  }

  private expireSession(): void {
    void this.setTokens(null);
    this.onSessionExpired?.();
  }

  private async loadTokens(): Promise<Tokens | null> {
    if (this.tokens === undefined) this.tokens = await this.store.load();
    return this.tokens;
  }

  private async setTokens(tokens: Tokens | null): Promise<void> {
    this.tokens = tokens;
    if (tokens) await this.store.save(tokens);
    else await this.store.clear();
  }
}
