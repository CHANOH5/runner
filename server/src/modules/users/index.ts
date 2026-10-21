import type { FastifyInstance } from 'fastify';

/**
 * 내 정보·프로필·동의·기기·탈퇴 (tech/06 6.3, F-003, F-071, F-072).
 * - GET/DELETE /me, PATCH /me/profile, GET/POST /me/consents, PUT /me/device
 * - GET/PATCH /me/notification-settings
 * - GET /app-config (tech/06 6.1)
 */
export default async function userRoutes(_app: FastifyInstance) {}
