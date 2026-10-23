import { PREDICTION_MAX_RECORDS, type Prediction, type RunKind, type Splits } from '@berun/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  predictions,
  raceEvents,
  raceRegistrations,
  races,
  runRecords,
  users,
} from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { AppError, notFound } from '../../lib/errors.js';
import { kstDate, toKstIso } from '../../lib/time.js';
import { isPredictionSupported } from '../races/summary.js';
import { toRunRecord } from '../records/service.js';
import { buildSplits, emptyReason, rankCandidates } from './engine.js';
import { createPrediction, type PredictionSnapshot } from './service.js';

type PredictionRow = typeof predictions.$inferSelect;

/** S-032 반영 라벨 (w ≥ 0.7 / ≥ 0.4 / < 0.4) */
const weightLabel = (w: number): 'high' | 'medium' | 'low' =>
  w >= 0.7 - 1e-9 ? 'high' : w >= 0.4 - 1e-9 ? 'medium' : 'low';

/** GET /me/predictions/candidates?targetDistanceM= — eligible 기록 + 자동 선택 상위 5개 + 반영 라벨 */
export async function predictionCandidates(
  db: Db,
  userId: string,
  targetDistanceM: number,
  now = new Date(),
) {
  const rows = await db.select().from(runRecords).where(eq(runRecords.userId, userId));
  const engineRecords = rows.map((r) => ({ ...r, kind: r.kind as RunKind }));
  const ranked = rankCandidates(engineRecords, targetDistanceM, kstDate(now));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    records: ranked.map((r, i) => ({
      record: toRunRecord(byId.get(r.id)!, now),
      weight: Math.round(r.weight * 1000) / 1000,
      weightLabel: weightLabel(r.weight),
      autoSelected: i < PREDICTION_MAX_RECORDS,
    })),
    emptyReason: ranked.length === 0 ? emptyReason(engineRecords) : null,
  };
}

/** 저장된 예측을 그대로 응답으로 (재계산 없음, tech/06 6.11) */
function fromStored(row: PredictionRow, recordsChangedAt: Date | null): Prediction {
  const s = row.inputSnapshot as PredictionSnapshot;
  return {
    id: row.id,
    modelVersion: 'riegel-1.06-v1',
    targetDistanceM: row.targetDistanceM,
    predictedSec: row.predictedSec,
    rangeMinSec: row.rangeMinSec,
    rangeMaxSec: row.rangeMaxSec,
    rangeDisplayUnit: s.rangeDisplayUnit,
    avgPaceSecPerKm: s.avgPaceSecPerKm,
    confidence: row.confidence as Prediction['confidence'],
    confidenceReason: s.confidenceReason,
    firstFullSuggestionSec: s.firstFullSuggestionSec,
    timeLimitWarning: s.timeLimitWarning,
    usedRecords: s.records.map((r) => ({
      recordId: r.recordId,
      distanceM: r.distanceM,
      durationSec: r.durationSec,
      runDate: r.runDate,
      convertedSec: Math.round(r.convertedSec),
    })),
    splits: row.splits as Splits,
    raceRegistrationId: row.raceRegistrationId,
    // 참가 예정이 해제됐으면 대회명 대신 거리만 (PRD 6.17)
    race: row.raceRegistrationId ? s.race : null,
    recordsChangedSince: recordsChangedAt !== null && recordsChangedAt > row.createdAt,
    createdAt: toKstIso(row.createdAt),
  };
}

async function recordsChangedAt(db: Db, userId: string) {
  const [u] = await db
    .select({ at: users.recordsChangedAt })
    .from(users)
    .where(eq(users.id, userId));
  return u?.at ?? null;
}

/** GET /me/predictions — 최근 예측 요약 (created_at DESC, id) 커서. S-030은 limit=3 */
export async function listPredictions(
  db: Db,
  userId: string,
  q: { cursor?: string | undefined; limit: number },
) {
  const after = decodeCursor(q.cursor, 2) as [string, string] | null;
  const [rows, changedAt] = await Promise.all([
    db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.userId, userId),
          after
            ? sql`(${predictions.createdAt}, ${predictions.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(predictions.createdAt), desc(predictions.id))
      .limit(q.limit + 1),
    recordsChangedAt(db, userId),
  ]);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const { splits, usedRecords, ...summary } = fromStored(r, changedAt);
      return summary;
    }),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
  };
}

/** GET /me/predictions/{id} — 저장된 예측 그대로 */
export async function getPrediction(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(predictions)
    .where(and(eq(predictions.id, id), eq(predictions.userId, userId)));
  if (!row) throw notFound('prediction');
  return fromStored(row, await recordsChangedAt(db, userId));
}

/**
 * GET /registrations/{id}/strategy (F-021, tech/06 6.8): 이 참가 예정 기준 최신 예측 (없으면 새로 계산·저장) + 목표 기준 스플릿.
 * - 미지원 거리(3~42.195km 밖): 예측하지 않고 goalSplits만 (스플릿은 거리 제한 없음)
 * - 기록 없음: prediction null, 사유 no_records
 */
export async function registrationStrategy(
  db: Db,
  userId: string,
  registrationId: string,
  now = new Date(),
) {
  const [row] = await db
    .select({ reg: raceRegistrations, event: raceEvents, race: races })
    .from(raceRegistrations)
    .innerJoin(raceEvents, eq(raceEvents.id, raceRegistrations.raceEventId))
    .innerJoin(races, eq(races.id, raceRegistrations.raceId))
    .where(and(eq(raceRegistrations.id, registrationId), eq(raceRegistrations.userId, userId)));
  if (!row || row.race.publishStatus === 'draft') throw notFound('registration');

  const goalSplits =
    row.reg.goalTimeSec !== null ? buildSplits(row.reg.goalTimeSec, row.event.distanceM) : null;
  if (!isPredictionSupported(row.event.distanceM)) {
    return {
      prediction: null,
      predictionUnavailableReason: 'unsupported_distance' as const,
      goalSplits,
    };
  }

  const [latest] = await db
    .select()
    .from(predictions)
    .where(and(eq(predictions.userId, userId), eq(predictions.raceRegistrationId, registrationId)))
    .orderBy(desc(predictions.createdAt), desc(predictions.id))
    .limit(1);
  if (latest) {
    return {
      prediction: fromStored(latest, await recordsChangedAt(db, userId)),
      predictionUnavailableReason: null,
      goalSplits,
    };
  }
  try {
    const prediction = await createPrediction(
      db,
      userId,
      { target: { type: 'registration', registrationId }, recordIds: null },
      { save: true, now },
    );
    return { prediction, predictionUnavailableReason: null, goalSplits };
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_ELIGIBLE_RECORDS') {
      return { prediction: null, predictionUnavailableReason: 'no_records' as const, goalSplits };
    }
    throw err;
  }
}
