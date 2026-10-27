import { z } from 'zod';
import { DateStr, DateTime, DistanceCategory, Id, RegionCode } from './common.js';
import { arrayParam, boolParam, Page, PageQuery } from './query.js';
import { RegistrationBrief } from './registrations.js';

export const RaceStatus = z.enum(['scheduled', 'postponed', 'cancelled', 'finished']);
export type RaceStatus = z.infer<typeof RaceStatus>;

/** 대회 접수 상태: 서버 계산값 (PRD 4.5, tech/06 5장 "유효 접수 기간") */
export const RegistrationState = z.enum([
  'cancelled',
  'ended',
  'unscheduled',
  'upcoming',
  'open',
  'closed',
]);
export type RegistrationState = z.infer<typeof RegistrationState>;

export const RegistrationMethod = z.enum(['first_come', 'lottery', 'unknown']);
export type RegistrationMethod = z.infer<typeof RegistrationMethod>;

export const RaceEvent = z.object({
  id: Id,
  name: z.string(),
  category: DistanceCategory,
  distanceM: z.number().int(),
  startAt: DateTime.nullable(),
  timeLimitMin: z.number().int().nullable(),
  feeKrw: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  /** 종목별 기간이 대회와 다를 때만 값 있음 */
  registrationOpensAt: DateTime.nullable(),
  registrationClosesAt: DateTime.nullable(),
});
export type RaceEvent = z.infer<typeof RaceEvent>;

/** 리스트 카드 (PRD 4.5) */
export const RaceSummary = z.object({
  id: Id,
  name: z.string(),
  raceDate: DateStr,
  regionCode: RegionCode,
  /** 분류 순서, 중복 제거 */
  categories: z.array(DistanceCategory),
  status: RaceStatus,
  registrationState: RegistrationState,
  /** 유효 접수 기간 적용값 */
  registrationOpensAt: DateTime.nullable(),
  registrationOpensTimeKnown: z.boolean(),
  /** 유효 접수 기간 적용값. null이면 앱은 마감 "미정" */
  registrationClosesAt: DateTime.nullable(),
  registrationMethod: RegistrationMethod,
  /** 대회일까지 남은 일수 (KST). 지난 대회 null */
  dDay: z.number().int().nullable(),
  my: z.object({
    interested: z.boolean(),
    /** 참가 예정 여부 (명세 필드명 유지, tech/06 1장 이름 규칙) */
    registered: z.boolean(),
  }),
});
export type RaceSummary = z.infer<typeof RaceSummary>;

/** 상세 (PRD 4.7) */
export const RaceDetail = RaceSummary.extend({
  organizer: z.string().nullable(),
  venue: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  earliestStartAt: DateTime.nullable(),
  officialUrl: z.url().nullable(),
  registrationUrl: z.url().nullable(),
  courseUrl: z.url().nullable(),
  /** 분류 순서 → 거리 순 */
  events: z.array(RaceEvent),
  /** 대표 출처만 (P-RACE-07) */
  source: z.object({ name: z.string(), url: z.url().nullable() }),
  lastVerifiedAt: DateTime,
  my: z.object({
    interested: z.boolean(),
    registration: RegistrationBrief.nullable(),
  }),
});
export type RaceDetail = z.infer<typeof RaceDetail>;

export const FeeBucket = z.enum(['le30k', '30k_50k', '50k_100k', 'gt100k']);
export type FeeBucket = z.infer<typeof FeeBucket>;

/** 기간 필터 최대 범위 (PRD 4.6) */
export const RACE_LIST_MAX_RANGE_MONTHS = 12;

/** 목록·개수·달력이 같이 쓰는 필터 (tech/06 6.4). 배열은 반복 키 */
const raceFilterFields = {
  region: arrayParam(RegionCode).optional(),
  category: arrayParam(DistanceCategory).optional(),
  registrationState: arrayParam(z.enum(['upcoming', 'open', 'closed', 'unscheduled'])).optional(),
  fee: arrayParam(FeeBucket).optional(),
  includeEnded: boolParam.default(false),
  hideCancelled: boolParam.default(false),
};
const raceRangeFields = {
  q: z.string().trim().min(1).max(30).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  date: DateStr.optional(),
};

/** from~to 최대 12개월 */
function checkRange(
  v: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (!v.from || !v.to) return;
  if (v.from > v.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], params: { code: 'out_of_range' } });
    return;
  }
  const [y, m, d] = v.from.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(y, m - 1 + RACE_LIST_MAX_RANGE_MONTHS, d))
    .toISOString()
    .slice(0, 10);
  if (v.to > limit) {
    ctx.addIssue({ code: 'custom', path: ['to'], params: { code: 'out_of_range' } });
  }
}

