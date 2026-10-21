import { Id, RaceDetail, RaceListQuery, RacePage } from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import { getRaceDetail, listRaces } from './service.js';

/**
 * 대회 (tech/06 6.4, F-010~F-012).
 * 구현: GET /races, GET /races/{id}
 * 남은 것: GET /races/count, GET /races/calendar, PUT/DELETE /races/{id}/interest, POST /races/{id}/reports
 *
 * 캐시: 명세는 `private, max-age=60 + ETag`이지만 응답에 사용자별 `my`(관심·참가 예정)가 있어
 * 추가·해제 직후 오래된 값이 보일 수 있으므로 no-store로 둔다 (tech/06 변경 이력).
 */
export default async function raceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const user = [app.authenticate, app.termsGate];

  r.get(
    '/races',
    { onRequest: user, schema: { querystring: RaceListQuery, response: { 200: RacePage } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await listRaces(app.db, requireUserId(request), request.query)),
  );

  r.get(
    '/races/:raceId',
    {
      onRequest: user,
      schema: { params: z.object({ raceId: Id }), response: { 200: RaceDetail } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getRaceDetail(app.db, requireUserId(request), request.params.raceId)),
  );
}
