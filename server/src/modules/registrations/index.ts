import type { FastifyInstance } from 'fastify';

/**
 * 참가 등록·내 대회 (tech/06 6.7~6.8, F-015).
 * - POST /races/{id}/registration, GET/PATCH/DELETE /registrations/{id}
 * - GET /registrations/{id}/strategy, GET /me/races
 */
export default async function registrationRoutes(_app: FastifyInstance) {}
