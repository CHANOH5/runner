import {
  RECORD_LIMIT,
  type DistanceCategory,
  type RecordInput,
  type RecordPatch,
  type RunKind,
  type RunRecord,
  recordShapeIssues,
} from '@berun/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { runRecords, users } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { AppError, notFound, validationFailed } from '../../lib/errors.js';
import { kstDate, toKstIso } from '../../lib/time.js';
import { isEligible } from '../predictions/engine.js';

type RecordRow = typeof runRecords.$inferSelect;

export function toRunRecord(row: RecordRow, now = new Date()): RunRecord {
  return {
    id: row.id,
    category: row.category as DistanceCategory,
    distanceM: row.distanceM,
    durationSec: row.durationSec,
    paceSecPerKm: Math.round(row.durationSec / (row.distanceM / 1000)),
    runDate: row.runDate,
    kind: row.kind as RunKind,
    title: row.title,
    // 예측 조건(최근 365일, 3~42.195km) 밖이면 "예측 미사용" 태그 (PRD 4.4)
    usableForPrediction: isEligible({ ...row, kind: row.kind as RunKind }, kstDate(now)),
    createdAt: toKstIso(row.createdAt),
  };
}

/** 미래 날짜 금지 (오늘 KST 상한은 서버 시각이 필요해 스키마 밖에서 검사) */
function assertNotFuture(runDate: string | undefined, now: Date) {
  if (runDate !== undefined && runDate > kstDate(now)) {
    throw validationFailed([{ path: 'runDate', code: 'out_of_range' }]);
  }
}

const emptyToNull = (title: string | null | undefined) =>
  title === undefined ? undefined : title === null || title === '' ? null : title;

/** 기록 추가·수정·삭제 → 예측 카드 "기록이 바뀌었어요" (tech/06 6.10) */
async function touchRecords(db: Db, userId: string, now: Date) {
  await db.update(users).set({ recordsChangedAt: now }).where(eq(users.id, userId));
}

/** POST /me/records */
export async function createRecord(db: Db, userId: string, req: RecordInput, now = new Date()) {
  assertNotFuture(req.runDate, now);

  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runRecords)
    .where(eq(runRecords.userId, userId));
  if (n >= RECORD_LIMIT) {
    throw new AppError('LIMIT_EXCEEDED', 'too many records', {
      details: { resource: 'records', limit: RECORD_LIMIT },
    });
  }

  if (!req.confirmDuplicate) {
    const [dup] = await db
      .select({ id: runRecords.id })
      .from(runRecords)
      .where(
        and(
          eq(runRecords.userId, userId),
          eq(runRecords.runDate, req.runDate),
          eq(runRecords.distanceM, req.distanceM),
          eq(runRecords.durationSec, req.durationSec),
        ),
      )
      .limit(1);
    if (dup) {
      throw new AppError('DUPLICATE_RECORD', 'same record already exists', {
        details: { existingRecordId: dup.id },
      });
    }
  }

  const [row] = await db
    .insert(runRecords)
    .values({
      userId,
      category: req.category,
      distanceM: req.distanceM,
      durationSec: req.durationSec,
      runDate: req.runDate,
      kind: req.kind,
      title: emptyToNull(req.title) ?? null,
    })
    .returning();
  await touchRecords(db, userId, now);
  return toRunRecord(row!, now);
}

async function loadOwned(db: Db, userId: string, recordId: string) {
  const [row] = await db
    .select()
    .from(runRecords)
    .where(and(eq(runRecords.id, recordId), eq(runRecords.userId, userId)));
  if (!row) throw notFound('record');
  return row;
}

/** PATCH /me/records/{id} — 합친 값으로 고정 거리·페이스를 다시 검사한다 */
export async function updateRecord(
  db: Db,
  userId: string,
  recordId: string,
  req: RecordPatch,
  now = new Date(),
) {
  const row = await loadOwned(db, userId, recordId);
  assertNotFuture(req.runDate, now);

  const merged = {
    category: (req.category ?? row.category) as DistanceCategory,
    distanceM: req.distanceM ?? row.distanceM,
    durationSec: req.durationSec ?? row.durationSec,
  };
  const issues = recordShapeIssues(merged);
  if (issues.length) throw validationFailed(issues);

  const [updated] = await db
    .update(runRecords)
    .set({
      ...merged,
      ...(req.runDate !== undefined && { runDate: req.runDate }),
      ...(req.kind !== undefined && { kind: req.kind }),
      ...(req.title !== undefined && { title: emptyToNull(req.title) }),
    })
    .where(eq(runRecords.id, row.id))
    .returning();
  await touchRecords(db, userId, now);
  return toRunRecord(updated!, now);
}

/** DELETE /me/records/{id} */
export async function deleteRecord(db: Db, userId: string, recordId: string, now = new Date()) {
  const row = await loadOwned(db, userId, recordId);
  await db.delete(runRecords).where(eq(runRecords.id, row.id));
  await touchRecords(db, userId, now);
}

/** GET /me/records — (run_date DESC, created_at DESC, id DESC) keyset (tech/06 4장) */
export async function listRecords(
  db: Db,
  userId: string,
  q: { cursor?: string | undefined; limit: number },
  now = new Date(),
) {
  const after = decodeCursor(q.cursor, 3) as [string, string, string] | null;
  const rows = await db
    .select()
    .from(runRecords)
    .where(
      and(
        eq(runRecords.userId, userId),
        after
          ? sql`(${runRecords.runDate}, ${runRecords.createdAt}, ${runRecords.id}) < (${after[0]}::date, ${after[1]}::timestamptz, ${after[2]}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(runRecords.runDate), desc(runRecords.createdAt), desc(runRecords.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toRunRecord(r, now)),
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor([last.runDate, last.createdAt.toISOString(), last.id])
        : null,
  };
}
