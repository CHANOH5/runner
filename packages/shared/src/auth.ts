import { z } from 'zod';
import { DateTime, Id, Provider, RegionCode } from './common.js';

/** 2~12자, 한글 완성형·영문·숫자·_·. (PRD 4.3) */
export const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9_.]+$/;
export const Nickname = z
  .string()
  .trim()
  .refine((s) => [...s].length >= 2, { params: { code: 'too_short' } })
  .refine((s) => [...s].length <= 12, { params: { code: 'too_long' } })
  .refine((s) => NICKNAME_PATTERN.test(s), { params: { code: 'invalid_format' } });

/** 가입 최소 나이 (P-ACC-01) */
export const MIN_SIGNUP_AGE = 14;
export const MIN_BIRTH_YEAR = 1926;
export const MIN_RUNNING_SINCE = 1950;

/** POST /auth/social (tech/06 6.2) */
export const SocialLoginReq = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('kakao'), accessToken: z.string().min(1) }),
  z.object({
    provider: z.literal('apple'),
    identityToken: z.string().min(1),
    authorizationCode: z.string().min(1),
  }),
  z.object({ provider: z.literal('google'), idToken: z.string().min(1) }),
]);
export type SocialLoginReq = z.infer<typeof SocialLoginReq>;

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: DateTime,
});
export type TokenPair = z.infer<typeof TokenPair>;

export const SocialLoginRes = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('logged_in'),
    tokens: TokenPair,
    /** 재동의가 필요한 필수 약관 kind */
    pendingTerms: z.array(z.string()),
    /** 이번 로그인으로 휴면(dormant)이 해제됐으면 true → 앱은 휴면 해제 안내 화면 1회 (PRD v1.6 4.1) */
    reactivated: z.boolean(),
  }),
  z.object({
    result: z.literal('signup_required'),
    signupToken: z.string(),
    signupTokenExpiresAt: DateTime,
    /** 이메일 값 자체는 앱에 돌려주지 않는다 */
    emailProvided: z.boolean(),
  }),
]);
export type SocialLoginRes = z.infer<typeof SocialLoginRes>;

/** Phase 1 동의 항목 (PRD 4.2) */
export const TermsKind = z.enum(['service', 'privacy', 'marketing']);
export type TermsKind = z.infer<typeof TermsKind>;

export const TermsVersion = z.object({
  id: Id,
  kind: TermsKind,
  version: z.string(),
  required: z.boolean(),
  contentUrl: z.url(),
  effectiveAt: DateTime,
});
export const TermsCurrent = z.array(TermsVersion);

export const NicknameAvailabilityQuery = z.object({ nickname: z.string().max(100) });
export const NicknameAvailability = z.object({
  result: z.enum(['available', 'taken', 'forbidden', 'invalid_format']),
});

export const Gender = z.enum(['male', 'female']);

/** POST /auth/signup (헤더 Authorization: Bearer {signupToken}) */
export const SignupReq = z.object({
  /** 필수 service·privacy 현재 버전 포함. marketing은 선택 */
  agreedTermIds: z.array(Id).min(2).max(10),
  profile: z.object({
    nickname: Nickname,
    birthYear: z.number().int().min(MIN_BIRTH_YEAR),
    /** (올해 − 출생연도) = 14일 때만 필수. 저장하지 않음 */
    birthdayPassedThisYear: z.boolean().optional(),
    regionCode: RegionCode,
    gender: Gender.nullable(),
    runningSince: z.number().int().min(MIN_RUNNING_SINCE).nullable(),
  }),
});
export type SignupReq = z.infer<typeof SignupReq>;

/** GET /me (tech/06 6.3) */
export const Me = z.object({
  id: Id,
  nickname: z.string(),
  /** null이면 지금 변경 가능 */
  nicknameChangeAvailableAt: DateTime.nullable(),
  birthYear: z.number().int(),
  regionCode: RegionCode,
  gender: Gender.nullable(),
  runningSince: z.number().int().nullable(),
  provider: Provider,
  pendingTerms: z.array(
    z.object({
      id: Id,
      kind: z.string(),
      version: z.string(),
      contentUrl: z.url(),
      summary: z.string().nullable(),
    }),
  ),
  counts: z.object({
    interested: z.number().int(),
    upcoming: z.number().int(),
    past: z.number().int(),
  }),
});
export type Me = z.infer<typeof Me>;

export const SignupRes = z.object({
  tokens: TokenPair,
  user: Me,
  /** 마케팅 동의 날짜 토스트 (PRD 4.2) */
  marketingAgreedAt: DateTime.nullable(),
});
export type SignupRes = z.infer<typeof SignupRes>;

export const RefreshReq = z.object({ refreshToken: z.string().min(1).max(200) });

/** POST /me/consents — 재동의 */
export const ConsentsReq = z.object({ agreedTermIds: z.array(Id).min(1).max(10) });

/** GET /app-config (tech/06 6.1) */
export const AppConfig = z.object({
  minNativeVersion: z.object({ ios: z.string(), android: z.string() }),
  maintenance: z.object({ active: z.boolean(), until: DateTime.nullable() }),
  supportEmail: z.email().nullable(),
  /** 개인정보 처리방침 주소 (PRD v1.11 4.2). null이면 앱은 "개인정보 수집·이용 동의" 전문을 연다 */
  privacyPolicyUrl: z.url({ protocol: /^https?$/ }).nullable(),
});
export type AppConfig = z.infer<typeof AppConfig>;
