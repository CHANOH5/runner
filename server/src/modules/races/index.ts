import type { FastifyInstance } from 'fastify';

/**
 * 대회 (tech/06 6.4~6.6, F-010~F-013).
 * - GET /races, /races/count, /races/calendar, /races/{id}
 * - GET /home/next-race, /home/deadlines, /home/recommended
 * - PUT/DELETE /races/{id}/interest, POST /races/{id}/reports
 */
export default async function raceRoutes(_app: FastifyInstance) {}
