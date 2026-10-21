import type { FastifyInstance } from 'fastify';

/**
 * 인증·가입 (tech/06 6.2, F-001~F-003). 소셜 로그인 연동 작업에서 구현한다.
 * - POST /auth/social, /auth/signup, /auth/signup/abort, /auth/refresh, /auth/logout
 * - GET /terms/current, GET /nicknames/availability
 */
export default async function authRoutes(_app: FastifyInstance) {}
