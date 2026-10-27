import cookie from '@fastify/cookie';
import {
  AdminAccount,
  AdminAppConfig,
  AdminAppConfigPutReq,
  AdminCreateReq,
  AdminCreateRes,
  AdminLoginReq,
  AdminLoginRes,
  AdminSessionInfo,
  AdminMfaReq,
  AdminMfaRes,
  AdminNotice,
  AdminNoticeInput,
  AdminNoticeListQuery,
  AdminNoticePage,
  NoticeAudience,
  NoticeTestReq,
  AdminPatchReq,
  AdminRace,
  AdminRaceDraftInput,
  AdminRaceInput,
  AdminRaceListQuery,
  AdminRacePage,
  AdminRaceSaveRes,
  AdminReportDetail,
  AdminReportListQuery,
  AdminReportPage,
  CloneReq,
  CloneRes,
  DedupeWarning,
  DuplicatesQuery,
  HideReq,
  AppConfigKey,
  Id,
  Impact,
  ResolveReportsReq,
} from '@berun/shared';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { adminUsers } from '../../db/schema/index.js';
import { listAppConfigs, putAppConfig } from './app-configs-service.js';
import { adminLogin, adminVerifyMfa, createAdmin, patchAdmin, toAccount } from './auth-service.js';
import { OWNER, READERS, registerAuditLog, requireAdmin, WRITERS } from './guard.js';
import {
  cloneRace,
  createDraft,
  dedupeWarnings,
  deleteRace,
  hideRace,
  impact,
  listAdminRaces,
  loadAdminRace,
  publishRace,
  saveRace,
  unpublishRace,
} from './races-service.js';
import {
  approveNotice,
  createNotice,
  listNotices,
  loadNotice,
  noticeAudience,
  testNotice,
  updateNotice,
  withdrawNotice,
} from './notices-service.js';
import { getReport, listReports, resolveReports } from './reports-service.js';
import { ADMIN_COOKIE, destroyAdminSession, SESSION_ABSOLUTE_MS } from './session.js';

/**
 * 관리자 API (tech/06 7장, PRD 8장). prefix /api/admin/v1.
 * 인증: 이메일 + 비밀번호 → TOTP → httpOnly 세션 쿠키, 쓰기 요청은 X-CSRF-Token (tech/06 2.3).
 * 권한: owner 전부 / operator 대회·제보 쓰기 / viewer 조회 (PRD 8.1). 쓰기는 모두 admin_audit_logs.
 * 구현: 인증, 관리자 계정, 대회(목록·초안·저장·게시·숨김·삭제·복제·중복·영향), 제보
 *       원격 설정(GET /app-configs, PUT /app-configs/{key})
 *       공지·푸시(A-008, T-030: 목록·작성·수정·대상 수·테스트·승인(owner)·내리기)
 * 남은 것: 대시보드, 수집 후보, 지오코딩(D-008 확정 후)
 */
