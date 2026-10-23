import type { DeleteMeReq } from '@berun/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  accountDeletionStats,
  authIdentities,
  socialUnlinkJobs,
  users,
} from '../../db/schema/index.js';
import { kstDate } from '../../lib/time.js';

/**
 * DELETE /me — 회원 탈퇴 (F-072, P-ACC-04, P-RET, tech/03 8장). 한 트랜잭션:
 * 1) 소셜 연결 해제 작업(카카오 unlink·Apple revoke)을 큐에 넣는다 — 실제 호출은 워커가 따로 (외부 실패가 파기를 막지 않음).
 *    Google은 revoke할 토큰이 없어 넣지 않는다.
 * 2) 탈퇴 사유 통계: user_id·시각 없이 날짜만
 * 3) users 행 삭제 → FK CASCADE로 즉시 파기: auth_identities, auth_sessions, user_profiles, privacy_settings,
 *    notification_settings, devices(푸시 토큰), race_interests, race_registrations, run_records, predictions,
 *    notifications(미발송 예약 포함). 알림 대상은 발송 시점 쿼리로 정해지므로 이후 예약에서도 자동으로 빠진다.
 * 보존: user_consents(법정 기간 [확인 필요], FK 없음), race_reports(user_id = null로 익명화, FK SET NULL).
 * Phase 3의 라이브 세션·응원 링크 종료(P-ACC-04)는 해당 테이블이 생길 때 여기에 추가한다.
 */
export async function deleteAccount(db: Db, userId: string, req: DeleteMeReq, now = new Date()) {
  await db.transaction(async (tx) => {
    const identities = await tx
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));
    const unlink = identities.filter((i) => i.provider === 'kakao' || i.provider === 'apple');
    if (unlink.length) {
      await tx.insert(socialUnlinkJobs).values(
        unlink.map((i) => ({
          provider: i.provider,
          providerUid: i.providerUid,
          revokeTokenEnc: i.revokeTokenEnc,
          nextAttemptAt: now,
        })),
      );
    }
    await tx.insert(accountDeletionStats).values({
      reasonCode: req.reasonCode,
      reasonText: req.reasonCode === 'other' ? req.reasonText : null,
      deletedOn: kstDate(now),
    });
    await tx.delete(users).where(eq(users.id, userId));
  });
}
