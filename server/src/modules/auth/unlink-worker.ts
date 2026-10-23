import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { authIdentities, deletionJobs, socialUnlinkJobs } from '../../db/schema/index.js';
import { sha256, type TokenCipher } from '../../lib/crypto.js';
import type { UnlinkClient, UnlinkOutcome } from './unlink-clients.js';

/**
 * 소셜 연결 해제 워커 (tech/03 8장, F-001 가입 중단·만료, F-072 탈퇴).
 * - 실행 직전 같은 provider 계정이 다시 가입했으면(auth_identities에 있으면) 해제하지 않고 작업만 지운다
 * - 성공(또는 이미 해제됨) → 행 삭제 (식별자를 남기지 않는다)
 * - 일시 실패 → 지수 백오프(1, 2, 4 … 최대 60분), 첫 시도부터 24시간이 지나면 최종 실패
 * - 최종 실패 → status failed, 식별자·토큰을 지우고 사유만 남긴다
 * 로그에는 식별자를 해시 앞 8자리로만, 토큰은 어떤 형태로도 남기지 않는다.
 */
export const UNLINK_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const UNLINK_MAX_BACKOFF_MS = 60 * 60 * 1000;
export const UNLINK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** 최종 실패 기록(식별자 없음) 보관 기간 1년 (D-020) */
export const UNLINK_FAILED_RECORD_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const CLAIM_LIMIT = 100;

export type UnlinkLogger = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

export type UnlinkDeps = {
  db: Db;
  client: UnlinkClient;
  cipher: TokenCipher | null;
  clock: () => Date;
  log: UnlinkLogger;
};

/** 로그용 식별자 마스킹: 해시 앞 8자리 (같은 계정의 로그를 묶어 볼 수는 있지만 원래 값은 알 수 없음) */
export const maskId = (value: string) => sha256(`unlink:${value}`).toString('hex').slice(0, 8);

/** n번째 실패 뒤 대기 시간: 1, 2, 4, 8 … 분, 최대 60분 */
export const backoffMs = (failures: number) =>
  Math.min(2 ** Math.max(failures - 1, 0) * 60 * 1000, UNLINK_MAX_BACKOFF_MS);

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

type JobRow = typeof socialUnlinkJobs.$inferSelect;

export type UnlinkResult = {
  done: number;
  skippedResignup: number;
  retried: number;
  failed: number;
};

async function callProvider(deps: UnlinkDeps, job: JobRow): Promise<UnlinkOutcome> {
  try {
    if (job.provider === 'kakao') return await deps.client.kakaoUnlink(job.providerUid!);
    if (job.provider === 'apple') {
      if (!job.revokeTokenEnc) return { kind: 'permanent', reason: 'no_revoke_token' };
      if (!deps.cipher) return { kind: 'transient', reason: 'cipher_missing' };
      let token: string;
      try {
        token = deps.cipher.decrypt(job.revokeTokenEnc);
      } catch {
        return { kind: 'permanent', reason: 'token_decrypt_failed' };
      }
      return await deps.client.appleRevoke(token);
    }
    return { kind: 'permanent', reason: `unsupported_provider_${job.provider}` };
  } catch {
    // 클라이언트 예외 메시지에는 요청 정보가 섞일 수 있어 남기지 않는다
    return { kind: 'transient', reason: 'client_error' };
  }
}

async function failJob(db: Db, job: JobRow, reason: string, now: Date) {
  await db
    .update(socialUnlinkJobs)
    .set({
      status: 'failed',
      providerUid: null,
      revokeTokenEnc: null,
      attempts: job.attempts + 1,
      lastError: reason,
      finishedAt: now,
    })
    .where(eq(socialUnlinkJobs.id, job.id));
}

