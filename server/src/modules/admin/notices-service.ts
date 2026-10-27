import type {
  AdminNotice,
  AdminNoticeInput,
  AdminNoticePage,
  FieldError,
  NoticeAudience,
  NoticeLink,
} from '@berun/shared';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { adminUsers, notices, notifications, races, users } from '../../db/schema/index.js';
import { AppError, notFound, validationFailed } from '../../lib/errors.js';
import { toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { canSendAt } from '../notifications/kinds.js';
import {
  cancelPendingNoticePushes,
  displayTitle,
  noticeAudienceSql,
  noticeDeepLink,
  noticePushBody,
  noticeStats,
  publishedAt,
} from '../notifications/notices.js';

/**
 * 관리자 공지·푸시 (A-008, PRD 8.6, tech/06 7.6).
 * 흐름: 작성(draft) → [owner 승인] approved → 게시 시각에 워커가 sent + 대상자 앱 내 알림(푸시 동반이면 기존 발송 경로) → 내리기 withdrawn.
 * 발송된 공지는 수정할 수 없다 (내리기만).
 */

type NoticeRow = typeof notices.$inferSelect;

const linkOf = (n: NoticeRow): NoticeLink =>
  n.linkType === 'race' && n.linkRaceId
    ? { type: 'race', raceId: n.linkRaceId }
    : n.linkType === 'race_list'
      ? { type: 'race_list' }
      : { type: 'notice' };

/** 입력 검증 (스키마 밖): 마케팅 야간 금지(P-NOTI-02), 예약은 미래, 링크 대회 존재 */
async function checkInput(db: Db, input: AdminNoticeInput, now: Date) {
  const errors: FieldError[] = [];
  if (input.scheduledAt !== null) {
    const at = new Date(input.scheduledAt);
    if (at <= now) errors.push({ path: 'scheduledAt', code: 'past' });
    else if (!canSendAt(input.kind, at)) {
      errors.push({ path: 'scheduledAt', code: 'night_not_allowed' });
    }
  }
  if (input.link.type === 'race') {
    const [race] = await db
      .select({ id: races.id, publishStatus: races.publishStatus })
      .from(races)
      .where(eq(races.id, input.link.raceId));
    if (!race || race.publishStatus !== 'published') {
      errors.push({ path: 'link.raceId', code: 'not_found' });
    }
  }
  if (errors.length) throw validationFailed(errors);
}

const columns = (input: AdminNoticeInput) => ({
  kind: input.kind,
  title: input.title,
  body: input.body,
  sendPush: input.sendPush,
  linkType: input.link.type,
  linkRaceId: input.link.type === 'race' ? input.link.raceId : null,
  scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
});

async function toAdminNotices(db: Db, rows: NoticeRow[]): Promise<AdminNotice[]> {
  if (rows.length === 0) return [];
  const adminIds = [...new Set(rows.flatMap((n) => [n.createdBy, n.approvedBy ?? []].flat()))];
  const raceIds = [...new Set(rows.flatMap((n) => (n.linkRaceId ? [n.linkRaceId] : [])))];
  const [admins, raceRows, stats] = await Promise.all([
    db
      .select({ id: adminUsers.id, email: adminUsers.email })
      .from(adminUsers)
      .where(inArray(adminUsers.id, adminIds)),
    raceIds.length
      ? db.select({ id: races.id, name: races.name }).from(races).where(inArray(races.id, raceIds))
      : Promise.resolve([]),
    noticeStats(
      db,
      rows.map((n) => n.id),
    ),
  ]);
  const admin = new Map(admins.map((a) => [a.id, a]));
  const raceName = new Map(raceRows.map((r) => [r.id, r.name]));
  return rows.map((n) => {
    const s = stats.get(n.id);
    const pub = n.status === 'sent' || n.status === 'withdrawn' ? publishedAt(n) : null;
    return {
      id: n.id,
      kind: n.kind === 'marketing' ? 'marketing' : 'notice',
      title: n.title,
      displayTitle: displayTitle(n),
      body: n.body,
      sendPush: n.sendPush,
      link: linkOf(n),
      linkRaceName: n.linkRaceId ? (raceName.get(n.linkRaceId) ?? null) : null,
      scheduledAt: toKstIsoOrNull(n.scheduledAt),
      status: n.status as AdminNotice['status'],
      createdBy: admin.get(n.createdBy) ?? { id: n.createdBy, email: '' },
      approvedBy: n.approvedBy
        ? (admin.get(n.approvedBy) ?? { id: n.approvedBy, email: '' })
        : null,
      approvedAt: toKstIsoOrNull(n.approvedAt),
      publishedAt: toKstIsoOrNull(pub),
      createdAt: toKstIso(n.createdAt),
      stats: {
        recipients: s?.recipients ?? 0,
        pushed: s?.pushed ?? 0,
        failed: s?.failed ?? 0,
        inAppOnly: s?.in_app_only ?? 0,
        pending: s?.pending ?? 0,
        opened: s?.opened ?? 0,
      },
    };
  });
}

async function loadRow(db: Db, id: string): Promise<NoticeRow> {
  const [n] = await db.select().from(notices).where(eq(notices.id, id));
  if (!n) throw notFound('notice');
  return n;
}

export async function loadNotice(db: Db, id: string): Promise<AdminNotice> {
  return (await toAdminNotices(db, [await loadRow(db, id)]))[0]!;
}

export async function listNotices(
  db: Db,
  q: { page: number; pageSize: number },
): Promise<AdminNoticePage> {
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(notices)
      .orderBy(desc(notices.createdAt), desc(notices.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(notices),
  ]);
  return {
    items: await toAdminNotices(db, rows),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function createNotice(
  db: Db,
  adminId: string,
  input: AdminNoticeInput,
  now: Date,
): Promise<AdminNotice> {
  await checkInput(db, input, now);
  const [row] = await db
    .insert(notices)
    .values({ ...columns(input), createdBy: adminId, status: 'draft' })
    .returning();
  return (await toAdminNotices(db, [row!]))[0]!;
}

/** 수정: 발송 전(draft·approved)만. 승인된 공지를 고치면 다시 승인받아야 한다 (draft로 돌아감) */
export async function updateNotice(
  db: Db,
  id: string,
  input: AdminNoticeInput,
  now: Date,
): Promise<AdminNotice> {
  const n = await loadRow(db, id);
  if (n.status !== 'draft' && n.status !== 'approved') {
    throw new AppError('CONFLICT_STALE', 'sent notice cannot be edited', {
      details: { status: n.status },
    });
  }
  await checkInput(db, input, now);
  const [row] = await db
    .update(notices)
    .set({ ...columns(input), status: 'draft', approvedBy: null, approvedAt: null })
    .where(eq(notices.id, id))
    .returning();
  return (await toAdminNotices(db, [row!]))[0]!;
}

/** 확인 모달: 대상 수 (공지 = 활성 사용자 / 마케팅 = 마케팅 동의자), 그중 푸시 토큰 보유 */
export async function noticeAudience(db: Db, id: string): Promise<NoticeAudience> {
  const n = await loadRow(db, id);
  const [row] = await db.execute<{ recipients: number; pushable: number }>(sql`
    WITH a AS (${noticeAudienceSql(n.kind)})
    SELECT count(*)::int AS recipients,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM devices d WHERE d.user_id = a.user_id AND d.push_token IS NOT NULL
      ))::int AS pushable
    FROM a
  `);
  return { recipients: row?.recipients ?? 0, pushable: row?.pushable ?? 0 };
}

/**
 * 승인 (owner만, 라우트에서 강제): owner가 쓴 공지는 작성자 본인이 바로 승인한다 (PRD 8.6, D-014).
 * 즉시 공지(scheduledAt null)는 다음 워커 tick(1분 안)에 게시·발송된다. 마케팅은 지금이 야간이면 거부.
 */
export async function approveNotice(
  db: Db,
  adminId: string,
  id: string,
  now: Date,
): Promise<AdminNotice> {
  const n = await loadRow(db, id);
  if (n.status !== 'draft') {
    throw new AppError('CONFLICT_STALE', 'only draft notices can be approved', {
      details: { status: n.status },
    });
  }
  const at = n.scheduledAt ?? now;
  if (n.scheduledAt && n.scheduledAt <= now) {
    throw validationFailed([{ path: 'scheduledAt', code: 'past' }]);
  }
  if (!canSendAt(n.kind, at)) {
    throw validationFailed([{ path: 'scheduledAt', code: 'night_not_allowed' }]);
  }
  const [row] = await db
    .update(notices)
    .set({ status: 'approved', approvedBy: adminId, approvedAt: now })
    .where(eq(notices.id, id))
    .returning();
  return (await toAdminNotices(db, [row!]))[0]!;
}

/** 내리기: 게시된 공지 → 앱 상세 410 "내려간 공지예요", 승인 대기 공지 → 게시하지 않음. 미발송 푸시는 취소 */
export async function withdrawNotice(db: Db, id: string): Promise<AdminNotice> {
  const n = await loadRow(db, id);
  if (n.status !== 'sent' && n.status !== 'approved') {
    throw new AppError('CONFLICT_STALE', 'notice is not published', {
      details: { status: n.status },
    });
  }
  const [row] = await db
    .update(notices)
    .set({ status: 'withdrawn' })
    .where(eq(notices.id, id))
    .returning();
  await cancelPendingNoticePushes(db, id);
  return (await toAdminNotices(db, [row!]))[0]!;
}

/**
 * 테스트 발송 (PRD 8.6): 지정 사용자(관리자 본인의 테스트 계정) 1명에게 바로. 동의·대상 조건은 보지 않고
 * 제목 앞에 "[테스트] "를 붙인다. 통계에는 넣지 않는다 (payload.test). 마케팅은 야간이면 워커가 보내지 않는다.
 * 테스트 알림의 공지 상세는 게시 전이면 404일 수 있다.
 */
export async function testNotice(
  db: Db,
  id: string,
  userId: string,
  now: Date,
): Promise<{ notificationId: string }> {
  const n = await loadRow(db, id);
  if (n.status === 'withdrawn') {
    throw new AppError('CONFLICT_STALE', 'notice withdrawn', { details: { status: n.status } });
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw validationFailed([{ path: 'userId', code: 'not_found' }]);
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      noticeId: n.id,
      kind: n.kind,
      scheduledAt: now,
      status: n.sendPush ? 'scheduled' : 'sent',
      ...(!n.sendPush && { lastError: 'in_app_only' }),
      payload: {
        test: true,
        title: `[테스트] ${displayTitle(n)}`,
        body: noticePushBody(n),
        deepLink: noticeDeepLink(n.id),
      },
    })
    .returning({ id: notifications.id });
  return { notificationId: row!.id };
}
