import { REJECT_REASON_TEXT, type ResolveReportsReq } from '@berun/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notifications, raceReports, races, userProfiles, users } from '../../db/schema/index.js';
import { notFound, validationFailed } from '../../lib/errors.js';
import { toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { render } from '../notifications/render.js';
import { loadAdminRace } from './races-service.js';

const OVERDUE_MS = 72 * 60 * 60 * 1000;

type ReportRow = typeof raceReports.$inferSelect;

const toRow = (r: ReportRow, raceName: string, now: Date) => ({
  id: r.id,
  raceId: r.raceId,
  raceName,
  field: r.field,
  preview: [...r.message].slice(0, 50).join(''),
  status: r.status as 'open' | 'applied' | 'rejected',
  createdAt: toKstIso(r.createdAt),
  overdue72h: r.status === 'open' && now.getTime() - r.createdAt.getTime() > OVERDUE_MS,
});

/** GET /reports — 상태 필터, 접수 오래된 순 (PRD 8.5) */
export async function listReports(
  db: Db,
  q: { status?: string[] | undefined; page: number; pageSize: number },
  now = new Date(),
) {
  const where = q.status?.length ? inArray(raceReports.status, q.status) : undefined;
  const [rows, total] = await Promise.all([
    db
      .select({ report: raceReports, raceName: races.name })
      .from(raceReports)
      .innerJoin(races, eq(races.id, raceReports.raceId))
      .where(where)
      .orderBy(asc(raceReports.createdAt), asc(raceReports.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.$count(raceReports, where),
  ]);
  return {
    items: rows.map((r) => toRow(r.report, r.raceName, now)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** GET /reports/{id} — 전문, 제보자 닉네임(탈퇴 시 null), 대회 현재 값, 같은 대회 미처리 제보 */
export async function getReport(db: Db, id: string, now = new Date()) {
  const [row] = await db
    .select({ report: raceReports, raceName: races.name, nickname: userProfiles.nickname })
    .from(raceReports)
    .innerJoin(races, eq(races.id, raceReports.raceId))
    .leftJoin(userProfiles, eq(userProfiles.userId, raceReports.userId))
    .where(eq(raceReports.id, id));
  if (!row) throw notFound('report');
  const others = await db
    .select()
    .from(raceReports)
    .where(
      and(
        eq(raceReports.raceId, row.report.raceId),
        eq(raceReports.status, 'open'),
        ne(raceReports.id, id),
      ),
    )
    .orderBy(asc(raceReports.createdAt));
  return {
    ...toRow(row.report, row.raceName, now),
    message: row.report.message,
    reporterNickname: row.nickname ?? null,
    resolutionNote: row.report.resolutionNote,
    resolvedAt: toKstIsoOrNull(row.report.resolvedAt),
    race: await loadAdminRace(db, row.report.raceId),
    otherOpenReports: others.map((o) => toRow(o, row.raceName, now)),
  };
}

/**
 * POST /reports/resolve — 일괄 반영·반려 (PRD 8.5). 미처리 제보만 처리하고,
 * 제보자마다 N-07a/b 앱 내 알림(푸시 없음)을 남긴다. 탈퇴·휴면·정지 사용자는 알림 없음 (P-RET-03).
 */
export async function resolveReports(
  db: Db,
  adminId: string,
  req: ResolveReportsReq,
  now = new Date(),
) {
  const rows = await db
    .select({ report: raceReports, race: races, userStatus: users.status })
    .from(raceReports)
    .innerJoin(races, eq(races.id, raceReports.raceId))
    .leftJoin(users, eq(users.id, raceReports.userId))
    .where(inArray(raceReports.id, req.ids));
  const missing = req.ids.flatMap((id, i) =>
    rows.some((r) => r.report.id === id) ? [] : [{ path: `ids[${i}]`, code: 'not_found' }],
  );
  if (missing.length) throw validationFailed(missing);

  const open = rows.filter((r) => r.report.status === 'open');
  const reasonText =
    req.action === 'rejected'
      ? req.rejectReason === 'other'
        ? (req.rejectText ?? '')
        : REJECT_REASON_TEXT[req.rejectReason as keyof typeof REJECT_REASON_TEXT]
      : null;
  const note =
    req.action === 'rejected'
      ? req.rejectReason === 'other'
        ? req.rejectText!
        : req.rejectReason!
      : null;
  const kind = req.action === 'applied' ? 'report_applied' : 'report_rejected';

  await db.transaction(async (tx) => {
    if (open.length === 0) return;
    await tx
      .update(raceReports)
      .set({ status: req.action, resolutionNote: note, resolvedBy: adminId, resolvedAt: now })
      .where(
        inArray(
          raceReports.id,
          open.map((r) => r.report.id),
        ),
      );
    const notify = open.filter((r) => r.report.userId && r.userStatus === 'active');
    if (notify.length) {
      await tx
        .insert(notifications)
        .values(
          notify.map((r) => {
            const rendered = render({
              kind,
              race: {
                id: r.race.id,
                name: r.race.name,
                registrationMethod: r.race.registrationMethod,
              },
              opensAt: null,
              opensTimeKnown: true,
              closesAt: null,
              registrationClosed: false,
              event: null,
              registration: null,
              rejectReasonText: reasonText,
            });
            return {
              userId: r.report.userId!,
              raceId: r.race.id,
              kind,
              scheduledAt: now,
              // 앱 내만 (PRD 7.2 N-07)
              status: 'sent',
              payload: { ...rendered, reportId: r.report.id },
            };
          }),
        )
        .onConflictDoNothing();
    }
  });
  return { resolved: open.length };
}