/** 실행 시각이 된 작업을 집어(임대) 처리한다. 여러 워커가 돌아도 SKIP LOCKED로 한 번만 */
export async function processUnlinkJobs(deps: UnlinkDeps): Promise<UnlinkResult> {
  const now = deps.clock();
  const result: UnlinkResult = { done: 0, skippedResignup: 0, retried: 0, failed: 0 };
  const claimed = await deps.db.execute<{ id: number }>(sql`
    UPDATE social_unlink_jobs
    SET next_attempt_at = ${ts(new Date(now.getTime() + LEASE_MS))},
        first_attempt_at = coalesce(first_attempt_at, ${ts(now)})
    WHERE id IN (
      SELECT id FROM social_unlink_jobs
      WHERE status = 'pending' AND next_attempt_at <= ${ts(now)}
      ORDER BY next_attempt_at
      LIMIT ${CLAIM_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  if (claimed.length === 0) return result;
  const jobs = await deps.db
    .select()
    .from(socialUnlinkJobs)
    .where(
      inArray(
        socialUnlinkJobs.id,
        claimed.map((c) => Number(c.id)),
      ),
    );

  for (const job of jobs) {
    const logBase = {
      jobId: job.id,
      provider: job.provider,
      origin: job.origin,
      account: maskId(job.providerUid!),
    };

    // 같은 소셜 계정으로 다시 가입했으면 해제하면 안 된다 (가입 중단 직후 재가입, 탈퇴 직후 재가입)
    const [again] = await deps.db
      .select({ id: authIdentities.id })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, job.provider),
          eq(authIdentities.providerUid, job.providerUid!),
        ),
      )
      .limit(1);
    if (again) {
      await deps.db.delete(socialUnlinkJobs).where(eq(socialUnlinkJobs.id, job.id));
      result.skippedResignup++;
      deps.log.info(logBase, 'unlink skipped: account signed up again');
      continue;
    }

    const outcome = await callProvider(deps, job);
    if (outcome.kind === 'done') {
      await deps.db.delete(socialUnlinkJobs).where(eq(socialUnlinkJobs.id, job.id));
      result.done++;
      deps.log.info({ ...logBase, note: outcome.note }, 'unlink done');
      continue;
    }

    const firstAt = job.firstAttemptAt ?? now;
    const windowOver = now.getTime() - firstAt.getTime() >= UNLINK_RETRY_WINDOW_MS;
    if (outcome.kind === 'permanent' || windowOver) {
      const reason =
        outcome.kind === 'permanent' ? outcome.reason : `retry_window_exceeded:${outcome.reason}`;
      await failJob(deps.db, job, reason, now);
      result.failed++;
      deps.log.warn({ ...logBase, reason, attempts: job.attempts + 1 }, 'unlink failed');
      continue;
    }

    const failures = job.attempts + 1;
    await deps.db
      .update(socialUnlinkJobs)
      .set({
        attempts: failures,
        nextAttemptAt: new Date(now.getTime() + backoffMs(failures)),
        lastError: outcome.reason,
      })
      .where(eq(socialUnlinkJobs.id, job.id));
    result.retried++;
    deps.log.warn(
      { ...logBase, reason: outcome.reason, attempts: failures },
      'unlink retry scheduled',
    );
  }
  return result;
}

/**
 * 7일 정리 배치 (P-RET-01, tech/04 5장): 7일이 지나도 끝나지 않은 작업은 최종 실패로 바꾸고
 * 보관 중인 식별자·Apple 토큰을 지운다. 실행마다 deletion_jobs에 건수를 남긴다 (0건이어도).
 * 끝난 작업(failed)에는 식별자가 없으므로 사유 기록으로 남기고, 끝난 지 1년이 지나면 파기한다 (D-020).
 */
export async function purgeStaleUnlinkJobs(db: Db, now = new Date()) {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(socialUnlinkJobs)
      .set({
        status: 'failed',
        providerUid: null,
        revokeTokenEnc: null,
        lastError: sql`'expired_7d:' || coalesce(${socialUnlinkJobs.lastError}, 'not_attempted')`,
        finishedAt: now,
      })
      .where(
        and(
          eq(socialUnlinkJobs.status, 'pending'),
          lt(socialUnlinkJobs.createdAt, new Date(now.getTime() - UNLINK_RETENTION_MS)),
        ),
      )
      .returning({ id: socialUnlinkJobs.id });
    // D-020: 최종 실패 기록은 끝난 지 1년 뒤 파기
    const purged = await tx
      .delete(socialUnlinkJobs)
      .where(
        and(
          eq(socialUnlinkJobs.status, 'failed'),
          lt(
            socialUnlinkJobs.finishedAt,
            new Date(now.getTime() - UNLINK_FAILED_RECORD_RETENTION_MS),
          ),
        ),
      )
      .returning({ id: socialUnlinkJobs.id });
    await tx.insert(deletionJobs).values([
      { jobName: 'social_unlink_identifiers_7d', deletedCount: expired.length, ranAt: now },
      { jobName: 'social_unlink_failed_1y', deletedCount: purged.length, ranAt: now },
    ]);
    return { expired: expired.length, purgedFailed: purged.length };
  });
}
