import {
  Id,
  InterestOffRes,
  InterestOnRes,
  RaceCalendar,
  RaceCalendarQuery,
  RaceCount,
  RaceCountQuery,
  RaceDetail,
  RaceListQuery,
  RacePage,
  ReportCreateReq,
} from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import { interestOff, interestOn } from './interest.js';
import { createReport } from './reports.js';
import { countRaces, getRaceDetail, listRaces, raceCalendar } from './service.js';

/**
 * 대회 (tech/06 6.4, F-010~F-012).
 * 구현: GET /races, GET /races/count, GET /races/calendar, GET /races/{id},
 *       PUT/DELETE /races/{id}/interest, POST /races/{id}/reports
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

  // 목록과 같은 필터 (service.ts filterRaces). 정적 경로라 /races/:raceId보다 먼저 맞는다
  r.get(
    '/races/count',
    { onRequest: user, schema: { querystring: RaceCountQuery, response: { 200: RaceCount } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await countRaces(app.db, requireUserId(request), request.query)),
  );

  r.get(
    '/races/calendar',
    {
      onRequest: user,
      schema: { querystring: RaceCalendarQuery, response: { 200: RaceCalendar } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await raceCalendar(app.db, requireUserId(request), request.query)),
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

  const Params = z.object({ raceId: Id });

  r.put(
    '/races/:raceId/interest',
    { onRequest: user, schema: { params: Params, response: { 200: InterestOnRes } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await interestOn(app.db, requireUserId(request), request.params.raceId)),
  );

  r.delete(
    '/races/:raceId/interest',
    { onRequest: user, schema: { params: Params, response: { 200: InterestOffRes } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await interestOff(app.db, requireUserId(request), request.params.raceId)),
  );

  r.post(
    '/races/:raceId/reports',
    {
      onRequest: user,
      schema: {
        params: Params,
        body: ReportCreateReq,
        response: { 201: z.object({ id: Id }) },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await createReport(app.db, requireUserId(request), request.params.raceId, request.body),
        ),
  );
}
