import {
  CreateRegistrationReq,
  Id,
  MyRacePage,
  MyRacesQuery,
  Registration,
  UpdateRegistrationReq,
} from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import {
  createRegistration,
  deleteRegistration,
  getRegistration,
  listMyRaces,
  updateRegistration,
} from './service.js';

/**
 * 참가 예정·접수 상태·내 대회 (tech/06 6.7·6.8, F-015, D-019).
 * 화면 용어는 "참가 예정", 내부 이름은 registration (tech/06 1장 이름 규칙).
 * 남은 것: GET /registrations/{id}/strategy
 * TODO: Idempotency-Key, 요청 제한 (tech/06 1장, 8장)
 */
export default async function registrationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const user = [app.authenticate, app.termsGate];
  const RaceParams = z.object({ raceId: Id });
  const RegParams = z.object({ registrationId: Id });

  r.post(
    '/races/:raceId/registration',
    {
      onRequest: user,
      schema: { params: RaceParams, body: CreateRegistrationReq, response: { 201: Registration } },
    },
    async (request, reply) => {
      const reg = await createRegistration(
        app.db,
        requireUserId(request),
        request.params.raceId,
        request.body,
      );
      return reply.status(201).header('cache-control', 'no-store').send(reg);
    },
  );

  r.get(
    '/registrations/:registrationId',
    { onRequest: user, schema: { params: RegParams, response: { 200: Registration } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getRegistration(app.db, requireUserId(request), request.params.registrationId)),
  );

  r.patch(
    '/registrations/:registrationId',
    {
      onRequest: user,
      schema: { params: RegParams, body: UpdateRegistrationReq, response: { 200: Registration } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(
          await updateRegistration(
            app.db,
            requireUserId(request),
            request.params.registrationId,
            request.body,
          ),
        ),
  );

  r.delete(
    '/registrations/:registrationId',
    { onRequest: user, schema: { params: RegParams } },
    async (request, reply) => {
      await deleteRegistration(app.db, requireUserId(request), request.params.registrationId);
      return reply.status(204).send();
    },
  );

  r.get(
    '/me/races',
    { onRequest: user, schema: { querystring: MyRacesQuery, response: { 200: MyRacePage } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await listMyRaces(app.db, requireUserId(request), request.query)),
  );
}
