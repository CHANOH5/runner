import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { importSPKI, jwtVerify, type CryptoKey } from 'jose';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { pendingRequiredTerms } from '../modules/users/terms.js';

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
    /**
     * 약관 재동의 게이트 (tech/06 2.2). authenticate 뒤에 둔다. 예외 라우트(/auth/*, GET /me,
     * POST /me/consents, /app-config 등)는 이 훅을 붙이지 않는다.
     */
    termsGate: (request: FastifyRequest) => Promise<void>;
  }
}

const AccessClaims = z.object({ sub: z.uuid(), sid: z.uuid() });

const unauthenticated = (message: string) => new AppError('UNAUTHENTICATED', message);

/**
 * access token(JWT, ES256) 검증. 발급은 modules/auth/tokens.ts.
 * 매 요청 users.status·세션 폐기를 확인하지 않는다 (15분 지연 허용, tech/06 2.1).
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

    app.decorate('termsGate', async (request: FastifyRequest) => {
      const userId = requireUserId(request);
      const pending = await pendingRequiredTerms(app.db, userId);
      if (pending.length > 0) {
        throw new AppError('TERMS_REQUIRED', 'required terms must be agreed again', {
          details: { kinds: pending.map((t) => t.kind) },
        });
      }
    });
  },
  { name: 'auth' },
);

/** `Authorization: Bearer {token}`의 토큰 (가입 토큰 등). 없으면 null */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

/** authenticate를 거친 라우트에서 사용자 id를 꺼낸다 */
export function requireUserId(request: FastifyRequest): string {
  if (!request.auth) throw unauthenticated('not authenticated');
  return request.auth.userId;
}
