import {
  Id,
  MarkReadReq,
  NoticeDetail,
  NotificationListQuery,
  NotificationPage,
  UnreadCount,
} from '@berun/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import { listNotifications, markRead, unreadCount } from './inbox.js';
import { getNotice } from './notices.js';

/**
 * 알림 목록·공지 상세 (tech/06 6.5, S-011). 발송은 워커(delivery.ts).
 * 공지 작성·발송(관리자 A-008)은 아직 없다 — 공지는 시드로만 들어간다
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

  // 공지 내용은 사용자마다 같지만, 내린 공지가 바로 410이 되도록 캐시하지 않는다
  r.get(
    '/notices/:id',
    {
      onRequest: user,
      schema: { params: z.object({ id: Id }), response: { 200: NoticeDetail } },
    },
    async (request, reply) =>
      reply.header('cache-control', 'no-store').send(await getNotice(app.db, request.params.id)),
  );
}