export default async function adminRoutes(app: FastifyInstance) {
  await app.register(cookie);
  registerAuditLog(app);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const deps = () => ({ db: app.db, redis: app.redis, cipher: app.cipher });
  const owner = { preHandler: requireAdmin(app, OWNER) };
  const writers = { preHandler: requireAdmin(app, WRITERS) };
  const readers = { preHandler: requireAdmin(app, READERS) };
  const IdParams = z.object({ id: Id });

  // ---- 인증 ----
  r.post(
    '/auth/login',
    { schema: { body: AdminLoginReq, response: { 200: AdminLoginRes } } },
    async (request) => adminLogin(deps(), request.body.email, request.body.password),
  );

  r.post(
    '/auth/mfa',
    { schema: { body: AdminMfaReq, response: { 200: AdminMfaRes } } },
    async (request, reply) => {
      const res = await adminVerifyMfa(deps(), request.body.mfaToken, request.body.totp);
      request.admin = { ...res.admin, csrfToken: res.csrfToken };
      request.audit = { action: 'login', targetType: 'admin', targetId: res.admin.id };
      reply.setCookie(ADMIN_COOKIE, res.token, {
        httpOnly: true,
        secure: app.config.env === 'production',
        sameSite: 'strict',
        path: '/api/admin',
        maxAge: SESSION_ABSOLUTE_MS / 1000,
      });
      return { admin: res.admin, csrfToken: res.csrfToken };
    },
  );

  r.post('/auth/logout', readers, async (request, reply) => {
    const token = request.cookies[ADMIN_COOKIE];
    if (token) await destroyAdminSession(app.redis, token);
    request.audit = { action: 'logout', targetType: 'admin', targetId: request.admin!.id };
    return reply.clearCookie(ADMIN_COOKIE, { path: '/api/admin' }).status(204).send();
  });

  // 관리자 웹이 새로고침 뒤 세션 확인 + CSRF 토큰 복구에 쓴다 (같은 출처·httpOnly 쿠키라 다른 사이트는 읽을 수 없음)
  r.get(
    '/auth/me',
    { ...readers, schema: { response: { 200: AdminSessionInfo } } },
    async (request, reply) => {
      const { id, email, role, csrfToken } = request.admin!;
      return reply.header('cache-control', 'no-store').send({ id, email, role, csrfToken });
    },
  );

  // ---- 관리자 계정 (owner) ----
  r.get('/admins', { ...owner, schema: { response: { 200: z.array(AdminAccount) } } }, async () =>
    (await app.db.select().from(adminUsers).orderBy(asc(adminUsers.email))).map(toAccount),
  );

  r.post(
    '/admins',
    { ...owner, schema: { body: AdminCreateReq, response: { 201: AdminCreateRes } } },
    async (request, reply) => {
      const res = await createAdmin(deps(), request.body);
      request.audit = { targetType: 'admin', targetId: res.admin.id, memo: res.admin.role };
      return reply.status(201).send(res);
    },
  );

  r.patch(
    '/admins/:id',
    {
      ...owner,
      schema: { params: IdParams, body: AdminPatchReq, response: { 200: AdminAccount } },
    },
    async (request) => {
      request.audit = { targetType: 'admin', memo: JSON.stringify(request.body) };
      return patchAdmin(app.db, request.admin!.id, request.params.id, request.body);
    },
  );

  // ---- 대회 (A-003) ----
  r.get(
    '/races',
    { ...readers, schema: { querystring: AdminRaceListQuery, response: { 200: AdminRacePage } } },
    async (request) => listAdminRaces(app.db, request.query),
  );

  r.post(
    '/races',
    {
      ...writers,
      schema: {
        body: AdminRaceDraftInput,
        response: { 201: z.object({ race: AdminRace, dedupeWarnings: z.array(DedupeWarning) }) },
      },
    },
    async (request, reply) => {
      const res = await createDraft(app.db, request.body, request.admin!.role);
      request.audit = { targetType: 'race', targetId: res.race.id };
      return reply.status(201).send(res);
    },
  );

  r.get(
    '/races/duplicates',
    {
      ...writers,
      schema: { querystring: DuplicatesQuery, response: { 200: z.array(DedupeWarning) } },
    },
    async (request) => dedupeWarnings(app.db, request.query.name, request.query.raceDate),
  );

  r.get(
    '/races/:id',
    { ...readers, schema: { params: IdParams, response: { 200: AdminRace } } },
    async (request) => loadAdminRace(app.db, request.params.id),
  );

  r.put(
    '/races/:id',
    {
      ...writers,
      schema: { params: IdParams, body: AdminRaceInput, response: { 200: AdminRaceSaveRes } },
    },
    async (request) => {
      const ifMatch = request.headers['if-match'];
      const res = await saveRace(
        app.db,
        app.raceUpdates,
        request.params.id,
        request.body,
        typeof ifMatch === 'string' ? ifMatch : undefined,
      );
      request.audit = {
        targetType: 'race',
        memo: res.sideEffects.sentChangeNotice
          ? `${res.sideEffects.sentChangeNotice} → ${res.sideEffects.affectedUsers}명`
          : undefined,
      };
      return res;
    },
  );

  r.post(
    '/races/:id/publish',
    { ...writers, schema: { params: IdParams, response: { 200: AdminRace } } },
    async (request) => {
      request.audit = { targetType: 'race' };
      return publishRace(app.db, app.raceUpdates, request.params.id);
    },
  );

  r.post(
    '/races/:id/unpublish',
    { ...writers, schema: { params: IdParams, response: { 200: AdminRace } } },
    async (request) => {
      request.audit = { targetType: 'race' };
      return unpublishRace(app.db, app.raceUpdates, request.params.id);
    },
  );

  r.post(
    '/races/:id/hide',
    { ...writers, schema: { params: IdParams, body: HideReq, response: { 200: AdminRace } } },
    async (request) => {
      // 예: "주최 측 요청" (PRD 8.4)
      request.audit = { targetType: 'race', memo: request.body.memo };
      return hideRace(app.db, app.raceUpdates, request.params.id);
    },
  );

  r.delete('/races/:id', { ...owner, schema: { params: IdParams } }, async (request, reply) => {
    await deleteRace(app.db, request.params.id);
    request.audit = { targetType: 'race' };
    return reply.status(204).send();
  });

  r.post(
    '/races/:id/clone',
    { ...writers, schema: { params: IdParams, body: CloneReq, response: { 201: CloneRes } } },
    async (request, reply) => {
      const res = await cloneRace(app.db, request.params.id, request.body.shiftDates);
      // 복제 원본 id는 감사 로그에 (PRD 8.4.4)
      request.audit = {
        targetType: 'race',
        targetId: res.race.id,
        memo: `cloned_from=${request.params.id}`,
      };
      return reply.status(201).send(res);
    },
  );

  r.get(
    '/races/:id/impact',
    { ...readers, schema: { params: IdParams, response: { 200: Impact } } },
    async (request) => impact(app.db, request.params.id),
  );

  // ---- 제보 (A-004) ----
  r.get(
    '/reports',
    {
      ...readers,
      schema: { querystring: AdminReportListQuery, response: { 200: AdminReportPage } },
    },
    async (request) => listReports(app.db, request.query),
  );

  r.get(
    '/reports/:id',
    { ...readers, schema: { params: IdParams, response: { 200: AdminReportDetail } } },
    async (request) => getReport(app.db, request.params.id),
  );

  r.post(
    '/reports/resolve',
    {
      ...writers,
      schema: {
        body: ResolveReportsReq,
        response: { 200: z.object({ resolved: z.number().int() }) },
      },
    },
    async (request) => {
      request.audit = {
        targetType: 'race_report',
        targetId: request.body.ids.join(','),
        memo: request.body.action,
      };
      return resolveReports(app.db, request.admin!.id, request.body);
    },
  );

  // ---- 공지·푸시 (7.6, A-008) — 쓰기 owner·operator, 승인은 owner ----
  const NoticeRes = { 200: AdminNotice };
  r.get(
    '/notices',
    {
      ...readers,
      schema: { querystring: AdminNoticeListQuery, response: { 200: AdminNoticePage } },
    },
    async (request) => listNotices(app.db, request.query),
  );
  r.get(
    '/notices/:id',
    { ...readers, schema: { params: IdParams, response: NoticeRes } },
    async (request) => loadNotice(app.db, request.params.id),
  );
  r.post(
    '/notices',
    { ...writers, schema: { body: AdminNoticeInput, response: { 201: AdminNotice } } },
    async (request, reply) => {
      const notice = await createNotice(app.db, request.admin!.id, request.body, new Date());
      request.audit = { targetType: 'notice', targetId: notice.id, memo: notice.kind };
      return reply.code(201).send(notice);
    },
  );
  r.put(
    '/notices/:id',
    { ...writers, schema: { params: IdParams, body: AdminNoticeInput, response: NoticeRes } },
    async (request) => {
      request.audit = { targetType: 'notice' };
      return updateNotice(app.db, request.params.id, request.body, new Date());
    },
  );
  r.get(
    '/notices/:id/audience',
    { ...writers, schema: { params: IdParams, response: { 200: NoticeAudience } } },
    async (request) => noticeAudience(app.db, request.params.id),
  );
  r.post(
    '/notices/:id/test',
    {
      ...writers,
      schema: {
        params: IdParams,
        body: NoticeTestReq,
        response: { 200: z.object({ notificationId: Id }) },
      },
    },
    async (request) => {
      request.audit = { targetType: 'notice', memo: `test user ${request.body.userId}` };
      return testNotice(app.db, request.params.id, request.body.userId, new Date());
    },
  );
  r.post(
    '/notices/:id/approve',
    { ...owner, schema: { params: IdParams, response: NoticeRes } },
    async (request) => {
      request.audit = { targetType: 'notice' };
      return approveNotice(app.db, request.admin!.id, request.params.id, new Date());
    },
  );
  r.post(
    '/notices/:id/withdraw',
    { ...writers, schema: { params: IdParams, response: NoticeRes } },
    async (request) => {
      request.audit = { targetType: 'notice' };
      return withdrawNotice(app.db, request.params.id);
    },
  );

  // ---- 원격 설정 (7.7) ----
  r.get(
    '/app-configs',
    { ...readers, schema: { response: { 200: z.array(AdminAppConfig) } } },
    async () => listAppConfigs(app.db),
  );

  r.put(
    '/app-configs/:key',
    {
      ...owner,
      schema: {
        params: z.object({ key: AppConfigKey }),
        body: AdminAppConfigPutReq,
        response: { 200: AdminAppConfig },
      },
    },
    async (request) => {
      request.audit = {
        targetType: 'app_config',
        targetId: request.params.key,
        memo: JSON.stringify(request.body.value),
      };
      return putAppConfig(app.db, request.admin!.id, request.params.key, request.body.value);
    },
  );
}
