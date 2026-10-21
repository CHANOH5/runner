import { sql, type SQL } from 'drizzle-orm';

/**
 * 접수 알림(N-01~N-03)·홈 접수 임박의 대상 조건 (tech/03 7장, tech/06 6.5, D-019).
 * "관심만"(관심 있음 + 참가 예정 없음) ∪ 참가 예정 `not_registered`.
 * 참가 예정이 있으면 관심 여부와 무관하게 접수 상태로만 판정한다.
 *
 * 쓰는 쪽은 `race_interests`를 i, `race_registrations`를 r로 FULL JOIN (user_id, race_id) 한다.
 * 알림 워커도 이 조건을 그대로 쓴다.
 */
export const ENTRY_ALERT_AUDIENCE: SQL = sql.raw(
  `((i.user_id IS NOT NULL AND r.id IS NULL) OR r.entry_status = 'not_registered')`,
);

/** 같은 규칙의 메모리 판정 (발송 직전 재확인 등) */
export function isEntryAlertAudience(v: {
  interested: boolean;
  registration: { entryStatus: string } | null;
}): boolean {
  return v.registration ? v.registration.entryStatus === 'not_registered' : v.interested;
}
