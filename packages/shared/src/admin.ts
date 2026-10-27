import { z } from 'zod';
import { DateStr, DateTime, DistanceCategory, Id, RegionCode } from './common.js';
import { arrayParam, boolParam } from './query.js';
import { RaceStatus, RegistrationMethod } from './races.js';

/** 관리자 API (tech/06 7장, PRD 8장). prefix /api/admin/v1 */

export const AdminRole = z.enum(['owner', 'operator', 'viewer']);
export type AdminRole = z.infer<typeof AdminRole>;

// ---- 인증 (7.1) ----
export const AdminLoginReq = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});
export const AdminLoginRes = z.object({ mfaRequired: z.literal(true), mfaToken: z.string() });
export const AdminMfaReq = z.object({
  mfaToken: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/),
});
export const AdminMe = z.object({ id: Id, email: z.string(), role: AdminRole });
export type AdminMe = z.infer<typeof AdminMe>;
export const AdminMfaRes = z.object({ admin: AdminMe, csrfToken: z.string() });
/** GET /auth/me — 새로고침 뒤에도 쓰기 요청을 보낼 수 있게 세션의 CSRF 토큰을 함께 준다 (T-024) */
export const AdminSessionInfo = AdminMe.extend({ csrfToken: z.string() });

export const AdminAccount = AdminMe.extend({
  disabled: z.boolean(),
  lockedUntil: DateTime.nullable(),
});
export const AdminCreateReq = z.object({
  email: z.email().max(200),
  role: AdminRole,
  /** 첫 로그인용 비밀번호. 12자 이상 */
  password: z.string().min(12).max(200),
});
/** totpUri는 생성 응답에서 한 번만 보여준다 (인증 앱 등록용) */
export const AdminCreateRes = z.object({ admin: AdminAccount, totpUri: z.string() });
export const AdminPatchReq = z
  .object({ role: AdminRole.optional(), disabled: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, {
    params: { code: 'required' },
  });

// ---- 대회 (7.3) ----
const https = z.url().startsWith('https://');
const trimmed = (max: number) => z.string().trim().max(max);

export const AdminRaceEventInput = z.object({
  /** 없으면 신규 행 */
  id: Id.optional(),
  name: z.string().trim().min(1).max(20),
  category: DistanceCategory,
  distanceM: z.number().int().min(1000).max(100000),
  /** 날짜는 대회일 자동 (PRD 8.4.2) */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  timeLimitMin: z.number().int().min(30).max(720).nullable().default(null),
  feeKrw: z.number().int().min(0).max(1_000_000).nullable().default(null),
  capacity: z.number().int().min(1).max(100_000).nullable().default(null),
  /** 종목별 접수 기간 — 대회 접수 기간과 다를 때만 */
  registrationOpensAt: DateTime.nullable().default(null),
  registrationClosesAt: DateTime.nullable().default(null),
});
export type AdminRaceEventInput = z.infer<typeof AdminRaceEventInput>;

const SourceInput = z.object({
  kind: z.enum(['official', 'organizer']),
  name: trimmed(60).min(1),
  url: https.nullable(),
  verifiedAt: DateTime.nullable(),
});
const DiscoverySourceInput = z.object({
  kind: z.enum(['aggregator', 'news', 'user_report', 'crawler', 'manual']),
  name: trimmed(60).min(1),
  url: z.url().nullable(),
});

const raceFields = {
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .optional(),
  organizer: trimmed(60).nullable(),
  regionCode: RegionCode,
  venueName: trimmed(60).nullable(),
  venueAddress: trimmed(120).nullable(),
  /** 국내 범위 (PRD 8.4.2). 지오코딩은 D-008 확정 후 — 지금은 직접 입력 */
  venuePoint: z
    .object({ lat: z.number().min(33).max(39), lng: z.number().min(124).max(132) })
    .nullable(),
  raceDate: DateStr,
  registrationOpensAt: DateTime.nullable(),
  /** false면 서버가 opensAt을 그날 00:00 KST로 저장 */
  registrationOpensTimeKnown: z.boolean(),
  registrationClosesAt: DateTime.nullable(),
  officialUrl: https.nullable(),
  registrationUrl: https.nullable(),
  courseUrl: https.nullable(),
  raceType: z.enum(['road', 'trail', 'ultra', 'track', 'virtual']),
  registrationMethod: RegistrationMethod,
  status: RaceStatus,
  events: z.array(AdminRaceEventInput).max(30),
  extraSources: z.array(SourceInput).max(10),
  discoverySources: z.array(DiscoverySourceInput).max(20),
  /** [확인 완료 — 오늘로 갱신] */
  markVerifiedNow: z.boolean(),
  /** 일정 변경 시 N-06c 발송 (기본 체크) */
  notifyChange: z.boolean(),
};

const raceDayStart = (date: string) => Date.parse(`${date}T00:00:00+09:00`);

type DateChecked = {
  raceDate?: string | undefined;
  registrationOpensAt?: string | null | undefined;
  registrationClosesAt?: string | null | undefined;
  events?:
    { registrationOpensAt?: string | null; registrationClosesAt?: string | null }[] | undefined;
};

/** 접수 기간 순서: 오픈 < 마감 < 대회일 00:00 KST (PRD 8.4.2, tech/06 7.3) */
function checkDates(v: DateChecked, ctx: z.RefinementCtx) {
  const day = v.raceDate ? raceDayStart(v.raceDate) : null;
  const check = (
    opens: string | null | undefined,
    closes: string | null | undefined,
    path: (string | number)[],
  ) => {
    const o = opens ? Date.parse(opens) : null;
    const c = closes ? Date.parse(closes) : null;
    if (o !== null && c !== null && c <= o) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'registrationClosesAt'],
        params: { code: 'before_opens_at' },
      });
    }
    if (day !== null && c !== null && c >= day) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'registrationClosesAt'],
        params: { code: 'after_race_date' },
      });
    }
    if (day !== null && o !== null && o >= day) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'registrationOpensAt'],
        params: { code: 'after_race_date' },
      });
    }
  };
  check(v.registrationOpensAt, v.registrationClosesAt, []);
  v.events?.forEach((e, i) => check(e.registrationOpensAt, e.registrationClosesAt, ['events', i]));
}

