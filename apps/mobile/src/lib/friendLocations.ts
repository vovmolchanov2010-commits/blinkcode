import type { ServerEvent, VisibleLocation } from './types';

export type FriendLocations = Readonly<Record<string, VisibleLocation>>;

/** Применяет событие сервера к карте «друг → видимая позиция». */
export function applyEvent(state: FriendLocations, event: ServerEvent): FriendLocations {
  switch (event.type) {
    case 'snapshot':
      return Object.fromEntries(event.locations.map((l) => [l.userId, l.location]));
    case 'location': {
      const current = state[event.userId];
      // События могут прийти не по порядку — старую точку не применяем.
      if (current && current.ts > event.location.ts) return state;
      return { ...state, [event.userId]: event.location };
    }
    case 'location.removed':
    case 'friend.removed': {
      if (!(event.userId in state)) return state;
      const { [event.userId]: _removed, ...rest } = state;
      return rest;
    }
    default:
      return state;
  }
}
