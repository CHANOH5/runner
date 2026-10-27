import {
  AppConfig,
  ConsentStatus,
  type CreateRegistrationReq,
  type DeleteMeReq,
  HomeDeadlines,
  HomeNextRace,
  HomeRecommended,
  InterestOffRes,
  InterestOnRes,
  Me,
  MyRacePage,
  NicknameAvailability,
  NotificationPage,
  NotificationSettingsRes,
  Prediction,
  PredictionCandidates,
  PredictionPage,
  RaceDetail,
  RacePage,
  type RecordInput,
  RecordPage,
  type RecordPatch,
  Registration,
  RunRecord,
  SignupRes,
  SocialLoginRes,
  Strategy,
  TermsCurrent,
  UnreadCount,
  type DistanceCategory,
  type FeeBucket,
  type MarkReadReq,
  type PredictionReq,
  type ProfilePatch,
  type RegionCode,
  type SignupReq,
  type SocialLoginReq,
  type UpdateRegistrationReq,
} from '@berun/shared';
import { z } from 'zod';
import { newIdempotencyKey } from '../lib/device';
import type { ApiClient } from './client';

/** 대회 목록 필터 (S-020·S-021, tech/06 6.4) */
export type RaceFilters = {
  region?: RegionCode[];
  from?: string;
  to?: string;
  category?: DistanceCategory[];
  registrationState?: ('upcoming' | 'open' | 'closed' | 'unscheduled')[];
  fee?: FeeBucket[];
  includeEnded?: boolean;
  hideCancelled?: boolean;
};

/**
 * GET /app-config + 처리방침 주소 (PRD v1.11 4.2). `privacyPolicyUrl`은 T-026에서 공유 스키마에 들어온다 —
 * 그 전 서버는 이 필드를 주지 않으므로 앱에서 선택적으로 읽고, 없거나 형식이 틀리면 null로 둔다.
 * T-026 병합 후에는 공유 AppConfig를 그대로 쓰면 된다.
 */
export const AppConfigRes = AppConfig.extend({
  privacyPolicyUrl: z
    .url()
    .nullable()
    .optional()
    .catch(null)
    .transform((v) => v ?? null),
});

/** z.input을 쓰는 이유: 기본값이 있는 필드(confirmDuplicate 등)를 생략할 수 있게 */
type In<T extends z.ZodType> = z.input<T>;

