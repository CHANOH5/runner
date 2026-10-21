import type { Provider } from '@berun/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { socialUnlinkJobs } from '../../db/schema/index.js';
import { SIGNUP_TTL_SEC } from './signup-session.js';

/**
 * 소셜 연결 해제 작업 큐 자리 (tech/03 8장, F-072). 처리 워커는 다음 작업에서 만든다.
 *
 * 가입 흐름에서의 쓰임:
 * - 신규 소셜 로그인 시 "가입 만료 시각 + 1분"에 실행될 작업을 미리 넣는다 → 30분 안에 가입하지 않으면 워커가 해제
 * - 가입 중단(사용자 취소·만 14세 미만)이면 실행 시각을 지금으로 당긴다
 * - 가입이 끝나면 같은 소셜 계정의 대기 작업을 모두 지운다
 * 워커는 해제 직전에 auth_identities에 같은 계정이 없는지 다시 확인해야 한다 (중단 직후 재가입 대비).
 * Google은 ID 토큰만 받으므로 해제하지 않는다.
 */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const unlinkable = (p: Provider): p is 'kakao' | 'apple' => p === 'kakao' || p === 'apple';

export async function scheduleSignupUnlink(
  db: Db,
  v: { provider: Provider; providerUid: string; revokeTokenEnc: Buffer | null },
  now = new Date(),
): Promise<number | null> {
  if (!unlinkable(v.provider)) return null;
  const [job] = await db
    .insert(socialUnlinkJobs)
    .values({
      provider: v.provider,
      providerUid: v.providerUid,
      revokeTokenEnc: v.revokeTokenEnc,
      nextAttemptAt: new Date(now.getTime() + (SIGNUP_TTL_SEC + 60) * 1000),
    })
    .returning({ id: socialUnlinkJobs.id });
  return job!.id;
}

export async function runUnlinkNow(db: Db, jobId: number | null, now = new Date()) {
  if (jobId === null) return;
  await db
    .update(socialUnlinkJobs)
    .set({ nextAttemptAt: now })
    .where(eq(socialUnlinkJobs.id, jobId));
}

export async function cancelPendingUnlinks(tx: Tx, provider: Provider, providerUid: string) {
  await tx
    .delete(socialUnlinkJobs)
    .where(
      and(eq(socialUnlinkJobs.provider, provider), eq(socialUnlinkJobs.providerUid, providerUid)),
    );
}
