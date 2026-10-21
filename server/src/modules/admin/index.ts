import type { FastifyInstance } from 'fastify';

/**
 * 관리자 API (tech/06 7장). prefix /api/admin/v1. 관리자 웹 작업에서 구현한다.
 * 인증은 사용자 JWT와 별도 (세션 쿠키 + TOTP, tech/06 2.3).
 */
export default async function adminRoutes(_app: FastifyInstance) {}
