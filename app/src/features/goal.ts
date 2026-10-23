import { GOAL_PACE_MAX_SEC_PER_KM, GOAL_PACE_MIN_SEC_PER_KM } from '@berun/shared';
import { formatHoursMinutes } from '../lib/format';

/**
 * 목표 기록 검증 (PRD 4.10 ④): 페이스 2'50"~15'00"/km 밖이면 에러, 제한 시간 초과는 경고만.
 * 서버도 같은 규칙으로 다시 검증한다 (422 GOAL_OUT_OF_RANGE, warnings GOAL_OVER_TIME_LIMIT).
 */
export function checkGoal(
  goalSec: number | null,
  distanceM: number,
  timeLimitMin: number | null,
): { paceSecPerKm: number | null; error: string | null; warning: string | null } {
  if (goalSec === null || goalSec <= 0) return { paceSecPerKm: null, error: null, warning: null };
  const pace = Math.round(goalSec / (distanceM / 1000));
  if (pace < GOAL_PACE_MIN_SEC_PER_KM || pace > GOAL_PACE_MAX_SEC_PER_KM) {
    return { paceSecPerKm: pace, error: '목표 기록을 다시 확인해주세요', warning: null };
  }
  const warning =
    timeLimitMin !== null && goalSec > timeLimitMin * 60
      ? `제한 시간(${formatHoursMinutes(timeLimitMin * 60)})보다 길어요. 완주 인정이 안 될 수 있어요`
      : null;
  return { paceSecPerKm: pace, error: null, warning };
}
