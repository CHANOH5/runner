import type { FastifyInstance } from 'fastify';

/**
 * 알림 (tech/06 6.12, F-014).
 * - GET /me/notifications, /me/notifications/unread-count, POST /me/notifications/read
 * - GET /notices/{id}
 */
export default async function notificationRoutes(_app: FastifyInstance) {}
