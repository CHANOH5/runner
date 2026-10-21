import { Id, PageQuery, RecordInput, RecordPage, RecordPatch, RunRecord } from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import { createRecord, deleteRecord, listRecords, updateRecord } from './service.js';

/**
 * 기록 (tech/06 6.10, F-004).
 * TODO: Idempotency-Key, 요청 제한 (tech/06 1장, 8장)
 */
export default async function recordRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const user = [app.authenticate, app.termsGate];
  const Params = z.object({ recordId: Id });

  r.get(
    '/me/records',
    { onRequest: user, schema: { querystring: PageQuery, response: { 200: RecordPage } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await listRecords(app.db, requireUserId(request), request.query)),
  );

  r.post(
    '/me/records',
    { onRequest: user, schema: { body: RecordInput, response: { 201: RunRecord } } },
    async (request, reply) =>
      reply
        .status(201)
        .header('cache-control', 'no-store')
        .send(await createRecord(app.db, requireUserId(request), request.body)),
  );

  r.patch(
    '/me/records/:recordId',
    {
      onRequest: user,
      schema: { params: Params, body: RecordPatch, response: { 200: RunRecord } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(
          await updateRecord(app.db, requireUserId(request), request.params.recordId, request.body),
        ),
  );

  r.delete(
    '/me/records/:recordId',
    { onRequest: user, schema: { params: Params } },
    async (request, reply) => {
      await deleteRecord(app.db, requireUserId(request), request.params.recordId);
      return reply.status(204).send();
    },
  );
}
