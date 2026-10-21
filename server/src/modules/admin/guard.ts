import type {} from '@fastify/cookie';
import type { AdminRole } from '@berun/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminAuditLogs, adminUsers } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { ADMIN_COOKIE, destroyAdminSession, touchAdminSession } from './session.js';

export type AdminContext = { id: string; email: string; role: AdminRole; csrfToken: string };

/** 감사 로그에 남길 대상·메모. 핸들러가 채운다 */
export type AuditInfo = { action?: string; targetType?: string; targetId?: string; memo?: string };

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminContext | null;
    audit: AuditInfo | null;
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 관리자 인증 훅: 세션 쿠키 → 관리자 행 확인(비활성이면 세션 폐기) → 역할 → 상태 변경 요청은 CSRF 헤더 (tech/06 2.3).
 * 역할: owner 전부 / operator 대회·제보 쓰기 / viewer 조회만 (PRD 8.1)
 */
export function requireAdmin(app: FastifyInstance, roles: AdminRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[ADMIN_COOKIE];
    const session = token ? await touchAdminSession(app.redis, token, Date.now()) : null;
    if (!token || !session) throw new AppError('UNAUTHENTICATED', 'admin session required');

    const [admin] = await app.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, session.adminId));
    if (!admin || admin.disabledAt) {
      await destroyAdminSession(app.redis, token);
      reply.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
      throw new AppError('UNAUTHENTICATED', 'admin disabled');
    }
    const role = admin.role as AdminRole;
    request.admin = { id: admin.id, email: admin.email, role, csrfToken: session.csrfToken };
    if (!roles.includes(role)) throw new AppError('FORBIDDEN', `role ${role} not allowed`);
    if (!SAFE.has(request.method) && request.headers['x-csrf-token'] !== session.csrfToken) {
      throw new AppError('FORBIDDEN', 'invalid csrf token');
    }
  };
}

export const OWNER: AdminRole[] = ['owner'];
export const WRITERS: AdminRole[] = ['owner', 'operator'];
export const READERS: AdminRole[] = ['owner', 'operator', 'viewer'];

/**
 * 모든 관리자 쓰기 요청을 admin_audit_logs에 남긴다 (성공한 요청만, tech/06 2.3).
 * 응답을 보내기 전(onSend)에 기록한다 — 기록이 끝나야 응답이 나간다.
 */
export function registerAuditLog(app: FastifyInstance) {
  app.decorateRequest('admin', null);
  app.decorateRequest('audit', null);
  app.addHook('onSend', async (request, reply) => {
    if (SAFE.has(request.method) || reply.statusCode >= 400 || !request.admin) return;
    const info = request.audit ?? {};
    const params = request.params as Record<string, string> | undefined;
    await app.db.insert(adminAuditLogs).values({
      adminId: request.admin.id,
      action: info.action ?? `${request.method} ${request.routeOptions.url ?? request.url}`,
      targetType: info.targetType ?? null,
      targetId: info.targetId ?? params?.id ?? null,
      memo: info.memo ?? null,
    });
  });
}
