import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
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

/**
 * 외부 소셜 연결 해제 작업 (F-072, 가입 중단 F-001, tech/03 8장).
 * 성공·재가입 확인 → 행 삭제. 최종 실패·7일 경과 → status failed + 식별자·토큰을 지우고 사유만 남긴다 (T-022).
 */
export const socialUnlinkJobs = pgTable(
  'social_unlink_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** kakao | apple */
    provider: text('provider').notNull(),
    /** 실패·만료로 끝나면 null로 지운다 (최대 7일 보관 [확인 필요]) */
    providerUid: text('provider_uid'),
    /** Apple만 */
    revokeTokenEnc: bytea('revoke_token_enc'),
    /** signup(가입 중단·만료) | account_deleted(탈퇴) */
    origin: text('origin').notNull().default('account_deleted'),
    /** pending | failed */
    status: text('status').notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    /** 첫 시도 시각 — 재시도 한도(24시간) 기준 */
    firstAttemptAt: timestamptz('first_attempt_at'),
    /** 마지막 실패 사유 (식별자·토큰 원문 없음) */
    lastError: text('last_error'),
    finishedAt: timestamptz('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('social_unlink_jobs_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    check('social_unlink_jobs_status_check', sql`${t.status} IN ('pending', 'failed')`),
    check('social_unlink_jobs_origin_check', sql`${t.origin} IN ('signup', 'account_deleted')`),
    check(
      'social_unlink_jobs_identifier_check',
      sql`${t.status} <> 'pending' OR ${t.providerUid} IS NOT NULL`,
    ),
  ],
);

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
