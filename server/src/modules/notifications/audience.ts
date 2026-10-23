import { sql, type SQL } from 'drizzle-orm';
import { ENTRY_ALERT_AUDIENCE } from '../../lib/entry-alert-audience.js';
import { isRaceChangeKind, settingFor, type DeliverableKind } from './kinds.js';

export type AudienceTarget = {
  raceId: string;
  kind: DeliverableKind;
  /** N-03 종목별 마감 행이면 그 종목 */
  raceEventId: string | null;
};

/**
 * kind별 대상 (tech/03 7장 표, PRD 7.2, D-019). 대상 확정(발송 30분 전)과 발송 직전 재확인이 같은 쿼리를 쓴다.
 * 공통: users.status = 'active' (휴면·정지 제외, P-RET-03 — 단 N-06은 휴면 포함), 해당 알림 설정 ON (설정 행이 없으면 기본 ON).
 * 결과 열: user_id, registration_id
 */
export function audienceSql(t: AudienceTarget, onlyUserId?: string): SQL {
  let cond: SQL;
  switch (t.kind) {
    case 'reg_open_d1':
    case 'reg_open_soon':
      cond = ENTRY_ALERT_AUDIENCE;
      break;
    case 'reg_close_d1':
      cond = t.raceEventId
        ? // 종목별 마감 행: 그 종목 참가 예정자 중 접수 전
          sql`(r.race_event_id = ${t.raceEventId} AND r.entry_status = 'not_registered')`
        : // 대회 단위 행: 관심만 ∪ 접수 전 참가 예정자 중 종목 마감이 따로 없는 사람
          sql`(${ENTRY_ALERT_AUDIENCE} AND (r.id IS NULL OR e.registration_closes_at IS NULL))`;
      break;
    case 'race_d7':
    case 'race_d1':
      cond = sql`(r.id IS NOT NULL AND r.entry_status <> 'missed')`;
      break;
    default:
      // N-06: 관심 ∪ 참가 예정 (접수 상태 무관)
      cond = sql`TRUE`;
  }
  const setting = settingFor(t.kind);
  // 휴면 계정은 N-06(대회 취소·연기·일정 변경)만 받는다 (P-RET-03 예외, PRD v1.7). 정지 계정은 받지 않는다
  const statusCond = isRaceChangeKind(t.kind)
    ? sql`u.status IN ('active', 'dormant')`
    : sql`u.status = 'active'`;
  const settingCond = setting ? sql`coalesce(${sql.raw(`ns.${setting}`)}, TRUE)` : sql`TRUE`;

  return sql`
    SELECT u.id AS user_id, r.id AS registration_id
    FROM (SELECT user_id FROM race_interests WHERE race_id = ${t.raceId}) i
    FULL JOIN (SELECT * FROM race_registrations WHERE race_id = ${t.raceId}) r
      ON r.user_id = i.user_id
    JOIN users u ON u.id = coalesce(i.user_id, r.user_id)
    LEFT JOIN notification_settings ns ON ns.user_id = u.id
    LEFT JOIN race_events e ON e.id = r.race_event_id
    WHERE ${statusCond}
      AND ${cond}
      AND ${settingCond}
      ${onlyUserId ? sql`AND u.id = ${onlyUserId}` : sql``}
  `;
}