/** GET /races 쿼리 */
export const RaceListQuery = PageQuery.extend({
  ...raceRangeFields,
  ...raceFilterFields,
}).superRefine(checkRange);
export type RaceListQuery = z.infer<typeof RaceListQuery>;

export const RacePage = Page(RaceSummary);

/** GET /races/count — 목록 쿼리에서 cursor·limit 제외 ("128개 대회 보기") */
export const RaceCountQuery = z
  .object({ ...raceRangeFields, ...raceFilterFields })
  .superRefine(checkRange);
export type RaceCountQuery = z.infer<typeof RaceCountQuery>;
export const RaceCount = z.object({ count: z.number().int() });

/**
 * GET /races/calendar?month=2026-11 — 목록 필터 + 달. 검색어(q)와 기간(from·to·date)은 받지 않는다 (달이 기간).
 * 달 범위: 오늘(KST) 기준 −1개월 ~ +12개월 (PRD 4.5), 밖이면 400
 */
export const RaceCalendarQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  ...raceFilterFields,
});
export type RaceCalendarQuery = z.infer<typeof RaceCalendarQuery>;
export const RaceCalendar = z.object({
  month: z.string(),
  /** 대회 있는 날만, 날짜 순. 10개 이상 "9+"는 앱이 처리 */
  days: z.array(z.object({ date: DateStr, count: z.number().int() })),
});
export type RaceCalendar = z.infer<typeof RaceCalendar>;
/** 달력에서 볼 수 있는 달: 이번 달 −1 ~ +12 (PRD 4.5) */
export const RACE_CALENDAR_MONTHS_BACK = 1;
export const RACE_CALENDAR_MONTHS_AHEAD = 12;

/** GET /me/races */
export const MyRacesTab = z.enum(['interested', 'upcoming', 'past']);
export const MyRacesQuery = PageQuery.extend({ tab: MyRacesTab });
export const MyRaceItem = RaceSummary.extend({
  registration: RegistrationBrief.nullable(),
  /** hidden 대회 → 앱은 탭 시 "더 이상 볼 수 없는 대회예요" */
  unavailable: z.boolean(),
});
export type MyRaceItem = z.infer<typeof MyRaceItem>;
export const MyRacePage = Page(MyRaceItem);

/** GET /home/deadlines (tech/06 6.5) */
export const HomeDeadlines = z.object({
  items: z.array(
    z.object({
      race: RaceSummary,
      type: z.enum(['opens', 'closes']),
      at: DateTime,
      /** 오픈 시각 미정이면 false */
      timeKnown: z.boolean(),
    }),
  ),
});
export type HomeDeadlines = z.infer<typeof HomeDeadlines>;

/** 1인당 관심 대회 최대 개수 — 하트로 직접 켤 때만 검사, 개수에는 자동으로 켜진 관심도 포함 (PRD v1.6 4.8) */
export const INTEREST_LIMIT = 200;

/** PUT /races/{id}/interest */
export const InterestOnRes = z.object({
  interested: z.literal(true),
  /** 접수 예정이면 true → "접수 오픈 전에 알려드릴게요" 토스트 (PRD 4.8) */
  notifyRegistrationOpen: z.boolean(),
});
/** DELETE /races/{id}/interest */
export const InterestOffRes = z.object({
  interested: z.literal(false),
  stillRegistered: z.boolean(),
});

/** POST /races/{id}/reports (F-016) */
export const ReportField = z.enum([
  'date',
  'venue',
  'events',
  'fee',
  'registration',
  'links',
  'status',
  'other',
]);
export const ReportCreateReq = z.object({
  field: ReportField,
  /** 10~500자 (코드포인트) */
  message: z
    .string()
    .trim()
    .refine((s) => [...s].length >= 10, { params: { code: 'too_short' } })
    .refine((s) => [...s].length <= 500, { params: { code: 'too_long' } }),
});
/** 제보 한도 (KST 하루): 같은 대회 3건, 전체 10건 (PRD 4.11) */
export const REPORT_LIMIT_PER_RACE = 3;
export const REPORT_LIMIT_TOTAL = 10;

/** GET /home/next-race (tech/06 6.5) */
export const HomeNextRace = z.object({
  next: z
    .object({
      race: RaceSummary,
      registration: RegistrationBrief,
      eventCategory: DistanceCategory,
    })
    .nullable(),
  /** "외 n개 대회" */
  moreCount: z.number().int(),
  /** 기록 유도 카드 표시 여부 */
  hasAnyRecord: z.boolean(),
});
export type HomeNextRace = z.infer<typeof HomeNextRace>;

/** GET /home/recommended — 내 지역이 없으면(regionCode null) 전국으로만 채운다 */
export const HomeRecommended = z.object({
  regionCode: RegionCode.nullable(),
  items: z.array(RaceSummary),
  filledNationwide: z.boolean(),
});
export type HomeRecommended = z.infer<typeof HomeRecommended>;
