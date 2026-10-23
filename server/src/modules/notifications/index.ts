import { MarkReadReq, NotificationListQuery, NotificationPage, UnreadCount } from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { listNotifications, markRead, unreadCount } from './inbox.js';

/**
 * 알림 목록 (tech/06 6.12, S-011). 발송은 워커(delivery.ts).
 * 남은 것: GET /notices/{id} (공지 작업)
 */
export default async function notificationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const user = [app.authenticate, app.termsGate];

  r.get(
    '/me/notifications',
    {
      onRequest: user,
      schema: { querystring: NotificationListQuery, response: { 200: NotificationPage } },
    },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send(await listNotifications(app.db, requireUserId(request), request.query)),
  );

  r.get(
    '/me/notifications/unread-count',
    { onRequest: user, schema: { response: { 200: UnreadCount } } },
    async (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .send({ count: await unreadCount(app.db, requireUserId(request)) }),
  );

  r.post(
    '/me/notifications/read',
    { onRequest: user, schema: { body: MarkReadReq } },
    async (request, reply) => {
      await markRead(app.db, requireUserId(request), request.body);
      return reply.status(204).send();
    },
  );
}
