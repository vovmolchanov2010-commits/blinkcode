import type { ServerEvent } from './types';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

/** Минимум WebSocket, который нужен клиенту (совместим с RN и браузером). */
export interface SocketLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RealtimeOptions {
  /** Адрес со свежим токеном; null — сессии нет, подключаться не нужно. */
  getUrl: () => Promise<string | null>;
  onEvent: (event: ServerEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
  createSocket?: (url: string) => SocketLike;
  /** Задержка перед переподключением по номеру попытки. */
  backoffMs?: (attempt: number) => number;
  /** Интервал ping, чтобы прокси и мобильные сети не рвали тихое соединение. */
  pingIntervalMs?: number;
}

export const defaultBackoff = (attempt: number) => Math.min(30_000, 1_000 * 2 ** attempt);

/** WebSocket с автоматическим переподключением и свежим токеном на каждое подключение. */
export class RealtimeClient {
  private socket: SocketLike | null = null;
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RealtimeOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.options.onStatus?.('closed');
  }

  /** Переподключиться сразу (например, приложение вернулось из фона). */
  reconnectNow(): void {
    if (!this.running) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempt = 0;
      void this.connect();
    }
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.options.onStatus?.('connecting');

    let url: string | null;
    try {
      url = await this.options.getUrl();
    } catch {
      return this.scheduleReconnect();
    }
    if (!this.running) return;
    if (!url) return this.stop();

    const create = this.options.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    const socket = create(url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.options.onStatus?.('open');
      const interval = this.options.pingIntervalMs ?? 25_000;
      this.pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), interval);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      try {
        this.options.onEvent(JSON.parse(event.data) as ServerEvent);
      } catch {
        // Некорректное сообщение сервера — пропускаем.
      }
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.options.onStatus?.('closed');
    const delay = (this.options.backoffMs ?? defaultBackoff)(this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }
}
