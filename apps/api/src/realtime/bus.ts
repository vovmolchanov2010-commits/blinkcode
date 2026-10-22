import type { Redis } from 'ioredis';
import type { VisibleLocation } from '../modules/location/privacy.js';

export type RealtimeEvent =
  | { type: 'location'; userId: string; location: VisibleLocation }
  | { type: 'location.removed'; userId: string }
  | { type: 'friend.request'; fromUserId: string }
  | { type: 'friend.added'; userId: string }
  | { type: 'friend.removed'; userId: string };

type Handler = (event: RealtimeEvent) => void;

const channelOf = (userId: string) => `rt:user:${userId}`;
const CHANNEL_PREFIX = channelOf('');

/**
 * Персональные каналы пользователей поверх Redis pub/sub: событие, опубликованное
 * на любом инстансе API, доходит до WebSocket-соединений пользователя на всех инстансах.
 */
export class Bus {
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
  ) {
    subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.handlers.get(channel.slice(CHANNEL_PREFIX.length));
      if (!handlers) return;
      const event = JSON.parse(message) as RealtimeEvent;
      for (const handler of handlers) handler(event);
    });
  }

  async publish(userId: string, event: RealtimeEvent): Promise<void> {
    await this.publisher.publish(channelOf(userId), JSON.stringify(event));
  }

  /** Подписка на канал пользователя. Возвращает функцию отписки. */
  async subscribe(userId: string, handler: Handler): Promise<() => Promise<void>> {
    let handlers = this.handlers.get(userId);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(userId, handlers);
      await this.subscriber.subscribe(channelOf(userId));
    }
    handlers.add(handler);

    const set = handlers;
    return async () => {
      set.delete(handler);
      if (set.size === 0 && this.handlers.get(userId) === set) {
        this.handlers.delete(userId);
        await this.subscriber.unsubscribe(channelOf(userId));
      }
    };
  }
}
