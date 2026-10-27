import { MARKETING_OPT_OUT_TEXT, MARKETING_TITLE_PREFIX, type NoticeDetail } from '@berun/shared';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notices, notifications } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { toKstIso } from '../../lib/time.js';
import { canSendAt } from './kinds.js';

/** 공지·마케팅 알림 kind (N-08a·b) */
export const NOTICE_KINDS = ['notice', 'marketing'] as const;
export type NoticeNotificationKind = (typeof NOTICE_KINDS)[number];
export const isNoticeKind = (k: string): k is NoticeNotificationKind =>
  (NOTICE_KINDS as readonly string[]).includes(k);

type NoticeRow = typeof notices.$inferSelect;

/** 앱·푸시에 나가는 제목. 마케팅은 "(광고) " 접두 (PRD 8.6) */
export const displayTitle = (n: Pick<NoticeRow, 'kind' | 'title'>) =>
  n.kind === 'marketing' ? `${MARKETING_TITLE_PREFIX}${n.title}` : n.title;

const PUSH_BODY_MAX = 60;
const cut = (s: string, max: number) => {
  const cps = [...s.replace(/\s+/g, ' ').trim()];
  return cps.length <= max ? cps.join('') : `${cps.slice(0, max - 1).join('')}…`;
};

/**
 * 푸시·알림 목록 본문 (PRD 8.6·7.2): 앞 60자. 마케팅은 끝에 수신 거부 안내를 붙이고 합쳐서 60자 안.
 */
export function noticePushBody(n: Pick<NoticeRow, 'kind' | 'body'>): string {
  if (n.kind !== 'marketing') return cut(n.body, PUSH_BODY_MAX);
  const room = PUSH_BODY_MAX - [...MARKETING_OPT_OUT_TEXT].length - 1;
  return `${cut(n.body, room)} ${MARKETING_OPT_OUT_TEXT}`;
}

export const noticeDeepLink = (id: string) => `berun://notices/${id}`;

/** 게시 시각: 예약 공지는 예약 시각, 즉시 공지는 승인 시각 */
export const publishedAt = (n: Pick<NoticeRow, 'scheduledAt' | 'approvedAt'>) =>
  n.scheduledAt ?? n.approvedAt;

/**
 * 공지 대상 (PRD 8.6): 공지 = 활성 사용자 전체 / 마케팅 = 활성 + 마케팅 수신 동의(notification_settings.marketing).
 * 휴면·정지 계정은 받지 않는다 (P-RET-03). userId를 주면 그 사용자만 (발송 직전 재확인).
 */
export function noticeAudienceSql(kind: string, userId?: string) {
  const marketing =
    kind === 'marketing'
      ? sql`AND EXISTS (SELECT 1 FROM notification_settings s WHERE s.user_id = u.id AND s.marketing)`
      : sql``;
  const one = userId ? sql`AND u.id = ${userId}` : sql``;
  return sql`SELECT u.id AS user_id FROM users u WHERE u.status = 'active' ${marketing} ${one}`;
}

/**
 * 승인된 공지 중 게시 시각이 된 것을 게시(sent)하고 대상자마다 앱 내 알림을 만든다 (워커 tick).
 * - 푸시 동반이면 알림을 scheduled로 만들어 기존 발송 경로(sendDue)가 보낸다
 * - 푸시 없음이면 앱 내 알림만 (status sent, sent_at null)
 * - 마케팅인데 야간(21:00~07:59)이면 아직 게시하지 않는다 (P-NOTI-02, 저장 단계에서도 막지만 늦게 돈 경우 대비)
 */
export async function materializeNotices(
  db: Db,
  now: Date,
): Promise<{ notices: number; created: number }> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notices)
      .where(
        and(
          eq(notices.status, 'approved'),
          or(isNull(notices.scheduledAt), lte(notices.scheduledAt, now)),
        ),
      )
      .for('update', { skipLocked: true });
    let created = 0;
    let published = 0;
    for (const n of due) {
      if (!canSendAt(n.kind, now)) continue;
      const at = publishedAt(n) ?? now;
      const audience = await tx.execute<{ user_id: string }>(noticeAudienceSql(n.kind));
      const payload = {
        title: displayTitle(n),
        body: noticePushBody(n),
        deepLink: noticeDeepLink(n.id),
      };
      for (let i = 0; i < audience.length; i += 1000) {
        const chunk = audience.slice(i, i + 1000);
        const rows = await tx
          .insert(notifications)
          .values(
            chunk.map((a) => ({
              userId: a.user_id,
              noticeId: n.id,
              kind: n.kind,
              scheduledAt: at,
              status: n.sendPush ? 'scheduled' : 'sent',
              ...(!n.sendPush && { lastError: 'in_app_only' }),
              payload,
            })),
          )
          .returning({ id: notifications.id });
        created += rows.length;
      }
      await tx.update(notices).set({ status: 'sent' }).where(eq(notices.id, n.id));
      published++;
    }
    return { notices: published, created };
  });
}

