import { z } from 'zod';
import { DateStr, DateTime, Id } from './common.js';

export const PREDICTION_MODEL_VERSION = 'riegel-1.06-v1';
/** 예측 대상·입력 기록 거리 범위 (PRD 5.1, 4.12) */
export const PREDICTION_MIN_DISTANCE_M = 3000;
export const PREDICTION_MAX_DISTANCE_M = 42195;
/** 한 번에 쓸 수 있는 기록 수 (PRD 5.2) */
export const PREDICTION_MAX_RECORDS = 5;

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

/** PRD 5.4 사유 → 앱이 문구 매핑 */
export const ConfidenceReason = z.enum([
  'high',
  'single_record',
  'distance_gap',
  'cv_moderate',
  'short_records',
  'stale_records',
  'cv_high',
]);
export type ConfidenceReason = z.infer<typeof ConfidenceReason>;

export const SplitRow = z.object({
  /** 지점 (m). 마지막 행 = 목표 거리 */
  atM: z.number().int(),
  cumulativeSec: z.number().int(),
  segmentPaceSecPerKm: z.number().int(),
});
export type SplitRow = z.infer<typeof SplitRow>;

export const Splits = z.object({ even: z.array(SplitRow), negative: z.array(SplitRow) });
export type Splits = z.infer<typeof Splits>;

export const UsedRecord = z.object({
  recordId: Id,
  distanceM: z.number().int(),
  durationSec: z.number().int(),
  runDate: DateStr,
  convertedSec: z.number().int(),
});
export type UsedRecord = z.infer<typeof UsedRecord>;

/** 예측 결과 (tech/06 5장) */
export const Prediction = z.object({
  /** preview는 null (저장 안 함) */
  id: Id.nullable(),
  modelVersion: z.literal(PREDICTION_MODEL_VERSION),
  targetDistanceM: z.number().int(),
  predictedSec: z.number().int(),
  rangeMinSec: z.number().int(),
  rangeMaxSec: z.number().int(),
  rangeDisplayUnit: z.enum(['minute', 'ten_seconds']),
  avgPaceSecPerKm: z.number().int(),
  confidence: Confidence,
  confidenceReason: ConfidenceReason,
  firstFullSuggestionSec: z.number().int().nullable(),
  timeLimitWarning: z.boolean(),
  usedRecords: z.array(UsedRecord),
  splits: Splits,
  raceRegistrationId: Id.nullable(),
  race: z
    .object({
      id: Id,
      name: z.string(),
      eventName: z.string(),
      startAt: DateTime.nullable(),
    })
    .nullable(),
  recordsChangedSince: z.boolean(),
  createdAt: DateTime.nullable(),
});
export type Prediction = z.infer<typeof Prediction>;

export const PredictionTarget = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('distance'),
    distanceM: z.number().int().min(PREDICTION_MIN_DISTANCE_M).max(PREDICTION_MAX_DISTANCE_M),
  }),
  z.object({ type: z.literal('registration'), registrationId: Id }),
  /** preview 전용: S-023에서 등록 전 */
  z.object({ type: z.literal('race_event'), raceEventId: Id }),
]);
export type PredictionTarget = z.infer<typeof PredictionTarget>;

/**
 * POST /me/predictions, POST /me/predictions/preview
 * recordIds 6개 이상은 스키마가 아니라 422 LIMIT_EXCEEDED(resource=prediction_records)로 거절한다 (tech/06 6.11).
 */
export const PredictionReq = z.object({
  target: PredictionTarget,
  /** null = 자동 선택 */
  recordIds: z.array(Id).min(1).nullable(),
});
export type PredictionReq = z.infer<typeof PredictionReq>;