/** PUT /races/{id} — 전체 저장 (종목 표 포함) */
export const AdminRaceInput = z
  .object({
    ...raceFields,
    organizer: raceFields.organizer.default(null),
    venueName: raceFields.venueName.default(null),
    venueAddress: raceFields.venueAddress.default(null),
    venuePoint: raceFields.venuePoint.default(null),
    registrationOpensAt: raceFields.registrationOpensAt.default(null),
    registrationOpensTimeKnown: raceFields.registrationOpensTimeKnown.default(true),
    registrationClosesAt: raceFields.registrationClosesAt.default(null),
    officialUrl: raceFields.officialUrl.default(null),
    registrationUrl: raceFields.registrationUrl.default(null),
    courseUrl: raceFields.courseUrl.default(null),
    raceType: raceFields.raceType.default('road'),
    registrationMethod: raceFields.registrationMethod.default('unknown'),
    status: raceFields.status.default('scheduled'),
    events: raceFields.events.default([]),
    extraSources: raceFields.extraSources.default([]),
    discoverySources: raceFields.discoverySources.default([]),
    markVerifiedNow: raceFields.markVerifiedNow.default(false),
    notifyChange: raceFields.notifyChange.default(true),
  })
  .superRefine(checkDates);
export type AdminRaceInput = z.infer<typeof AdminRaceInput>;

/** POST /races — 초안. 필수는 대회명·대회일·지역 3개뿐 (PRD 8.4.1) */
export const AdminRaceDraftInput = AdminRaceInput;
export type AdminRaceDraftInput = AdminRaceInput;

export const AdminRaceEvent = z.object({
  id: Id,
  name: z.string(),
  category: DistanceCategory,
  distanceM: z.number().int(),
  startTime: z.string().nullable(),
  timeLimitMin: z.number().int().nullable(),
  feeKrw: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  registrationOpensAt: DateTime.nullable(),
  registrationClosesAt: DateTime.nullable(),
  registrationCount: z.number().int(),
});

export const PublishMissing = z.enum([
  'name',
  'raceDate',
  'regionCode',
  'officialUrl',
  'primarySourceVerified',
  'events',
  'eventFields',
  'raceTypeRoad',
  'lastVerifiedAt',
]);
export type PublishMissing = z.infer<typeof PublishMissing>;

/** 편집용 전체 */
export const AdminRace = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  organizer: z.string().nullable(),
  regionCode: RegionCode,
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  venuePoint: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  raceDate: DateStr,
  registrationOpensAt: DateTime.nullable(),
  registrationOpensTimeKnown: z.boolean(),
  registrationClosesAt: DateTime.nullable(),
  officialUrl: z.string().nullable(),
  registrationUrl: z.string().nullable(),
  courseUrl: z.string().nullable(),
  raceType: z.string(),
  registrationMethod: RegistrationMethod,
  status: RaceStatus,
  publishStatus: z.enum(['draft', 'published', 'hidden']),
  lastVerifiedAt: DateTime.nullable(),
  clonedFrom: Id.nullable(),
  events: z.array(AdminRaceEvent),
  sources: z.array(
    z.object({
      id: Id,
      kind: z.string(),
      name: z.string(),
      url: z.string().nullable(),
      isPrimary: z.boolean(),
      verifiedAt: DateTime.nullable(),
    }),
  ),
  interestCount: z.number().int(),
  registrationCount: z.number().int(),
  /** 게시 조건 미충족 항목 (게시됐으면 빈 배열) */
  publishMissing: z.array(PublishMissing),
  createdAt: DateTime,
  /** If-Match 값 */
  updatedAt: DateTime,
});
export type AdminRace = z.infer<typeof AdminRace>;

export const DedupeWarning = z.object({ id: Id, name: z.string(), raceDate: DateStr });

