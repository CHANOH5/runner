import { Prediction, PredictionReq } from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { createPrediction } from './service.js';

/**
 * 기록 예측 · 페이스 전략 (tech/06 6.11, F-020, F-021)
 * 구현: POST /me/predictions, POST /me/predictions/preview
 * 남은 것: GET /me/predictions/candidates, GET /me/predictions, GET /me/predictions/{id}
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
}