/**
 * 발송 직전 확인 (sendDue에서): 공지가 아직 게시 중인지(내리지 않았는지), 마케팅은 야간이 아닌지·동의를 철회하지 않았는지,
 * 사용자가 아직 활성인지. 통과하면 저장된 문구를 그대로 쓴다.
 */
export async function prepareNoticeNotification(
  db: Db,
  row: typeof notifications.$inferSelect,
  now: Date,
): Promise<
  { title: string; body: string; deepLink: string } | { cancel: 'expired' | 'not_eligible' }
> {
  const payload = row.payload as {
    title?: string;
    body?: string;
    deepLink?: string;
    test?: boolean;
  };
  if (!row.noticeId || !payload.title || !payload.body || !payload.deepLink) {
    return { cancel: 'not_eligible' };
  }
  if (!canSendAt(row.kind, now)) return { cancel: 'expired' };
  if (!payload.test) {
    const [n] = await db
      .select({ status: notices.status })
      .from(notices)
      .where(eq(notices.id, row.noticeId));
    if (!n || n.status !== 'sent') return { cancel: 'not_eligible' };
    const still = await db.execute(noticeAudienceSql(row.kind, row.userId));
    if (still.length === 0) return { cancel: 'not_eligible' };
  }
  return { title: payload.title, body: payload.body, deepLink: payload.deepLink };
}

/** 공지를 내리면 아직 보내지 않은 푸시는 취소한다 (앱 내 알림 행은 남는다, PRD 6.8) */
export async function cancelPendingNoticePushes(db: Db, noticeId: string) {
  await db
    .update(notifications)
    .set({ status: 'cancelled', lastError: 'withdrawn' })
    .where(and(eq(notifications.noticeId, noticeId), eq(notifications.status, 'scheduled')));
}

/** 공지별 발송 결과 집계 (A-008) */
export async function noticeStats(db: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, Record<string, number>>();
  const rows = await db.execute<{
    notice_id: string;
    recipients: number;
    pushed: number;
    failed: number;
    in_app_only: number;
    pending: number;
    opened: number;
  }>(sql`
    SELECT notice_id,
      count(*)::int AS recipients,
      count(*) FILTER (WHERE status = 'sent' AND sent_at IS NOT NULL)::int AS pushed,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'sent' AND sent_at IS NULL)::int AS in_app_only,
      count(*) FILTER (WHERE status = 'scheduled')::int AS pending,
      count(*) FILTER (WHERE read_at IS NOT NULL)::int AS opened
    FROM notifications
    WHERE notice_id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND NOT (payload ? 'test')
    GROUP BY notice_id
  `);
  return new Map(rows.map((r) => [r.notice_id, r]));
}

/**
 * GET /notices/{id} — 공지 상세 (tech/06 6.5, PRD 8.6).
 * 보낸 공지(sent)만 보인다. 내린 공지는 410 NOTICE_WITHDRAWN, 작성 중·발송 대기는 404.
 */
export async function getNotice(db: Db, id: string): Promise<NoticeDetail> {
  const [n] = await db.select().from(notices).where(eq(notices.id, id));
  if (!n) throw notFound('notice');
  if (n.status === 'withdrawn') throw new AppError('NOTICE_WITHDRAWN', 'notice withdrawn');
  if (n.status !== 'sent') throw notFound('notice');

  const link: NoticeDetail['link'] =
    n.linkType === 'race' && n.linkRaceId
      ? { type: 'race', raceId: n.linkRaceId }
      : n.linkType === 'race_list'
        ? { type: 'race_list' }
        : // 공지만, 또는 연결된 대회가 삭제됨(link_race_id = null) → 이동 버튼 없음
          { type: 'notice' };
  return {
    id: n.id,
    kind: n.kind === 'marketing' ? 'marketing' : 'notice',
    title: displayTitle(n),
    body: n.body,
    publishedAt: toKstIso(publishedAt(n) ?? n.createdAt),
    link,
  };
}
