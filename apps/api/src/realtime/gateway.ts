import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { locationBatchSchema } from '../modules/location/service.js';

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('location'), points: locationBatchSchema }),
]);

/**
 * WebSocket `/v1/ws?token=<access token>`.
 *
 * Сервер → клиент: `snapshot` с позициями друзей при подключении, затем события
 * шины (`location`, `location.removed`, `friend.*`), ответы `pong`, `location.ack`, `error`.
 * Клиент → сервер: `ping`, `location` (пачка точек, как в POST /v1/location).
 */
export function registerGateway(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/v1/ws',
    {
      websocket: true,
      // Браузеры не умеют ставить заголовки на WebSocket, поэтому токен — в query.
      preValidation: async (req) => {
        const { token } = (req.query ?? {}) as { token?: string };
        try {
          req.user = app.jwt.verify(token ?? '');
        } catch {
          throw new HttpError(401, 'unauthorized');
        }
      },
    },
    (socket: WebSocket, req) => {
      const userId = req.user.sub;
      const send = (message: object) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };

      let unsubscribe: (() => Promise<void>) | null = null;
      let closed = false;
      socket.on('close', () => {
        closed = true;
        void unsubscribe?.();
      });

      socket.on('message', (raw: RawData) => {
        void handleMessage(raw).catch((err) => {
          req.log.error(err);
          send({ type: 'error', error: 'internal_error' });
        });
      });

      async function handleMessage(raw: RawData) {
        let data: unknown;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return send({ type: 'error', error: 'invalid_json' });
        }
        const parsed = clientMessageSchema.safeParse(data);
        if (!parsed.success) return send({ type: 'error', error: 'validation_error' });

        const message = parsed.data;
        if (message.type === 'ping') return send({ type: 'pong' });
        const result = await ctx.location.ingest(userId, message.points);
        send({ type: 'location.ack', ...result });
      }

      void (async () => {
        const unsub = await ctx.bus.subscribe(userId, send);
        if (closed) return unsub();
        unsubscribe = unsub;
        send({ type: 'snapshot', locations: await ctx.location.visibleFor(userId) });
      })().catch((err) => {
        req.log.error(err);
        socket.close(1011, 'internal_error');
      });
    },
  );
}
