import { AppConfig, ConsentsReq, Me } from '@berun/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { appConfigs, userConsents } from '../../db/schema/index.js';
import { validationFailed } from '../../lib/errors.js';
import { requireUserId } from '../../plugins/auth.js';
import { buildMe } from './me.js';
import { currentTerms } from './terms.js';

/**
 * 내 정보·동의·앱 설정 (tech/06 6.1, 6.3).
 * 구현: GET /app-config, GET /me, POST /me/consents (약관 재동의 게이트 예외 경로)
 * 남은 것: PATCH /me/profile, GET /me/consents, GET/PATCH /me/notification-settings, PUT /me/device, DELETE /me
 */
export default async function userRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/app-config', { schema: { response: { 200: AppConfig } } }, async (_request, reply) => {
    const rows = await app.db
      .select()
      .from(appConfigs)
      .where(
        inArray(appConfigs.key, [
          'min_native_version_ios',
          'min_native_version_android',
          'maintenance',
          'support_email',
        ]),
      );
    const get = (k: string) => rows.find((row) => row.key === k)?.value;
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
    const maintenance = AppConfig.shape.maintenance.safeParse(get('maintenance'));
    const email = AppConfig.shape.supportEmail.safeParse(get('support_email') ?? null);
    return reply.header('cache-control', 'public, max-age=300').send({
      minNativeVersion: {
        ios: str(get('min_native_version_ios'), '0.0.0'),
        android: str(get('min_native_version_android'), '0.0.0'),
      },
      maintenance: maintenance.success ? maintenance.data : { active: false, until: null },
      supportEmail: email.success ? email.data : null,
    });
  });

  r.get(
    '/me',
    { onRequest: app.authenticate, schema: { response: { 200: Me } } },
    async (request, reply) =>
      reply.header('cache-control', 'no-store').send(await buildMe(app.db, requireUserId(request))),
  );

  // 재동의 (필수 약관 새 버전). 현재 시행 버전만 받는다
  r.post(
    '/me/consents',
    { onRequest: app.authenticate, schema: { body: ConsentsReq } },
    async (request, reply) => {
      const userId = requireUserId(request);
      const current = new Set((await currentTerms(app.db)).map((t) => t.id));
      const fieldErrors = request.body.agreedTermIds.flatMap((id, i) =>
        current.has(id) ? [] : [{ path: `agreedTermIds[${i}]`, code: 'invalid_value' }],
      );
      if (fieldErrors.length) throw validationFailed(fieldErrors);
      await app.db.insert(userConsents).values(
        [...new Set(request.body.agreedTermIds)].map((termsVersionId) => ({
          userId,
          termsVersionId,
          action: 'agree',
        })),
      );
      return reply.status(204).send();
    },
  );
}
