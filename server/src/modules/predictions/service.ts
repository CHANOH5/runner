import {
  PREDICTION_MAX_DISTANCE_M,
  PREDICTION_MAX_RECORDS,
  PREDICTION_MIN_DISTANCE_M,
  type FieldError,
  type Prediction,
  type PredictionReq,
  type RunKind,
} from '@berun/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  predictions,
  raceEvents,
  raceRegistrations,
  races,
  runRecords,
} from '../../db/schema/index.js';
import { AppError, notFound, validationFailed } from '../../lib/errors.js';
import { kstDate, toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { isEligible, predict, type PredictResult } from './engine.js';

type ResolvedTarget = {
  distanceM: number;
  timeLimitSec: number | null;
  registrationId: string | null;
  race: Prediction['race'];
};

/** predictions.input_snapshot — 저장된 예측을 다시 계산하지 않고 그대로 보여주기 위한 값 */
export type PredictionSnapshot = {
  predictionDate: string;
  target: PredictionReq['target'];
  selection: 'auto' | 'manual';
  confidenceReason: PredictResult['confidenceReason'];
  rangeDisplayUnit: PredictResult['rangeDisplayUnit'];
  avgPaceSecPerKm: number;
  cv: number;
  firstFullSuggestionSec: number | null;
  timeLimitSec: number | null;
  timeLimitWarning: boolean;
  race: Prediction['race'];
  records: {
    recordId: string;
    distanceM: number;
    durationSec: number;
    runDate: string;
    kind: RunKind;
    daysAgo: number;
    ratio: number;
    weight: number;
    appliedWeight: number;
    convertedSec: number;
  }[];
};

const isSupportedDistance = (m: number) =>
  m >= PREDICTION_MIN_DISTANCE_M && m <= PREDICTION_MAX_DISTANCE_M;

function unsupported(distanceM: number) {
  return new AppError('TARGET_DISTANCE_UNSUPPORTED', 'target distance is out of supported range', {
    details: { distanceM, min: PREDICTION_MIN_DISTANCE_M, max: PREDICTION_MAX_DISTANCE_M },
  });
}

async function resolveTarget(
  db: Db,
  userId: string,
  target: PredictionReq['target'],
): Promise<ResolvedTarget> {
  switch (target.type) {
    case 'distance':
      // 범위는 스키마에서 400으로 검사됨
      return { distanceM: target.distanceM, timeLimitSec: null, registrationId: null, race: null };

    case 'registration': {
      const [row] = await db
        .select({ reg: raceRegistrations, event: raceEvents, race: races })
        .from(raceRegistrations)
        .innerJoin(raceEvents, eq(raceEvents.id, raceRegistrations.raceEventId))
        .innerJoin(races, eq(races.id, raceRegistrations.raceId))
        .where(
          and(
            eq(raceRegistrations.id, target.registrationId),
            eq(raceRegistrations.userId, userId),
          ),
        );
      // 남의 등록도 404 (FORBIDDEN은 앱이 404처럼 처리하므로 존재 여부를 드러내지 않는다)
      if (!row) throw notFound('registration');
      if (!isSupportedDistance(row.event.distanceM)) throw unsupported(row.event.distanceM);
      return {
        distanceM: row.event.distanceM,
        timeLimitSec: row.event.timeLimitMin === null ? null : row.event.timeLimitMin * 60,
        registrationId: row.reg.id,
        race: {
          id: row.race.id,
          name: row.race.name,
          eventName: row.event.name,
          startAt: toKstIsoOrNull(row.event.startAt),
        },
      };
    }

    case 'race_event': {
      const [row] = await db
        .select({ event: raceEvents, race: races })
        .from(raceEvents)
        .innerJoin(races, eq(races.id, raceEvents.raceId))
        .where(eq(raceEvents.id, target.raceEventId));
      if (!row || row.race.publishStatus === 'draft') throw notFound('race event');
      if (row.race.publishStatus === 'hidden') {
        throw new AppError('RACE_UNAVAILABLE', 'race is hidden');
      }
      if (!isSupportedDistance(row.event.distanceM)) throw unsupported(row.event.distanceM);
      return {
        distanceM: row.event.distanceM,
        timeLimitSec: row.event.timeLimitMin === null ? null : row.event.timeLimitMin * 60,
        registrationId: null,
        race: {
          id: row.race.id,
          name: row.race.name,
          eventName: row.event.name,
          startAt: toKstIsoOrNull(row.event.startAt),
        },
      };
    }
  }
}

function toResponse(
  result: PredictResult,
  target: ResolvedTarget,
  saved: { id: string; createdAt: Date } | null,
): Prediction {
  return {
    id: saved?.id ?? null,
    modelVersion: result.modelVersion,
    targetDistanceM: result.targetDistanceM,
    predictedSec: result.predictedSec,
    rangeMinSec: result.rangeMinSec,
    rangeMaxSec: result.rangeMaxSec,
    rangeDisplayUnit: result.rangeDisplayUnit,
    avgPaceSecPerKm: result.avgPaceSecPerKm,
    confidence: result.confidence,
    confidenceReason: result.confidenceReason,
    firstFullSuggestionSec: result.firstFullSuggestionSec,
    timeLimitWarning: result.timeLimitWarning,
    usedRecords: result.used.map((r) => ({
      recordId: r.id,
      distanceM: r.distanceM,
      durationSec: r.durationSec,
      runDate: r.runDate,
      convertedSec: Math.round(r.convertedSec),
    })),
    splits: result.splits,
    raceRegistrationId: target.registrationId,
    race: target.race,
    // 방금 계산한 예측이므로 그 뒤 기록 변경은 없다
    recordsChangedSince: false,
    createdAt: saved ? toKstIso(saved.createdAt) : null,
  };
}

/**
 * POST /me/predictions (save: true) · POST /me/predictions/preview (save: false) — tech/06 6.11
 * 검사 순서: 대상(거리) → 기록 개수 한도 → 기록 조회·선택 검증 → 계산
 */
export async function createPrediction(
  db: Db,
  userId: string,
  req: PredictionReq,
  options: { save: boolean; now?: Date },
): Promise<Prediction> {
  const now = options.now ?? new Date();
  const predictionDate = kstDate(now);

  if (options.save && req.target.type === 'race_event') {
    // race_event 대상은 등록 전 추천(preview) 전용
    throw validationFailed([{ path: 'target.type', code: 'invalid_value' }]);
  }
  const target = await resolveTarget(db, userId, req.target);

  const selected = req.recordIds ? [...new Set(req.recordIds)] : null;
  if (selected && selected.length > PREDICTION_MAX_RECORDS) {
    throw new AppError('LIMIT_EXCEEDED', 'too many records selected', {
      details: { resource: 'prediction_records', limit: PREDICTION_MAX_RECORDS },
    });
  }

  const records = (
    await db
      .select({
        id: runRecords.id,
        distanceM: runRecords.distanceM,
        durationSec: runRecords.durationSec,
        runDate: runRecords.runDate,
        kind: runRecords.kind,
      })
      .from(runRecords)
      .where(eq(runRecords.userId, userId))
  ).map((r) => ({ ...r, kind: r.kind as RunKind }));

  if (selected && req.recordIds) {
    const byId = new Map(records.map((r) => [r.id, r]));
    const fieldErrors: FieldError[] = [];
    req.recordIds.forEach((id, i) => {
      const record = byId.get(id);
      if (!record) fieldErrors.push({ path: `recordIds[${i}]`, code: 'not_found' });
      else if (!isEligible(record, predictionDate)) {
        fieldErrors.push({ path: `recordIds[${i}]`, code: 'not_eligible' });
      }
    });
    if (fieldErrors.length > 0) throw validationFailed(fieldErrors);
  }

  const outcome = predict({
    predictionDate,
    targetDistanceM: target.distanceM,
    records,
    selectedRecordIds: selected,
    timeLimitSec: target.timeLimitSec,
  });
  if (!outcome.ok) {
    throw new AppError('NO_ELIGIBLE_RECORDS', 'no records usable for prediction', {
      details: { reason: outcome.reason },
    });
  }
  const { result } = outcome;
  if (!options.save) return toResponse(result, target, null);

  const snapshot: PredictionSnapshot = {
    predictionDate,
    target: req.target,
    selection: selected ? 'manual' : 'auto',
    confidenceReason: result.confidenceReason,
    rangeDisplayUnit: result.rangeDisplayUnit,
    avgPaceSecPerKm: result.avgPaceSecPerKm,
    cv: result.cv,
    firstFullSuggestionSec: result.firstFullSuggestionSec,
    timeLimitSec: target.timeLimitSec,
    timeLimitWarning: result.timeLimitWarning,
    race: target.race,
    records: result.used.map((r) => ({
      recordId: r.id,
      distanceM: r.distanceM,
      durationSec: r.durationSec,
      runDate: r.runDate,
      kind: r.kind,
      daysAgo: r.daysAgo,
      ratio: r.ratio,
      weight: r.weight,
      appliedWeight: r.appliedWeight,
      convertedSec: r.convertedSec,
    })),
  };

  const [saved] = await db
    .insert(predictions)
    .values({
      userId,
      raceRegistrationId: target.registrationId,
      targetDistanceM: result.targetDistanceM,
      predictedSec: result.predictedSec,
      rangeMinSec: result.rangeMinSec,
      rangeMaxSec: result.rangeMaxSec,
      confidence: result.confidence,
      modelVersion: result.modelVersion,
      inputSnapshot: snapshot,
      splits: result.splits,
    })
    .returning({ id: predictions.id, createdAt: predictions.createdAt });
  if (!saved) throw new Error('prediction insert returned no row');

  return toResponse(result, target, saved);
}
