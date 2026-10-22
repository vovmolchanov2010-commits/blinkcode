import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../../errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

export function registerAuthenticate(app: FastifyInstance): void {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'unauthorized');
    }
  });
}

export function currentUserId(req: FastifyRequest): string {
  return req.user.sub;
}
