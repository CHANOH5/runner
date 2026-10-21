import type { FastifyInstance } from 'fastify';

/**
 * 기록 (tech/06 6.10, F-004).
 * - GET/POST /me/records, PATCH/DELETE /me/records/{id}
 * - 추가·수정·삭제 시 users.records_changed_at 갱신 (예측 recordsChangedSince)
 */
export default async function recordRoutes(_app: FastifyInstance) {}
