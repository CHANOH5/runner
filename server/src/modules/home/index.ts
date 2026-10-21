import { HomeDeadlines } from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { homeDeadlines } from './service.js';

/**
 * 홈 (tech/06 6.5, S-010).
 * 구현: GET /home/deadlines
 * 남은 것: GET /home/next-race, GET /home/recommended
 */
export default async function homeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/home/deadlines',
    {
      onRequest: [app.authenticate, app.termsGate],
      schema: { response: { 200: HomeDeadlines } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await homeDeadlines(app.db, requireUserId(request))),
  );
}
