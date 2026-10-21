import {
  NOTIFICATION_RETENTION_DAYS,
  type AppNotification,
  type MarkReadReq,
  type NotificationKind,
} from '@berun/shared';
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deletionJobs, notifications, notificationSchedules } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import type { NotificationPayload } from './delivery.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 앱 목록에 보이는 상태: 보냈거나 푸시만 실패한 것 (PRD 7.1). 예약·취소는 숨긴다 */
const VISIBLE = ['sent', 'failed'];

const since = (now: Date) => new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);

function visibleFor(userId: string, now: Date) {
  return and(
    eq(notifications.userId, userId),
    inArray(notifications.status, VISIBLE),
    gte(notifications.createdAt, since(now)),
    // 아직 렌더링되지 않은(문구 없는) 행은 보이지 않게
    sql`${notifications.payload} ? 'title'`,
  );
}

type Row = typeof notifications.$inferSelect;

function toAppNotification(row: Row): AppNotification {
  const p = row.payload as NotificationPayload;
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: p.title ?? '',
    body: p.body ?? '',
    deepLink: p.deepLink ?? 'berun://notifications',
    createdAt: toKstIso(row.scheduledAt),
    readAt: toKstIsoOrNull(row.readAt),
  };
}

/**
 * GET /me/notifications — 최근 90일, (scheduled_at DESC, id DESC) 커서.
 * 명세의 정렬 키는 created_at이지만, 예약 알림은 발송 30분 전에 행이 생기므로 사용자가 받은 시각(예약 시각)으로 정렬·표시한다.
 */
export async function listNotifications(
  db: Db,
  userId: string,
  q: { cursor?: string | undefined; limit: number },
  now = new Date(),
) {
  const after = decodeCursor(q.cursor, 2) as [string, string] | null;
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        visibleFor(userId, now),
        after
          ? sql`(${notifications.scheduledAt}, ${notifications.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(notifications.scheduledAt), desc(notifications.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map(toAppNotification),
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor([last.scheduledAt.toISOString(), last.id])
        : null,
  };
}

/** GET /me/notifications/unread-count (앱은 99+ 처리) */
export async function unreadCount(db: Db, userId: string, now = new Date()) {
  return db.$count(notifications, and(visibleFor(userId, now), isNull(notifications.readAt)));
}

/** POST /me/notifications/read — 내 알림만, 이미 읽은 것은 시각 유지 */
export async function markRead(db: Db, userId: string, req: MarkReadReq, now = new Date()) {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        'ids' in req ? inArray(notifications.id, req.ids) : undefined,
      ),
    );
}

/**
 * 파기 배치 (P-RET-01, tech/04 5장): 매일 04:00 KST.
 * - notifications: 생성 후 90일
 * - notification_schedules: done·cancelled 후 90일 (예약 시각 기준)
 * 실행마다 deletion_jobs에 건수를 남긴다 (0건이어도).
 */
export async function purgeExpiredNotifications(db: Db, now = new Date()) {
  const cutoff = since(now);
  return db.transaction(async (tx) => {
    const n = await tx
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .returning({ id: notifications.id });
    const s = await tx
      .delete(notificationSchedules)
      .where(
        and(
          lt(notificationSchedules.scheduledAt, cutoff),
          notInArray(notificationSchedules.status, ['pending', 'materialized']),
        ),
      )
      .returning({ id: notificationSchedules.id });
    await tx.insert(deletionJobs).values([
      { jobName: 'notifications_90d', deletedCount: n.length, ranAt: now },
      { jobName: 'notification_schedules_90d', deletedCount: s.length, ranAt: now },
    ]);
    return { notifications: n.length, schedules: s.length };
  });
}
