import {
  Id,
  Prediction,
  PredictionCandidates,
  PredictionCandidatesQuery,
  PredictionListQuery,
  PredictionPage,
  PredictionReq,
  Strategy,
} from '@berun/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import {
  getPrediction,
  listPredictions,
  predictionCandidates,
  registrationStrategy,
} from './history.js';
import { createPrediction } from './service.js';

/**
 * 기록 예측 · 페이스 전략 (tech/06 6.11, F-020, F-021)
 * 구현: POST /me/predictions, POST /me/predictions/preview, GET /me/predictions/candidates,
 *       GET /me/predictions, GET /me/predictions/{id}, GET /registrations/{id}/strategy
 * TODO: Idempotency-Key, 요청 제한 30회/분 (tech/06 1장, 8장)
 */
export default async function predictionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/me/predictions',
    {
      onRequest: [app.authenticate, app.termsGate],
      schema: { body: PredictionReq, response: { 201: Prediction } },
    },
    async (request, reply) => {
      const prediction = await createPrediction(app.db, requireUserId(request), request.body, {
        save: true,
      });
      return reply.status(201).header('cache-control', 'no-store').send(prediction);
    },
  );

  r.post(
    '/me/predictions/preview',
    {
      onRequest: [app.authenticate, app.termsGate],
      schema: { body: PredictionReq, response: { 200: Prediction } },
    },
    async (request, reply) => {
      const prediction = await createPrediction(app.db, requireUserId(request), request.body, {
        save: false,
      });
      return reply.header('cache-control', 'no-store').send(prediction);
    },
  );

  const user = [app.authenticate, app.termsGate];

  r.get(
    '/me/predictions/candidates',
    {
      onRequest: user,
      schema: { querystring: PredictionCandidatesQuery, response: { 200: PredictionCandidates } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(
          await predictionCandidates(app.db, requireUserId(request), request.query.targetDistanceM),
        ),
  );

  r.get(
    '/me/predictions',
    {
      onRequest: user,
      schema: { querystring: PredictionListQuery, response: { 200: PredictionPage } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await listPredictions(app.db, requireUserId(request), request.query)),
  );

  r.get(
    '/me/predictions/:predictionId',
    {
      onRequest: user,
      schema: { params: z.object({ predictionId: Id }), response: { 200: Prediction } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await getPrediction(app.db, requireUserId(request), request.params.predictionId)),
  );

  r.get(
    '/registrations/:registrationId/strategy',
    {
      onRequest: user,
      schema: { params: z.object({ registrationId: Id }), response: { 200: Strategy } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(
          await registrationStrategy(app.db, requireUserId(request), request.params.registrationId),
        ),
  );
}