export const AdminRaceSaveRes = z.object({
  race: AdminRace,
  dedupeWarnings: z.array(DedupeWarning),
  sideEffects: z.object({
    notificationsRescheduled: z.boolean(),
    sentChangeNotice: z
      .enum(['race_cancelled', 'race_postponed', 'race_schedule_changed'])
      .nullable(),
    affectedUsers: z.number().int(),
  }),
});
export type AdminRaceSaveRes = z.infer<typeof AdminRaceSaveRes>;

export const AdminRaceListQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  publishStatus: arrayParam(z.enum(['draft', 'published', 'hidden'])).optional(),
  status: arrayParam(RaceStatus).optional(),
  region: arrayParam(RegionCode).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  /** 최종 확인일 30일 경과 (접수 예정·접수 중) */
  staleVerified: boolParam.optional(),
  /** 좌표 없는 게시 대회 */
  noCoords: boolParam.optional(),
  /** 게시 조건 미충족 초안 */
  publishBlocked: boolParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const AdminRaceRow = z.object({
  id: Id,
  name: z.string(),
  raceDate: DateStr,
  regionCode: RegionCode,
  status: RaceStatus,
  publishStatus: z.enum(['draft', 'published', 'hidden']),
  interestCount: z.number().int(),
  registrationCount: z.number().int(),
  lastVerifiedAt: DateTime.nullable(),
  updatedAt: DateTime,
  hasCoords: z.boolean(),
  publishMissing: z.array(PublishMissing),
});
export const AdminRacePage = z.object({
  items: z.array(AdminRaceRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const HideReq = z.object({ memo: z.string().trim().min(1).max(200) });
export const CloneReq = z.object({ shiftDates: z.boolean().optional() });
export const CloneRes = z.object({
  race: AdminRace,
  /** 노란 강조용 */
  shiftedFields: z.array(z.string()),
  renamed: z.object({ year: z.boolean(), edition: z.boolean() }),
});
export const DuplicatesQuery = z.object({
  name: z.string().trim().min(1).max(60),
  raceDate: DateStr,
});
export const Impact = z.object({
  interestCount: z.number().int(),
  registrationCount: z.number().int(),
});

// ---- 제보 (7.5) ----
export const ReportStatus = z.enum(['open', 'applied', 'rejected']);
export const AdminReportListQuery = z.object({
  status: arrayParam(ReportStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export const AdminReportRow = z.object({
  id: Id,
  raceId: Id,
  raceName: z.string(),
  field: z.string().nullable(),
  /** 내용 앞 50자 */
  preview: z.string(),
  status: ReportStatus,
  createdAt: DateTime,
  /** 미처리 72시간 경과 */
  overdue72h: z.boolean(),
});
export const AdminReportPage = z.object({
  items: z.array(AdminReportRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const AdminReportDetail = AdminReportRow.extend({
  message: z.string(),
  /** 탈퇴했으면 null ("탈퇴한 사용자") */
  reporterNickname: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: DateTime.nullable(),
  race: AdminRace,
  otherOpenReports: z.array(AdminReportRow),
});
export const REJECT_REASON_TEXT = {
  same_as_official: '공식 정보와 같아요',
  unverifiable: '근거를 확인할 수 없어요',
  already_applied: '이미 반영되어 있어요',
} as const;
export const ResolveReportsReq = z
  .object({
    ids: z.array(Id).min(1).max(50),
    action: z.enum(['applied', 'rejected']),
    rejectReason: z
      .enum(['same_as_official', 'unverifiable', 'already_applied', 'other'])
      .optional(),
    rejectText: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'rejected' && !v.rejectReason) {
      ctx.addIssue({ code: 'custom', path: ['rejectReason'], params: { code: 'required' } });
    }
    if (v.rejectReason === 'other' && !v.rejectText) {
      ctx.addIssue({ code: 'custom', path: ['rejectText'], params: { code: 'required' } });
    }
  });
export type ResolveReportsReq = z.infer<typeof ResolveReportsReq>;

// ---- 원격 설정 (7.7) ----
/** app_configs 키별 값 형식. 이 표에 없는 키는 PUT 400 */
export const APP_CONFIG_VALUES = {
  min_native_version_ios: z.string().regex(/^\d+\.\d+\.\d+$/),
  min_native_version_android: z.string().regex(/^\d+\.\d+\.\d+$/),
  maintenance: z.object({ active: z.boolean(), until: DateTime.nullable() }),
  support_email: z.email().nullable(),
  coverage_target: z.number().int().min(0).nullable(),
  /** 개인정보 처리방침 주소 (PRD v1.11 4.2) */
  privacy_policy_url: z.url({ protocol: /^https?$/ }).nullable(),
} as const;
export type AppConfigKey = keyof typeof APP_CONFIG_VALUES;
export const AppConfigKey = z.enum(
  Object.keys(APP_CONFIG_VALUES) as [AppConfigKey, ...AppConfigKey[]],
);
export const AdminAppConfig = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: DateTime,
});
export const AdminAppConfigPutReq = z.object({ value: z.unknown() });
