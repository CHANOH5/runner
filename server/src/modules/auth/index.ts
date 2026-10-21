import {
  NicknameAvailability,
  NicknameAvailabilityQuery,
  RefreshReq,
  SignupReq,
  SignupRes,
  SocialLoginReq,
  SocialLoginRes,
  TermsCurrent,
  TokenPair,
  type TermsKind,
} from '@berun/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { deviceFrom } from '../../lib/device.js';
import { AppError } from '../../lib/errors.js';
import { toKstIso } from '../../lib/time.js';
import { bearerToken, requireUserId } from '../../plugins/auth.js';
import { currentTerms } from '../users/terms.js';
import {
  abortSignup,
  nicknameAvailability,
  requireSignupSession,
  signup,
  socialLogin,
  type AuthDeps,
} from './service.js';

/**
 * 인증·가입 (tech/06 6.2, F-001~F-003). 약관 재동의 게이트 예외 경로.
 * TODO: 요청 제한 20회/분 (tech/06 8장)
 */
export default async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const deps = (): AuthDeps => ({
    db: app.db,
    redis: app.redis,
    tokens: app.tokens,
    verifiers: app.verifiers,
    cipher: app.cipher,
  });
  const signupTokenOf = (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) throw new AppError('UNAUTHENTICATED', 'missing signup token');
    return token;
  };

  r.post(
    '/auth/social',
    { schema: { body: SocialLoginReq, response: { 200: SocialLoginRes } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await socialLogin(deps(), request.body, deviceFrom(request))),
  );

  r.get('/terms/current', { schema: { response: { 200: TermsCurrent } } }, async () =>
    (await currentTerms(app.db)).map((t) => ({
      id: t.id,
      kind: t.kind as TermsKind,
      version: t.version,
      required: t.required,
      contentUrl: t.contentUrl,
      effectiveAt: toKstIso(t.effectiveAt),
    })),
  );

  // 인증: 가입 토큰 또는 사용자 access token (JWT는 점이 있다)
  r.get(
    '/nicknames/availability',
    {
      schema: { querystring: NicknameAvailabilityQuery, response: { 200: NicknameAvailability } },
    },
    async (request) => {
      const token = bearerToken(request);
      let exceptUserId: string | undefined;
      if (token?.includes('.')) {
        await app.authenticate(request);
        exceptUserId = requireUserId(request);
      } else {
        await requireSignupSession(app.redis, signupTokenOf(request));
      }
      return { result: await nicknameAvailability(app.db, request.query.nickname, exceptUserId) };
    },
  );

  r.post(
    '/auth/signup',
    { schema: { body: SignupReq, response: { 201: SignupRes } } },
    async (request, reply) => {
      const res = await signup(deps(), signupTokenOf(request), request.body, deviceFrom(request));
      return reply.status(201).header('cache-control', 'no-store').send(res);
    },
  );

  r.post('/auth/signup/abort', async (request, reply) => {
    await abortSignup(deps(), signupTokenOf(request));
    return reply.status(204).send();
  });

  r.post(
    '/auth/refresh',
    { schema: { body: RefreshReq, response: { 200: TokenPair } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await app.tokens.rotate(app.db, request.body.refreshToken)),
  );

  r.post('/auth/logout', { onRequest: app.authenticate }, async (request, reply) => {
    await app.tokens.revoke(app.db, request.auth!.sessionId, requireUserId(request));
    return reply.status(204).send();
  });
}
