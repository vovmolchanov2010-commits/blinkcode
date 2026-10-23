import type { Chip, Gathering, Participant, PlaceKind, RouteMode } from './types';

// Логика сборов и маршрута до друга без React — проверяется в тестах.

export const CHIP_LABEL: Record<Chip, string> = {
  leaving: 'Выхожу',
  on_the_way: 'В пути',
  stuck: 'Застрял в пробке',
  late: 'Опоздаю',
  arrived: 'На месте',
};

export const PLACE_LABEL: Record<PlaceKind, string> = { home: '🏠 Дома', work: '💼 На работе' };

const SPEED_MPS: Record<RouteMode, number> = { walk: 1.3, drive: 7 };
/** Реальный путь по улицам длиннее прямой примерно на треть. */
const DETOUR_FACTOR = 1.3;

/** Оценка времени в пути по прямой — как на сервере, пока не подключён провайдер маршрутов. */
export function estimateEtaSec(distanceM: number, mode: RouteMode): number {
  return Math.round((distanceM * DETOUR_FACTOR) / SPEED_MPS[mode]);
}

/** «~1 мин», «~25 мин», «~1 ч 10 мин». */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `~${minutes} мин`;
  const rest = minutes % 60;
  return `~${Math.floor(minutes / 60)} ч${rest ? ` ${rest} мин` : ''}`;
}

export function formatClock(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «сегодня в 20:00», «завтра в 09:30», «25.10 в 18:00». */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const day =
    dayDiff === 0
      ? 'сегодня'
      : dayDiff === 1
        ? 'завтра'
        : `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  return `${day} в ${formatClock(date)}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Время начала по умолчанию и шаги: ближайшие 15 минут через полчаса. */
export function defaultStartTime(now = new Date()): Date {
  const date = new Date(now.getTime() + 30 * 60_000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  return date;
}

/** Опаздывает — ETA позже начала больше чем на 5 минут. */
export function isLate(p: Pick<Participant, 'etaAt' | 'arrivedAt'>, startsAt: string): boolean {
  if (p.arrivedAt || !p.etaAt) return false;
  return Date.parse(p.etaAt) > Date.parse(startsAt) + 5 * 60_000;
}

export function summary(gathering: Gathering): { arrived: number; going: number; pending: number } {
  let arrived = 0;
  let going = 0;
  let pending = 0;
  for (const p of gathering.participants) {
    if (p.arrivedAt) arrived++;
    else if (p.rsvp === 'going') going++;
    else if (p.rsvp === 'pending') pending++;
  }
  return { arrived, going, pending };
}

/** Строка статуса участника: «на месте», «будет в 20:10 (по геолокации)», «не ответил». */
export function participantStatus(p: Participant, startsAt: string): string {
  if (p.rsvp === 'declined') return 'не сможет';
  if (p.arrivedAt) return 'на месте';
  if (p.rsvp === 'pending') return 'ещё не ответил(а)';
  const parts: string[] = [];
  if (p.chip) parts.push(CHIP_LABEL[p.chip].toLowerCase());
  if (p.etaAt) {
    parts.push(`будет в ${formatClock(p.etaAt)}${p.etaSource === 'auto' ? ' (по геолокации)' : ''}`);
    if (isLate(p, startsAt)) parts.push('опаздывает');
  }
  return parts.length ? parts.join(' · ') : 'идёт';
}

/** Порядок в списке: пришедшие, затем идущие по ETA, затем не ответившие и отказавшиеся. */
export function sortParticipants(list: Participant[]): Participant[] {
  const rank = (p: Participant) => (p.arrivedAt ? 0 : p.rsvp === 'going' ? 1 : p.rsvp === 'pending' ? 2 : 3);
  const eta = (p: Participant) => (p.etaAt ? Date.parse(p.etaAt) : Number.MAX_SAFE_INTEGER);
  return [...list].sort((a, b) => rank(a) - rank(b) || eta(a) - eta(b));
}

/** Расстояние, на котором считаем, что друзья встретились. */
export const MEET_RADIUS_M = 50;
/** Как часто идущий отправляет ETA другу. */
export const ROUTE_ETA_INTERVAL_MS = 30_000;

/** Ссылка на маршрут в Яндекс Картах (откроет приложение, если оно установлено). */
export function yandexRouteUrl(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number },
  mode: RouteMode,
): string {
  const rtext = `${from ? `${from.lat},${from.lng}` : ''}~${to.lat},${to.lng}`;
  return `https://yandex.ru/maps/?rtext=${rtext}&rtt=${mode === 'walk' ? 'pd' : 'auto'}`;
}
