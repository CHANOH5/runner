import {
  AppConfig,
  ConsentStatus,
  ConsentsReq,
  DeleteMeReq,
  DeviceReq,
  Me,
  NotificationSettingsPatch,
  NotificationSettingsRes,
  PrivacySettings,
  PrivacySettingsPatch,
  ProfilePatch,
} from '@berun/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { appConfigs, userConsents } from '../../db/schema/index.js';
import { deviceFrom } from '../../lib/device.js';
import { validationFailed } from '../../lib/errors.js';
import { requireUserId } from '../../plugins/auth.js';
import { deleteAccount } from './delete-account.js';
import { buildMe } from './me.js';
import {
  clearDevicePush,
  getConsents,
  getNotificationSettings,
  getPrivacy,
  updateNotificationSettings,
  updatePrivacy,
  updateProfile,
  upsertDevice,
} from './settings.js';
import { currentTerms } from './terms.js';

/**
 * 내 정보·동의·앱 설정 (tech/06 6.1, 6.3).
 * 구현: GET /app-config, GET /me, PATCH /me/profile, GET/PATCH /me/privacy, GET/PATCH /me/notification-settings,
 *       GET/POST /me/consents, PUT/DELETE /me/device, DELETE /me
 * 약관 재동의 게이트 예외: GET /me, GET/POST /me/consents, DELETE /me (tech/06 2.2)
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
          'privacy_policy_url',
        ]),
      );
    const get = (k: string) => rows.find((row) => row.key === k)?.value;
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
    const maintenance = AppConfig.shape.maintenance.safeParse(get('maintenance'));
    const email = AppConfig.shape.supportEmail.safeParse(get('support_email') ?? null);
    const privacy = AppConfig.shape.privacyPolicyUrl.safeParse(get('privacy_policy_url') ?? null);
    return reply.header('cache-control', 'public, max-age=300').send({
      minNativeVersion: {
        ios: str(get('min_native_version_ios'), '0.0.0'),
        android: str(get('min_native_version_android'), '0.0.0'),
      },
      maintenance: maintenance.success ? maintenance.data : { active: false, until: null },
      supportEmail: email.success ? email.data : null,
      // 값이 없거나(개발 환경) 형식이 틀리면 null → 앱은 "개인정보 수집·이용 동의" 전문을 연다 (PRD v1.11 4.2)
      privacyPolicyUrl: privacy.success ? privacy.data : null,
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

  const user = [app.authenticate, app.termsGate];

  r.patch(
    '/me/profile',
    { onRequest: user, schema: { body: ProfilePatch, response: { 200: Me } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await updateProfile(app.db, requireUserId(request), request.body)),
  );

  // 공개 범위 (P-PRI-03). 다른 사용자에게 보이는 화면은 Phase 2 — 값만 저장한다
  r.get(
    '/me/privacy',
    { onRequest: user, schema: { response: { 200: PrivacySettings } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getPrivacy(app.db, requireUserId(request))),
  );

  r.patch(
    '/me/privacy',
    { onRequest: user, schema: { body: PrivacySettingsPatch, response: { 200: PrivacySettings } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await updatePrivacy(app.db, requireUserId(request), request.body)),
  );

  r.get(
    '/me/notification-settings',
    { onRequest: user, schema: { response: { 200: NotificationSettingsRes } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getNotificationSettings(app.db, requireUserId(request))),
  );

  r.patch(
    '/me/notification-settings',
    {
      onRequest: user,
      schema: { body: NotificationSettingsPatch, response: { 200: NotificationSettingsRes } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await updateNotificationSettings(app.db, requireUserId(request), request.body)),
  );

  r.get(
    '/me/consents',
    { onRequest: app.authenticate, schema: { response: { 200: ConsentStatus } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getConsents(app.db, requireUserId(request))),
  );

  const requireDeviceId = (request: Parameters<typeof deviceFrom>[0]) => {
    const { deviceId } = deviceFrom(request);
    if (!deviceId) throw validationFailed([{ path: 'x-device-id', code: 'required' }]);
    return deviceId;
  };

  r.put('/me/device', { onRequest: user, schema: { body: DeviceReq } }, async (request, reply) => {
    await upsertDevice(app.db, requireUserId(request), requireDeviceId(request), request.body);
    return reply.status(204).send();
  });

  r.delete('/me/device', { onRequest: user }, async (request, reply) => {
    await clearDevicePush(app.db, requireUserId(request), requireDeviceId(request));
    return reply.status(204).send();
  });

  // 탈퇴는 약관 재동의 전에도 할 수 있어야 한다 (게이트 예외, P-ACC-04)
  r.delete(
    '/me',
    { onRequest: app.authenticate, schema: { body: DeleteMeReq } },
    async (request, reply) => {
      await deleteAccount(app.db, requireUserId(request), request.body);
      return reply.status(204).send();
    },
  );
}
