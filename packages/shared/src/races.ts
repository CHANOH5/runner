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

/** GET /races 쿼리 (tech/06 6.4). 배열은 반복 키 */
export const RaceListQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(30).optional(),
  region: arrayParam(RegionCode).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  date: DateStr.optional(),
  category: arrayParam(DistanceCategory).optional(),
  registrationState: arrayParam(z.enum(['upcoming', 'open', 'closed', 'unscheduled'])).optional(),
  fee: arrayParam(FeeBucket).optional(),
  includeEnded: boolParam.default(false),
  hideCancelled: boolParam.default(false),
}).superRefine((v, ctx) => {
  if (v.from && v.to) {
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
});
export type RaceListQuery = z.infer<typeof RaceListQuery>;

export const RacePage = Page(RaceSummary);

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
