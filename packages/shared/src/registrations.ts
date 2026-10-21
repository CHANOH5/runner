import { z } from 'zod';
import { DateTime, Id } from './common.js';

/** 접수 전 / 접수 완료 / 접수 못 함 (D-019, PRD 4.10.1) */
export const EntryStatus = z.enum(['not_registered', 'registered', 'missed']);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const EntryStatusSource = z.enum(['form', 'return_prompt', 'race_detail', 'my_races']);
export type EntryStatusSource = z.infer<typeof EntryStatusSource>;

export const GoalSource = z.enum(['prediction', 'manual', 'none']);
export type GoalSource = z.infer<typeof GoalSource>;

/** 목표 페이스 허용 범위 2'50"~15'00"/km (PRD 4.10) */
export const GOAL_PACE_MIN_SEC_PER_KM = 170;
export const GOAL_PACE_MAX_SEC_PER_KM = 900;
/** 미래 대회 참가 예정 최대 개수 */
export const REGISTRATION_LIMIT = 30;

/** 참가 예정 요약 (tech/06 5장) */
export const RegistrationBrief = z.object({
  id: Id,
  raceEventId: Id,
  eventName: z.string(),
  eventDistanceM: z.number().int(),
  /** 3,000 ≤ 종목 거리 ≤ 42,195 */
  predictionSupported: z.boolean(),
  goalTimeSec: z.number().int().nullable(),
  goalPaceSecPerKm: z.number().int().nullable(),
  entryStatus: EntryStatus,
  entryStatusUpdatedAt: DateTime.nullable(),
});
export type RegistrationBrief = z.infer<typeof RegistrationBrief>;

/** 참가 예정 (tech/06 6.8) */
export const Registration = z.object({
  id: Id,
  raceId: Id,
  raceEventId: Id,
  eventName: z.string(),
  eventDistanceM: z.number().int(),
  goalTimeSec: z.number().int().nullable(),
  goalPaceSecPerKm: z.number().int().nullable(),
  goalSource: GoalSource,
  entryStatus: EntryStatus,
  entryStatusUpdatedAt: DateTime.nullable(),
  /** 이 참가 예정에 연결된 가장 최근 예측 */
  predictionId: Id.nullable(),
  predictionSupported: z.boolean(),
  /** 이번 요청으로 관심이 새로 켜졌으면 true (추가 시에만) */
  interestAutoEnabled: z.boolean(),
  /** 추가 시 접수 전 + 접수 예정·접수 중이면 true → 공식 접수 안내 바텀시트 (P-RACE-01) */
  showOfficialRegistrationNotice: z.boolean(),
  warnings: z.array(z.enum(['GOAL_OVER_TIME_LIMIT'])),
  createdAt: DateTime,
});
export type Registration = z.infer<typeof Registration>;

const goalRefine = (
  v: { goalSource?: GoalSource | undefined; goalTimeSec?: number | undefined },
  ctx: z.RefinementCtx,
) => {
  if (v.goalSource === undefined) {
    if (v.goalTimeSec !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['goalSource'], params: { code: 'required' } });
    }
  } else if (v.goalSource === 'none') {
    if (v.goalTimeSec !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['goalTimeSec'], params: { code: 'not_allowed' } });
    }
  } else if (v.goalTimeSec === undefined) {
    ctx.addIssue({ code: 'custom', path: ['goalTimeSec'], params: { code: 'required' } });
  }
};

const goalFields = {
  goalSource: GoalSource,
  /** goalSource가 prediction·manual일 때 필수, none이면 보내지 않는다 */
  goalTimeSec: z.number().int().positive().optional(),
};

/**
 * POST /races/{raceId}/registration
 * 명세의 `z.object(...).and(GoalInput)`과 같은 계약을 평평한 객체 + 검사로 표현했다.
 */
export const CreateRegistrationReq = z
  .object({
    raceEventId: Id,
    /** missed는 생성 불가 (400). 생략 시 서버 기본값: 유효 접수 기간이 마감이면 registered, 그 외 not_registered */
    entryStatus: z.enum(['not_registered', 'registered']).optional(),
    /** 기본 form */
    entryStatusSource: EntryStatusSource.optional(),
    ...goalFields,
  })
  .superRefine(goalRefine);
export type CreateRegistrationReq = z.infer<typeof CreateRegistrationReq>;

/** PATCH /registrations/{id} — 보낸 필드만 변경 */
export const UpdateRegistrationReq = z
  .object({
    raceEventId: Id.optional(),
    entryStatus: EntryStatus.optional(),
    /** entryStatus를 보낼 때 필수 */
    entryStatusSource: EntryStatusSource.optional(),
    goalSource: GoalSource.optional(),
    goalTimeSec: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    goalRefine(v, ctx);
    if (v.entryStatus !== undefined && v.entryStatusSource === undefined) {
      ctx.addIssue({ code: 'custom', path: ['entryStatusSource'], params: { code: 'required' } });
    }
  });
export type UpdateRegistrationReq = z.infer<typeof UpdateRegistrationReq>;
