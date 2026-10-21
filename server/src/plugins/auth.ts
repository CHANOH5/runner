import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { importSPKI, jwtVerify, type CryptoKey } from 'jose';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

export type AuthContext = {
  userId: string;
  /** auth_sessions.id */
  sessionId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    /** authenticate preHandler를 거친 라우트에서만 값이 있다 */
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** 사용자 access token 검증 preHandler (tech/06 2.1) */
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

const AccessClaims = z.object({ sub: z.uuid(), sid: z.uuid() });

const unauthenticated = (message: string) => new AppError('UNAUTHENTICATED', message);

/**
 * access token(JWT, ES256) 검증 골격. 발급(/auth/*)은 소셜 로그인 작업에서 만든다.
 * TODO(T-auth): 약관 재동의 게이트(403 TERMS_REQUIRED), X-App-Version 최소 버전(426) 검사
 */
export const authPlugin = fp<{ publicKeyPem: string | undefined }>(
  async (app: FastifyInstance, opts) => {
    const key: CryptoKey | null = opts.publicKeyPem
      ? await importSPKI(opts.publicKeyPem, 'ES256')
      : null;
    if (!key) app.log.warn('JWT_PUBLIC_KEY not set — authenticated routes will always return 401');

    app.decorateRequest('auth', null);
    app.decorate('authenticate', async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthenticated('missing bearer token');
      if (!key) throw unauthenticated('token verification is not configured');

      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(header.slice('Bearer '.length), key, {
          algorithms: ['ES256'],
          requiredClaims: ['sub', 'exp', 'iat'],
        }));
      } catch {
        throw unauthenticated('invalid or expired token');
      }
      const claims = AccessClaims.safeParse(payload);
      if (!claims.success) throw unauthenticated('invalid token claims');
      request.auth = { userId: claims.data.sub, sessionId: claims.data.sid };
    });
  },
  { name: 'auth' },
);

/** authenticate를 거친 라우트에서 사용자 id를 꺼낸다 */
export function requireUserId(request: FastifyRequest): string {
  if (!request.auth) throw unauthenticated('not authenticated');
  return request.auth.userId;
}
