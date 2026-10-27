import type { RaceFilters } from '../api/endpoints';
import { addDaysKst } from '../lib/format';
import { filtersToQuery, type RaceFilterState } from './raceFilters';

/**
 * S-020 캘린더 보기 (PRD v1.12 4.5)
 * - 지난 날짜도 "종료 포함" 필터와 상관없이 점·개수를 보이고, 누르면 그날 지난 대회 목록을 보인다
 * - 숫자와 목록이 항상 같도록 달력(`GET /races/calendar`)과 날짜 목록(`GET /races?date=`) 둘 다 includeEnded=true
 * - 다른 필터(지역·거리·접수 상태·참가비·취소 숨기기)는 두 요청에 똑같이. 기간 필터는 달이 기간이라 보내지 않는다
 */
export function calendarFilters(
  f: RaceFilterState,
  today: string,
): Omit<RaceFilters, 'from' | 'to'> {
  const { from: _from, to: _to, ...rest } = filtersToQuery({ ...f, period: null }, today);
  return { ...rest, includeEnded: true };
}

export const calendarDayQuery = (f: RaceFilterState, today: string, date: string) => ({
  ...calendarFilters(f, today),
  date,
});

/** 달 이동 */
export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 볼 수 있는 달: 이번 달 −1 ~ +12 (PRD 4.5) */
export const calendarMonthRange = (today: string) => ({
  min: monthShift(today.slice(0, 7), -1),
  max: monthShift(today.slice(0, 7), 12),
});

export const lastDayOfMonth = (month: string) => addDaysKst(`${monthShift(month, 1)}-01`, -1);

/** 날짜 칸 표시: 개수(10 이상 "9+"), 지난 날짜는 흐리게 (PRD v1.12 4.5) */
export function calendarCell(date: string, count: number, today: string) {
  return {
    label: count === 0 ? null : count > 9 ? '9+' : String(count),
    past: date < today,
    isToday: date === today,
  };
}
