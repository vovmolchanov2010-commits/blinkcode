import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type SocketLike } from '../src/lib/realtime';
import type { ServerEvent } from '../src/lib/types';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // Помощники для теста
  open() {
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  drop() {
    this.onclose?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(getUrl: () => Promise<string | null> = async () => 'ws://x?token=t') {
  const sockets: FakeSocket[] = [];
  const events: ServerEvent[] = [];
  const statuses: string[] = [];
  const client = new RealtimeClient({
    getUrl,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    backoffMs: () => 1000,
    pingIntervalMs: 5000,
  });
  return { client, sockets, events, statuses };
}

describe('RealtimeClient', () => {
  it('connects and forwards server events', async () => {
    const { client, sockets, events, statuses } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);

    sockets[0]!.open();
    sockets[0]!.receive({ type: 'location.removed', userId: 'u2' });
    expect(events).toEqual([{ type: 'location.removed', userId: 'u2' }]);
    expect(statuses).toEqual(['connecting', 'open']);
    client.stop();
  });

  it('reconnects with a fresh URL after the connection drops', async () => {
    let n = 0;
    const { client, sockets } = setup(async () => `ws://x?token=t${++n}`);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();
    sockets[0]!.drop();

    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.map((s) => s.url)).toEqual(['ws://x?token=t1', 'ws://x?token=t2']);
    client.stop();
  });

  it('retries when getting the URL fails (e.g. offline refresh)', async () => {
    let fail = true;
    const { client, sockets } = setup(async () => {
      if (fail) throw new Error('offline');
      return 'ws://x';
    });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);

    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);
    client.stop();
  });

  it('stops when there is no session', async () => {
    const { client, sockets, statuses } = setup(async () => null);
    client.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sockets).toHaveLength(0);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('pings periodically and does not reconnect after stop()', async () => {
    const { client, sockets } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.open();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: 'ping' }), JSON.stringify({ type: 'ping' })]);

    client.stop();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
  });

  it('reconnects immediately on demand while waiting', async () => {
    const { client, sockets } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.drop();

    client.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
    client.stop();
  });
});
