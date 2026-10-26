import { ApiError, type LocalBackend } from './api';
import { distanceMeters } from './format';
import { estimateEtaSec } from './meet';
import type {
  Friend,
  Gathering,
  LocationPoint,
  Me,
  MyPlaces,
  Participant,
  PlaceKind,
  Precision,
  PublicProfile,
  RouteSession,
  ServerEvent,
  SosContact,
  SosStatus,
  VisibleLocation,
} from './types';

/**
 * Демо-режим: «сервер» внутри приложения с выдуманными друзьями, сбором и маршрутом.
 * Нужен, чтобы показать приложение без интернета и без поднятого сервера.
 * Отвечает на те же запросы, что и настоящий API (см. apps/api/README.md), данные — в памяти.
 */

type LatLng = { lat: number; lng: number };

interface DemoFriend {
  profile: PublicProfile;
  isClose: boolean;
  /** Как друг видит меня. */
  sharing: Precision;
  /** Как я вижу друга. */
  visibleAs: 'exact' | 'approx';
  position: LatLng;
  battery: number;
  place?: PlaceKind;
  updatedAt: number;
}

const MOSCOW: LatLng = { lat: 55.7558, lng: 37.6173 };
/** Если настоящая позиция дальше — переносим демо-мир к пользователю. */
const REBASE_DISTANCE_M = 20_000;
const MINUTE = 60_000;