export function createEndpoints(client: ApiClient) {
  const r = client.request;
  return {
    // ---- 앱 설정 · 인증 (6.1, 6.2) ----
    appConfig: () => r({ path: '/app-config', schema: AppConfigRes, auth: 'none' }),
    socialLogin: (body: SocialLoginReq) =>
      r({ method: 'POST', path: '/auth/social', body, schema: SocialLoginRes, auth: 'none' }),
    terms: () => r({ path: '/terms/current', schema: TermsCurrent, auth: 'none' }),
    nicknameAvailability: (nickname: string, signupToken?: string) =>
      r({
        path: '/nicknames/availability',
        query: { nickname },
        schema: NicknameAvailability,
        auth: signupToken ? { bearer: signupToken } : 'user',
      }),
    signup: (signupToken: string, body: SignupReq) =>
      r({
        method: 'POST',
        path: '/auth/signup',
        body,
        schema: SignupRes,
        auth: { bearer: signupToken },
      }),
    signupAbort: (signupToken: string) =>
      r({ method: 'POST', path: '/auth/signup/abort', auth: { bearer: signupToken } }),
    logout: () => r({ method: 'POST', path: '/auth/logout' }),

    // ---- 내 정보 (6.3) ----
    me: () => r({ path: '/me', schema: Me }),
    updateProfile: (body: ProfilePatch) =>
      r({ method: 'PATCH', path: '/me/profile', body, schema: Me }),
    consents: () => r({ path: '/me/consents', schema: ConsentStatus }),
    agreeConsents: (agreedTermIds: string[]) =>
      r({ method: 'POST', path: '/me/consents', body: { agreedTermIds } }),
    notificationSettings: () =>
      r({ path: '/me/notification-settings', schema: NotificationSettingsRes }),
    updateNotificationSettings: (
      body: Partial<{ registrationAlerts: boolean; ddayAlerts: boolean; marketing: boolean }>,
    ) =>
      r({
        method: 'PATCH',
        path: '/me/notification-settings',
        body,
        schema: NotificationSettingsRes,
      }),
    putDevice: (body: {
      pushToken: string | null;
      pushPermission: 'granted' | 'denied' | 'undetermined';
      appVersion: string;
      platform: 'ios' | 'android';
    }) => r({ method: 'PUT', path: '/me/device', body }),
    deleteMe: (body: In<typeof DeleteMeReq>) => r({ method: 'DELETE', path: '/me', body }),

    // ---- 대회 (6.4, 6.6, 6.9) ----
    races: (
      filters: RaceFilters & { q?: string; date?: string; cursor?: string; limit?: number },
    ) => r({ path: '/races', query: filters, schema: RacePage }),
    race: (raceId: string) => r({ path: `/races/${raceId}`, schema: RaceDetail }),
    interestOn: (raceId: string) =>
      r({ method: 'PUT', path: `/races/${raceId}/interest`, schema: InterestOnRes }),
    interestOff: (raceId: string) =>
      r({ method: 'DELETE', path: `/races/${raceId}/interest`, schema: InterestOffRes }),
    report: (raceId: string, body: { field: string; message: string }) =>
      r({
        method: 'POST',
        path: `/races/${raceId}/reports`,
        body,
        schema: z.object({ id: z.string() }),
        idempotencyKey: newIdempotencyKey(),
      }),

    // ---- 홈 (6.5) ----
    nextRace: () => r({ path: '/home/next-race', schema: HomeNextRace }),
    deadlines: () => r({ path: '/home/deadlines', schema: HomeDeadlines }),
    recommended: () => r({ path: '/home/recommended', schema: HomeRecommended }),

    // ---- 내 대회 · 참가 예정 (6.7, 6.8) ----
    myRaces: (tab: 'interested' | 'upcoming' | 'past', cursor?: string) =>
      r({ path: '/me/races', query: { tab, cursor }, schema: MyRacePage }),
    createRegistration: (raceId: string, body: In<typeof CreateRegistrationReq>) =>
      r({
        method: 'POST',
        path: `/races/${raceId}/registration`,
        body,
        schema: Registration,
        idempotencyKey: newIdempotencyKey(),
      }),
    registration: (id: string) => r({ path: `/registrations/${id}`, schema: Registration }),
    updateRegistration: (id: string, body: UpdateRegistrationReq) =>
      r({ method: 'PATCH', path: `/registrations/${id}`, body, schema: Registration }),
    deleteRegistration: (id: string) => r({ method: 'DELETE', path: `/registrations/${id}` }),
    strategy: (id: string) => r({ path: `/registrations/${id}/strategy`, schema: Strategy }),

    // ---- 기록 (6.10) ----
    records: (cursor?: string) => r({ path: '/me/records', query: { cursor }, schema: RecordPage }),
    createRecord: (body: In<typeof RecordInput>) =>
      r({
        method: 'POST',
        path: '/me/records',
        body,
        schema: RunRecord,
        idempotencyKey: newIdempotencyKey(),
      }),
    updateRecord: (id: string, body: In<typeof RecordPatch>) =>
      r({ method: 'PATCH', path: `/me/records/${id}`, body, schema: RunRecord }),
    deleteRecord: (id: string) => r({ method: 'DELETE', path: `/me/records/${id}` }),

    // ---- 예측 (6.11) ----
    predictionCandidates: (targetDistanceM: number) =>
      r({
        path: '/me/predictions/candidates',
        query: { targetDistanceM },
        schema: PredictionCandidates,
      }),
    predict: (body: PredictionReq) =>
      r({
        method: 'POST',
        path: '/me/predictions',
        body,
        schema: Prediction,
        idempotencyKey: newIdempotencyKey(),
      }),
    previewPrediction: (body: PredictionReq) =>
      r({ method: 'POST', path: '/me/predictions/preview', body, schema: Prediction }),
    predictions: (limit: number, cursor?: string) =>
      r({ path: '/me/predictions', query: { limit, cursor }, schema: PredictionPage }),
    prediction: (id: string) => r({ path: `/me/predictions/${id}`, schema: Prediction }),

    // ---- 알림 (6.12) ----
    notifications: (cursor?: string) =>
      r({ path: '/me/notifications', query: { cursor }, schema: NotificationPage }),
    unreadCount: () => r({ path: '/me/notifications/unread-count', schema: UnreadCount }),
    markRead: (body: MarkReadReq) => r({ method: 'POST', path: '/me/notifications/read', body }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
