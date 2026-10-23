import { z } from 'zod';
import { Gender, Nickname } from './auth.js';
import { DateTime, RegionCode } from './common.js';

/** PATCH /me/profile — 보낸 필드만. 출생연도는 바꿀 수 없다 (strict → 400 unknown_field, PRD 4.3) */
export const ProfilePatch = z
  .object({
    nickname: Nickname.optional(),
    regionCode: RegionCode.optional(),
    gender: Gender.nullable().optional(),
    runningSince: z.number().int().min(1950).nullable().optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

/** 닉네임 변경 간격 (PRD 4.3) */
export const NICKNAME_COOLDOWN_DAYS = 7;

/** 항목별 공개 범위 (P-PRI-03). 다른 사용자가 보는 화면은 Phase 2 — 값만 저장한다 */
export const Visibility = z.enum(['public', 'participants', 'friends', 'private']);
export const PrivacySettings = z.object({
  ageVisibility: Visibility,
  genderVisibility: Visibility,
  regionVisibility: Visibility,
  recordsVisibility: Visibility,
  /** 참가자 목록 노출 (P-PRI-04) */
  listedInParticipants: z.boolean(),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;
export const PrivacySettingsPatch = PrivacySettings.partial().strict();

/** GET/PATCH /me/notification-settings (PRD 4.14) */
export const NotificationSettings = z.object({
  /** N-01~03 */
  registrationAlerts: z.boolean(),
  /** N-04~05 */
  ddayAlerts: z.boolean(),
  /** N-08b. 바꾸면 user_consents에 agree/withdraw 행 추가 */
  marketing: z.boolean(),
});
export const NotificationSettingsPatch = NotificationSettings.partial().strict();
export const NotificationSettingsRes = NotificationSettings.extend({
  /** 마지막 마케팅 동의·철회 시각 (날짜 토스트, PRD 4.14). 이력이 없으면 null */
  marketingChangedAt: DateTime.nullable(),
});

/** GET /me/consents (S-065) */
export const ConsentStatus = z.array(
  z.object({
    kind: z.enum(['service', 'privacy', 'marketing']),
    agreed: z.boolean(),
    agreedAt: DateTime.nullable(),
    contentUrl: z.url(),
  }),
);

/** PUT /me/device — 기기 식별은 X-Device-Id (필수) */
export const DeviceReq = z.object({
  /** Expo push token. 권한 거부면 null */
  pushToken: z.string().min(1).max(300).nullable(),
  pushPermission: z.enum(['granted', 'denied', 'undetermined']),
  appVersion: z.string().min(1).max(30),
  platform: z.enum(['ios', 'android']),
});

/** DELETE /me (F-072) */
export const DeletionReason = z.enum([
  'no_races',
  'too_many_alerts',
  'bad_prediction',
  'other_app',
  'privacy',
  'other',
]);
export const DeleteMeReq = z
  .object({
    reasonCode: DeletionReason.nullable(),
    /** reasonCode = other일 때만, 0~200자 */
    reasonText: z
      .string()
      .trim()
      .refine((s) => [...s].length <= 200, { params: { code: 'too_long' } })
      .nullable()
      .default(null),
    /** "안내를 모두 확인했어요" */
    confirmed: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (v.reasonText && v.reasonCode !== 'other') {
      ctx.addIssue({ code: 'custom', path: ['reasonText'], params: { code: 'not_allowed' } });
    }
  });
export type DeleteMeReq = z.infer<typeof DeleteMeReq>;
