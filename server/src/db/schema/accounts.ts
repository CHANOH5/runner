import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, pk, timestamptz, updatedAt } from './columns.js';

export const users = pgTable(
  'users',
  {
    id: pk(),
    /** 소셜에서 받은 이메일, 비공개 (P-PRI-02) */
    email: text('email'),
    /** active | dormant | suspended | deleted */
    status: text('status').notNull().default('active'),
    /** 만 14세 확인용 (P-ACC-01) */
    birthYear: smallint('birth_year').notNull(),
    /** 마지막 접속 (소셜 로그인·가입·토큰 회전). 휴면 판정 기준 (P-RET-03, T-023) */
    lastLoginAt: timestamptz('last_login_at'),
    /** 휴면 30일 전 안내를 보낸 시각. 다시 접속하면 null (P-RET-03) */
    dormancyNotifiedAt: timestamptz('dormancy_notified_at'),
    /** 기록 추가·수정·삭제 시각 → 예측 recordsChangedSince (PRD 6.14) */
    recordsChangedAt: timestamptz('records_changed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 휴면 배치 대상 찾기 (T-023)
  (t) => [index('users_status_last_login_idx').on(t.status, t.lastLoginAt)],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** kakao | apple | google */
    provider: text('provider').notNull(),
    providerUid: text('provider_uid').notNull(),
    /** Apple refresh token (암호화). 탈퇴 시 revoke용 (F-072) */
    revokeTokenEnc: bytea('revoke_token_enc'),
    createdAt: createdAt(),
  },
  (t) => [unique('auth_identities_provider_uid_key').on(t.provider, t.providerUid)],
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 12 }).notNull(),
    /** 7일 1회 변경 제한 (PRD 4.3) */
    nicknameChangedAt: timestamptz('nickname_changed_at'),
    avatarUrl: text('avatar_url'),
    /** male | female | null */
    gender: text('gender'),
    regionCode: text('region_code'),
    runningSince: smallint('running_since'),
    bio: varchar('bio', { length: 100 }),
    updatedAt: updatedAt(),
  },
  // "Runner" = "runner" 중복 (PRD 4.3)
  (t) => [uniqueIndex('user_profiles_nickname_lower_key').on(sql`lower(${t.nickname})`)],
);

/** 항목별 공개 범위 (P-PRI-03) */
export const privacySettings = pgTable('privacy_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** public | participants | friends | private */
  ageVisibility: text('age_visibility').notNull().default('participants'),
  genderVisibility: text('gender_visibility').notNull().default('private'),
  regionVisibility: text('region_visibility').notNull().default('participants'),
  recordsVisibility: text('records_visibility').notNull().default('friends'),
  /** 참가자 목록 노출 (P-PRI-04) */
  listedInParticipants: boolean('listed_in_participants').notNull().default(false),
  updatedAt: updatedAt(),
});

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ios | android */
    platform: text('platform').notNull(),
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    lastSeenAt: timestamptz('last_seen_at'),
  },
  (t) => [
    uniqueIndex('devices_push_token_key')
      .on(t.pushToken)
      .where(sql`${t.pushToken} IS NOT NULL`),
  ],
);

/** refresh token (회전). 기기당 1개 세션, 재사용 감지 시 family 전체 폐기 (tech/06 2.1) */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** refresh token SHA-256 */
    tokenHash: bytea('token_hash').notNull().unique('auth_sessions_token_hash_key'),
    expiresAt: timestamptz('expires_at').notNull(),
    rotatedAt: timestamptz('rotated_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('auth_sessions_user_id_idx').on(t.userId)],
);