const profile = (id: string, username: string, displayName: string): PublicProfile => ({
  id,
  username,
  displayName,
  avatarUrl: null,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class DemoBackend implements LocalBackend {
  private me: Me = {
    id: 'demo-me',
    phone: '+7 000 000-00-00',
    username: 'demo',
    displayName: 'Ты',
    avatarUrl: null,
    ghostUntil: null,
  };
  private myPosition: LatLng = { ...MOSCOW };
  private located = false;
  private friends: DemoFriend[];
  private incoming: PublicProfile[] = [profile('demo-lena', 'lena', 'Лена')];
  private outgoing: PublicProfile[] = [];
  private places: MyPlaces = { visibility: 'close', places: [] };
  private gatherings: Gathering[];
  private routes: RouteSession[];
  private sos: SosStatus;
  private sosPin = '1234';
  private listeners = new Set<(event: ServerEvent) => void>();
  private counter = 0;

  constructor(private readonly now: () => number = Date.now) {
    const t = now();
    const at = (dLat: number, dLng: number): LatLng => ({ lat: MOSCOW.lat + dLat, lng: MOSCOW.lng + dLng });
    this.friends = [
      {
        profile: profile('demo-vitya', 'vitya', 'Витя'),
        isClose: true,
        sharing: 'exact',
        visibleAs: 'exact',
        position: at(0.009, -0.011),
        battery: 54,
        updatedAt: t,
      },
      {
        profile: profile('demo-katya', 'katya', 'Катя'),
        isClose: false,
        sharing: 'exact',
        visibleAs: 'approx',
        position: at(-0.011, 0.016),
        battery: 93,
        place: 'home',
        updatedAt: t - 3 * MINUTE,
      },
      {
        profile: profile('demo-dima', 'dima', 'Дима'),
        isClose: false,
        sharing: 'exact',
        visibleAs: 'exact',
        position: at(0.013, 0.012),
        battery: 31,
        updatedAt: t - MINUTE,
      },
    ];

    const startsAt = new Date(t + 45 * MINUTE);
    startsAt.setSeconds(0, 0);
    const participant = (user: PublicProfile, patch: Partial<Participant>): Participant => ({
      user,
      rsvp: 'going',
      chip: null,
      comment: null,
      etaAt: null,
      etaSource: null,
      arrivedAt: null,
      updatedAt: new Date(t).toISOString(),
      ...patch,
    });
    const [vitya, katya, dima] = this.friends.map((f) => f.profile) as [PublicProfile, PublicProfile, PublicProfile];
    this.gatherings = [
      {
        id: 'demo-bar',
        ownerId: vitya.id,
        title: 'Бар на Покровке',
        placeName: 'Покровка, 17',
        ...at(0.004, 0.012),
        startsAt: startsAt.toISOString(),
        status: 'active',
        participants: [
          participant(vitya, { chip: 'on_the_way', etaAt: new Date(t + 25 * MINUTE).toISOString(), etaSource: 'auto' }),
          participant(katya, {
            chip: 'stuck',
            comment: 'пробка на Садовом, но еду',
            etaAt: new Date(startsAt.getTime() + 12 * MINUTE).toISOString(),
            etaSource: 'manual',
          }),
          participant(dima, { rsvp: 'pending' }),
          participant(this.me, { rsvp: 'pending' }),
        ],
      },
    ];
    this.routes = [
      {
        id: 'demo-route-dima',
        requester: dima,
        target: this.me,
        mode: 'walk',
        etaAt: new Date(t + 9 * MINUTE).toISOString(),
        distanceM: 700,
        startedAt: new Date(t - 2 * MINUTE).toISOString(),
        expiresAt: new Date(t + 58 * MINUTE).toISOString(),
        endedAt: null,
        endReason: null,
      },
    ];
    this.sos = {
      hasPin: true,
      contacts: [
        { position: 1, user: vitya, phone: null, name: null },
        { position: 2, user: null, phone: '+7 916 000-00-00', name: 'Мама' },
      ],
      active: null,
    };
  }

  /** PIN для отмены SOS в демо — показываем его на экране входа. */
  get demoPin(): string {
    return this.sosPin;
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Позиции друзей, как их отдаёт WebSocket при подключении. */
  snapshot(): ServerEvent {
    return { type: 'snapshot', locations: this.visibleLocations() };
  }

  /**
   * Шаг «жизни»: Витя идёт к тебе, Дима — тоже (по маршруту). Вызывается раз в несколько секунд,
   * чтобы на карте было видно движение в реальном времени.
   */
  tick(): void {
    const t = this.now();
    for (const id of ['demo-vitya', 'demo-dima']) {
      const friend = this.friend(id);
      const distance = distanceMeters(friend.position, this.myPosition);
      if (distance < 80) continue;
      const step = Math.min(1, 25 / distance);
      friend.position = {
        lat: friend.position.lat + (this.myPosition.lat - friend.position.lat) * step,
        lng: friend.position.lng + (this.myPosition.lng - friend.position.lng) * step,
      };
      friend.updatedAt = t;
      this.emit({ type: 'location', userId: id, location: this.visible(friend)! });
    }
    const route = this.routes.find((r) => r.id === 'demo-route-dima' && !r.endedAt);
    if (route) {
      const distance = distanceMeters(this.friend('demo-dima').position, this.myPosition);
      route.distanceM = Math.round(distance);
      route.etaAt = new Date(t + estimateEtaSec(distance, 'walk') * 1000).toISOString();
      this.emit({ type: 'route.updated', routeId: route.id });
    }
  }

  async handle(method: string, path: string, body: unknown): Promise<unknown> {
    const b = (body ?? {}) as Record<string, unknown>;
    const route = `${method} ${path}`;
    let m: RegExpMatchArray | null;

    // --- Профиль ---
    if (route === 'GET /v1/me') return clone(this.me);
    if (route === 'PATCH /v1/me') {
      if (typeof b.displayName === 'string') this.me.displayName = b.displayName;
      if (typeof b.username === 'string') this.me.username = b.username;
      return clone(this.me);
    }
    if (route === 'PUT /v1/me/ghost') {
      this.me.ghostUntil = typeof b.until === 'string' ? b.until : '9999-12-31T00:00:00.000Z';
      return clone(this.me);
    }
    if (route === 'DELETE /v1/me/ghost') {
      this.me.ghostUntil = null;
      return clone(this.me);
    }
    if ((m = route.match(/^GET \/v1\/users\/by-username\/(.+)$/))) {
      const name = decodeURIComponent(m[1]!).toLowerCase();
      const found = [...this.incoming, ...this.friends.map((f) => f.profile)].find((p) => p.username === name);
      if (found) return clone(found);
      if (name.length >= 3) return profile(`demo-${name}`, name, name);
      throw new ApiError(404, 'user_not_found');
    }

    // --- Друзья ---
    if (route === 'GET /v1/friends') return { friends: this.friendList() };
    if (route === 'GET /v1/friends/requests') return clone({ incoming: this.incoming, outgoing: this.outgoing });
    if (route === 'GET /v1/friends/locations') return { locations: this.visibleLocations() };
    if (route === 'POST /v1/friends/requests') {
      const id = String(b.userId);
      const fromIncoming = this.incoming.find((p) => p.id === id);
      if (fromIncoming) return this.acceptRequest(fromIncoming);
      if (!this.outgoing.some((p) => p.id === id)) {
        const name = id.replace(/^demo-/, '');
        this.outgoing.push(profile(id, name, name));
      }
      return { status: 'pending' };
    }
    if ((m = route.match(/^POST \/v1\/friends\/requests\/([^/]+)\/accept$/))) {
      const request = this.incoming.find((p) => p.id === m![1]);
      if (!request) throw new ApiError(404, 'request_not_found');
      this.acceptRequest(request);
      return { status: 'accepted' };
    }
    if ((m = route.match(/^DELETE \/v1\/friends\/requests\/([^/]+)$/))) {
      this.incoming = this.incoming.filter((p) => p.id !== m![1]);
      this.outgoing = this.outgoing.filter((p) => p.id !== m![1]);
      return undefined;
    }
    if ((m = route.match(/^PATCH \/v1\/friends\/([^/]+)$/))) {
      const friend = this.friend(m[1]!);
      if (b.precision === 'exact' || b.precision === 'approx' || b.precision === 'hidden') friend.sharing = b.precision;
      if (typeof b.isClose === 'boolean') friend.isClose = b.isClose;
      return { userId: friend.profile.id, isClose: friend.isClose, sharing: { precision: friend.sharing } };
    }
    if ((m = route.match(/^DELETE \/v1\/friends\/([^/]+)$/)) || (m = route.match(/^POST \/v1\/blocks\/([^/]+)$/))) {
      const id = m[1]!;
      this.friend(id);
      this.friends = this.friends.filter((f) => f.profile.id !== id);
      this.emit({ type: 'friend.removed', userId: id });
      return undefined;
    }

    // --- Геолокация ---
    if (route === 'POST /v1/location') {
      const points = (b.points ?? []) as LocationPoint[];
      const last = points[points.length - 1];
      if (last) this.setMyPosition({ lat: last.lat, lng: last.lng });
      return { accepted: points.length, rejected: 0 };
    }

    // --- Дом и работа ---
    if (route === 'GET /v1/me/places') return clone(this.places);
    if ((m = route.match(/^PUT \/v1\/me\/places\/(home|work)$/))) {
      const kind = m[1] as PlaceKind;
      this.places.places = this.places.places.filter((p) => p.kind !== kind);
      this.places.places.push({ kind, lat: Number(b.lat), lng: Number(b.lng), radiusM: Number(b.radiusM ?? 150) });
      return clone(this.places);
    }
    if ((m = route.match(/^DELETE \/v1\/me\/places\/(home|work)$/))) {
      this.places.places = this.places.places.filter((p) => p.kind !== m![1]);
      return clone(this.places);
    }
    if (route === 'PUT /v1/me/places-visibility') {
      this.places.visibility = b.visibility as MyPlaces['visibility'];
      return clone(this.places);
    }

    // --- Сборы ---
    if (route === 'GET /v1/gatherings') {
      return {
        gatherings: clone(
          this.gatherings.filter(
            (g) => g.status === 'active' && this.mine(g)?.rsvp !== 'declined',
          ),
        ),
      };
    }
    if (route === 'POST /v1/gatherings') return clone(this.createGathering(b));
    if ((m = route.match(/^GET \/v1\/gatherings\/([^/]+)$/))) return clone(this.gathering(m[1]!));
    if ((m = route.match(/^PATCH \/v1\/gatherings\/([^/]+)$/))) {
      const g = this.gathering(m[1]!);
      if (typeof b.title === 'string') g.title = b.title;
      if (typeof b.startsAt === 'string') g.startsAt = b.startsAt;
      if (typeof b.lat === 'number' && typeof b.lng === 'number') Object.assign(g, { lat: b.lat, lng: b.lng });
      if (b.placeName !== undefined) g.placeName = (b.placeName as string | null) ?? null;
      return clone(g);
    }
    if ((m = route.match(/^POST \/v1\/gatherings\/([^/]+)\/close$/))) {
      const g = this.gathering(m[1]!);
      g.status = 'closed';
      return clone(g);
    }
    if ((m = route.match(/^PUT \/v1\/gatherings\/([^/]+)\/me$/))) {
      const g = this.gathering(m[1]!);
      this.applyMyStatus(g, this.mine(g)!, b);
      return clone(g);
    }

    // --- Маршрут до друга ---
    if (route === 'GET /v1/routes') {
      const t = this.now();
      return { routes: clone(this.routes.filter((r) => !r.endedAt && Date.parse(r.expiresAt) > t)) };
    }
    if (route === 'POST /v1/routes') return clone(this.startRoute(String(b.targetId), (b.mode as 'walk') ?? 'walk'));
    if ((m = route.match(/^GET \/v1\/routes\/([^/]+)$/))) return clone(this.route(m[1]!));
    if ((m = route.match(/^PATCH \/v1\/routes\/([^/]+)$/))) {
      const r = this.route(m[1]!);
      r.etaAt = new Date(this.now() + Number(b.etaSec) * 1000).toISOString();
      r.distanceM = Math.round(Number(b.distanceM));
      return clone(r);
    }
    if ((m = route.match(/^POST \/v1\/routes\/([^/]+)\/stop$/))) {
      const r = this.route(m[1]!);
      r.endedAt = new Date(this.now()).toISOString();
      r.endReason = b.reason === 'arrived' ? 'arrived' : 'stopped';
      return clone(r);
    }

    // --- SOS ---
    if (route === 'GET /v1/sos') {
      if (this.sos.active && Date.parse(this.sos.active.expiresAt) <= this.now()) this.sos.active = null;
      return clone(this.sos);
    }
    if (route === 'PUT /v1/sos/contacts') {
      const contacts = (b.contacts ?? []) as ({ userId: string } | { phone: string; name: string })[];
      this.sos.contacts = contacts.map(
        (c, i): SosContact =>
          'userId' in c
            ? { position: i + 1, user: this.friend(c.userId).profile, phone: null, name: null }
            : { position: i + 1, user: null, phone: c.phone, name: c.name },
      );
      return { contacts: clone(this.sos.contacts) };
    }
    if (route === 'PUT /v1/sos/pin') {
      if (this.sos.hasPin && b.currentPin !== this.sosPin) throw new ApiError(403, 'wrong_pin');
      this.sosPin = String(b.pin);
      this.sos.hasPin = true;
      return undefined;
    }
    if (route === 'POST /v1/sos') {
      if (this.sos.active) throw new ApiError(409, 'sos_already_active');
      const t = this.now();
      this.sos.active = {
        id: `demo-sos-${++this.counter}`,
        isTest: Boolean(b.test),
        startedAt: new Date(t).toISOString(),
        expiresAt: new Date(t + 15 * MINUTE).toISOString(),
      };
      // Ссылка ненастоящая: в демо SMS никуда не уходят.
      return { session: clone(this.sos.active), url: 'https://blink.example/s/demo', smsFailed: 0 };
    }
    if (route === 'POST /v1/sos/extend') {
      if (!this.sos.active) throw new ApiError(404, 'sos_not_active');
      const expires = Math.max(Date.parse(this.sos.active.expiresAt), this.now()) + 15 * MINUTE;
      this.sos.active.expiresAt = new Date(expires).toISOString();
      return clone(this.sos.active);
    }
    if (route === 'POST /v1/sos/cancel') {
      if (!this.sos.active) throw new ApiError(404, 'sos_not_active');
      if (b.pin !== this.sosPin) throw new ApiError(403, 'wrong_pin');
      this.sos.active = null;
      return undefined;
    }
    if (route === 'POST /v1/auth/logout') return undefined;

    throw new ApiError(404, 'not_found', `demo: ${route}`);
  }

  // --- Внутреннее ---

  private emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private friend(id: string): DemoFriend {
    const friend = this.friends.find((f) => f.profile.id === id);
    if (!friend) throw new ApiError(404, 'friend_not_found');
    return friend;
  }

  private visible(friend: DemoFriend): VisibleLocation | null {
    const base = { lat: friend.position.lat, lng: friend.position.lng, battery: friend.battery, ts: friend.updatedAt };
    if (friend.visibleAs === 'approx') {
      // Как на сервере: примерная позиция — без скорости и с грубой точностью.
      const round = (v: number) => Math.round(v * 50) / 50;
      return {
        ...base,
        lat: round(base.lat),
        lng: round(base.lng),
        accuracy: 1500,
        precision: 'approx',
        ...(friend.place ? { place: friend.place } : {}),
      };
    }
    return { ...base, accuracy: 10, speed: 1.3, precision: 'exact' };
  }

  private visibleLocations(): { userId: string; location: VisibleLocation }[] {
    return this.friends.flatMap((f) => {
      const location = this.visible(f);
      return location ? [{ userId: f.profile.id, location }] : [];
    });
  }

  private friendList(): Friend[] {
    return this.friends.map((f) => ({
      ...clone(f.profile),
      isClose: f.isClose,
      sharing: { precision: f.sharing },
      location: this.visible(f),
    }));
  }

  private acceptRequest(request: PublicProfile): { status: 'accepted' } {
    this.incoming = this.incoming.filter((p) => p.id !== request.id);
    this.friends.push({
      profile: request,
      isClose: false,
      sharing: 'exact',
      visibleAs: 'exact',
      position: { lat: this.myPosition.lat - 0.006, lng: this.myPosition.lng - 0.004 },
      battery: 77,
      updatedAt: this.now(),
    });
    this.emit({ type: 'friend.added', userId: request.id });
    this.emit({ type: 'snapshot', locations: this.visibleLocations() });
    return { status: 'accepted' };
  }

  /**
   * Первая настоящая позиция (или переезд дальше 20 км) переносит весь демо-мир к пользователю:
   * друзья и места сбора оказываются рядом, где бы ни показывали приложение.
   */
  private setMyPosition(position: LatLng): void {
    const shouldRebase = !this.located || distanceMeters(position, this.myPosition) > REBASE_DISTANCE_M;
    if (shouldRebase) {
      const dLat = position.lat - this.myPosition.lat;
      const dLng = position.lng - this.myPosition.lng;
      for (const f of this.friends) f.position = { lat: f.position.lat + dLat, lng: f.position.lng + dLng };
      for (const g of this.gatherings) Object.assign(g, { lat: g.lat + dLat, lng: g.lng + dLng });
    }
    this.myPosition = position;
    this.located = true;
    if (shouldRebase) this.emit(this.snapshot());
  }

  private mine(g: Gathering): Participant | undefined {
    return g.participants.find((p) => p.user.id === this.me.id);
  }

  private gathering(id: string): Gathering {
    const g = this.gatherings.find((x) => x.id === id);
    if (!g) throw new ApiError(404, 'gathering_not_found');
    return g;
  }

  private createGathering(b: Record<string, unknown>): Gathering {
    const t = new Date(this.now()).toISOString();
    const ids = (b.participantIds ?? []) as string[];
    const invited = ids.map((id) => this.friend(id).profile);
    const g: Gathering = {
      id: `demo-gathering-${++this.counter}`,
      ownerId: this.me.id,
      title: String(b.title),
      lat: Number(b.lat),
      lng: Number(b.lng),
      placeName: (b.placeName as string | undefined) ?? null,
      startsAt: String(b.startsAt),
      status: 'active',
      participants: [this.me, ...invited].map((user, i) => ({
        user: clone(user),
        // В демо друзья отвечают сразу: первый идёт, остальные думают.
        rsvp: i === 0 || i === 1 ? 'going' : 'pending',
        chip: i === 1 ? 'leaving' : null,
        comment: null,
        etaAt: null,
        etaSource: null,
        arrivedAt: null,
        updatedAt: t,
      })),
    };
    this.gatherings.unshift(g);
    return g;
  }

  private applyMyStatus(g: Gathering, p: Participant, b: Record<string, unknown>): void {
    const t = this.now();
    if (b.comment !== undefined) p.comment = (b.comment as string | null) ?? null;
    if (b.rsvp === 'going' || b.rsvp === 'declined') p.rsvp = b.rsvp;
    if (p.rsvp === 'declined') {
      Object.assign(p, { chip: null, etaAt: null, etaSource: null, arrivedAt: null });
    } else {
      if (b.chip !== undefined) {
        p.chip = (b.chip as Participant['chip']) ?? null;
        if (p.chip) p.rsvp = 'going';
        if (p.chip === 'arrived') Object.assign(p, { arrivedAt: new Date(t).toISOString(), etaAt: null, etaSource: null });
        else p.arrivedAt = null;
        if (p.chip === 'late' && b.etaMinutes === undefined) {
          p.etaAt = new Date(Date.parse(g.startsAt) + 10 * MINUTE).toISOString();
          p.etaSource = 'manual';
        }
      }
      if (typeof b.etaMinutes === 'number') {
        Object.assign(p, {
          rsvp: 'going',
          etaAt: new Date(t + b.etaMinutes * MINUTE).toISOString(),
          etaSource: 'manual',
          arrivedAt: null,
        });
      }
      // «Иду» без своего времени — считаем по расстоянию, как авто-ETA на сервере.
      if (p.rsvp === 'going' && !p.etaAt && !p.arrivedAt) {
        const eta = estimateEtaSec(distanceMeters(this.myPosition, g), 'walk');
        Object.assign(p, { etaAt: new Date(t + eta * 1000).toISOString(), etaSource: 'auto' });
      }
    }
    p.updatedAt = new Date(t).toISOString();
  }

  private route(id: string): RouteSession {
    const r = this.routes.find((x) => x.id === id);
    if (!r) throw new ApiError(404, 'route_not_found');
    return r;
  }

  private startRoute(targetId: string, mode: 'walk' | 'drive'): RouteSession {
    const target = this.friend(targetId);
    const t = this.now();
    for (const r of this.routes) {
      if (r.requester.id === this.me.id && r.target.id === targetId && !r.endedAt) {
        r.endedAt = new Date(t).toISOString();
        r.endReason = 'stopped';
      }
    }
    const session: RouteSession = {
      id: `demo-route-${++this.counter}`,
      requester: clone(this.me),
      target: clone(target.profile),
      mode,
      etaAt: null,
      distanceM: null,
      startedAt: new Date(t).toISOString(),
      expiresAt: new Date(t + 60 * MINUTE).toISOString(),
      endedAt: null,
      endReason: null,
    };
    this.routes.push(session);
    return session;
  }
}
