import {
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, pk, timestamptz, updatedAt } from './columns.js';

/*
 * subscriptions(결제)는 Phase 4.
 */

/** 탈퇴 시 외부 소셜 연결 해제 재시도 큐 (F-072). 성공·최종 실패 시 즉시 삭제, 최대 7일 [확인 필요] */
export const socialUnlinkJobs = pgTable('social_unlink_jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** kakao | apple */
  provider: text('provider').notNull(),
  providerUid: text('provider_uid').notNull(),
  /** Apple만 */
  revokeTokenEnc: bytea('revoke_token_enc'),
  attempts: smallint('attempts').notNull().default(0),
  nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

/** 탈퇴 사유 통계 — user_id·시각 없이 날짜만 (PRD 4.15) */
export const accountDeletionStats = pgTable('account_deletion_stats', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** no_races | too_many_alerts | bad_prediction | other_app | privacy | other */
  reasonCode: text('reason_code'),
  reasonText: varchar('reason_text', { length: 200 }),
  deletedOn: date('deleted_on', { mode: 'string' }).notNull(),
});

/** 원격 설정 (강제 업데이트 등). owner만 수정 */
export const appConfigs = pgTable('app_configs', {
  /** min_native_version_ios | min_native_version_android | ... */
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});

export const adminUsers = pgTable('admin_users', {
  id: pk(),
  email: text('email').notNull().unique('admin_users_email_key'),
  /** owner | operator | viewer */
  role: text('role').notNull(),
  /** argon2id */
  passwordHash: text('password_hash').notNull(),
  /** TOTP 필수 (PRD 8.2) */
  totpSecretEnc: bytea('totp_secret_enc').notNull(),
  failedLoginCount: smallint('failed_login_count').notNull().default(0),
  /** 5회 실패 시 15분 */
  lockedUntil: timestamptz('locked_until'),
  disabledAt: timestamptz('disabled_at'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(true),
});

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  adminId: uuid('admin_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  /** 예: "주최 측 요청", 복제 원본 id (PRD 8.4) */
  memo: text('memo'),
  createdAt: createdAt(),
});

/** 파기 배치 실행 기록 (P-RET-01) */
export const deletionJobs = pgTable('deletion_jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  jobName: text('job_name').notNull(),
  deletedCount: integer('deleted_count').notNull(),
  ranAt: timestamptz('ran_at').notNull().defaultNow(),
});
