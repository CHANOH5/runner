import { z } from 'zod';
import { DateStr, DateTime, DistanceCategory, Id, STANDARD_DISTANCE_M } from './common.js';
import { Page } from './query.js';

export const RunKind = z.enum(['race', 'training']);
export type RunKind = z.infer<typeof RunKind>;

/** 기록 (tech/06 5장) */
export const RunRecord = z.object({
  id: Id,
  category: DistanceCategory,
  distanceM: z.number().int(),
  durationSec: z.number().int(),
  paceSecPerKm: z.number().int(),
  runDate: DateStr,
  kind: RunKind,
  title: z.string().nullable(),
  usableForPrediction: z.boolean(),
  createdAt: DateTime,
});
export type RunRecord = z.infer<typeof RunRecord>;

/** 기록 한도·검증 값 (PRD 4.4) */
export const RECORD_LIMIT = 500;
export const RECORD_MIN_DATE = '1990-01-01';
export const RECORD_PACE_MIN_SEC_PER_KM = 150;
export const RECORD_PACE_MAX_SEC_PER_KM = 1200;
export const RECORD_OTHER_MIN_M = 1000;
export const RECORD_OTHER_MAX_M = 100000;
export const RECORD_MAX_DURATION_SEC = 23 * 3600 + 59 * 60 + 59;

/** 문자(코드포인트) 단위 길이 (PRD 3.5) */
const codePoints = (s: string) => [...s].length;

const recordFields = {
  category: DistanceCategory,
  /** 5k/10k/half/full이면 고정값과 같아야 함. other: 1,000~100,000, 100m 단위 */
  distanceM: z.number().int(),
  durationSec: z.number().int().min(1).max(RECORD_MAX_DURATION_SEC),
  /** 1990-01-01 ~ 오늘(KST). 오늘 상한은 서버가 검사한다 */
  runDate: DateStr.refine((d) => d >= RECORD_MIN_DATE, { params: { code: 'out_of_range' } }),
  kind: RunKind,
  /** 0~40자. 빈 문자열은 null로 저장 */
  title: z
    .string()
    .trim()
    .refine((s) => codePoints(s) <= 40, { params: { code: 'too_long' } })
    .nullable(),
};

type RecordShape = {
  category?: DistanceCategory | undefined;
  distanceM?: number | undefined;
  durationSec?: number | undefined;
};

/**
 * 고정 거리 일치·기타 거리 범위·페이스 범위 검사 (PRD 4.4). 서버의 부분 수정도 합친 값으로 이 함수를 쓴다.
 * 반환: fieldErrors와 같은 모양 ({ path, code })
 */
export function recordShapeIssues(v: RecordShape): { path: string; code: string }[] {
  if (v.category !== undefined && v.distanceM !== undefined) {
    if (v.category === 'other') {
      if (
        v.distanceM < RECORD_OTHER_MIN_M ||
        v.distanceM > RECORD_OTHER_MAX_M ||
        v.distanceM % 100 !== 0
      ) {
        return [{ path: 'distanceM', code: 'out_of_range' }];
      }
    } else if (v.distanceM !== STANDARD_DISTANCE_M[v.category]) {
      return [{ path: 'distanceM', code: 'invalid_value' }];
    }
  }
  if (v.distanceM !== undefined && v.durationSec !== undefined && v.distanceM > 0) {
    const pace = v.durationSec / (v.distanceM / 1000);
    if (pace < RECORD_PACE_MIN_SEC_PER_KM || pace > RECORD_PACE_MAX_SEC_PER_KM) {
      // 앱 문구 "기록을 다시 확인해주세요"
      return [{ path: 'durationSec', code: 'pace_out_of_range' }];
    }
  }
  return [];
}

const checkRecordShape = (v: RecordShape, ctx: z.RefinementCtx) => {
  for (const issue of recordShapeIssues(v)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], params: { code: issue.code } });
  }
};

/** POST /me/records (tech/06 6.10) */
export const RecordInput = z
  .object({ ...recordFields, confirmDuplicate: z.boolean().default(false) })
  .superRefine(checkRecordShape);
export type RecordInput = z.infer<typeof RecordInput>;

/** PATCH /me/records/{id} — category와 distanceM은 함께 보낸다 */
export const RecordPatch = z
  .object({
    category: recordFields.category.optional(),
    distanceM: recordFields.distanceM.optional(),
    durationSec: recordFields.durationSec.optional(),
    runDate: recordFields.runDate.optional(),
    kind: recordFields.kind.optional(),
    title: recordFields.title.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.category === undefined) !== (v.distanceM === undefined)) {
      const missing = v.category === undefined ? 'category' : 'distanceM';
      ctx.addIssue({ code: 'custom', path: [missing], params: { code: 'required' } });
    }
  });
export type RecordPatch = z.infer<typeof RecordPatch>;

export const RecordPage = Page(RunRecord);
