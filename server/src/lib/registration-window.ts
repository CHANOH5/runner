import type { RegistrationState } from '@berun/shared';
import { kstDate } from './time.js';

/**
 * 유효 접수 기간과 대회 접수 상태 (tech/06 5장, PRD 4.5).
 * 대회 목록·상세·홈·참가 예정·알림이 모두 이 함수를 쓴다.
 */

type Period = { registrationOpensAt: Date | null; registrationClosesAt: Date | null };

export type RegistrationWindow = { opensAt: Date | null; closesAt: Date | null };

const minDate = (ds: Date[]) => (ds.length ? new Date(Math.min(...ds.map((d) => +d))) : null);
const maxDate = (ds: Date[]) => (ds.length ? new Date(Math.max(...ds.map((d) => +d))) : null);

/**
 * 1) 대회 기간이 둘 다 비어 있고 종목별 기간이 있으면 종목 중 가장 이른 오픈 · 가장 늦은 마감
 *    (한쪽만 있는 값도 각각 집계). 그 밖에는 대회 기간 그대로.
 */
export function effectiveWindow(race: Period, events: Period[]): RegistrationWindow {
  if (race.registrationOpensAt === null && race.registrationClosesAt === null) {
    const opens = events.flatMap((e) => (e.registrationOpensAt ? [e.registrationOpensAt] : []));
    const closes = events.flatMap((e) => (e.registrationClosesAt ? [e.registrationClosesAt] : []));
    return { opensAt: minDate(opens), closesAt: maxDate(closes) };
  }
  return { opensAt: race.registrationOpensAt, closesAt: race.registrationClosesAt };
}

/** 대회일 00:00 KST (= 전날 23:59:59 KST까지가 "마감 없음"의 접수 기간) */
export function raceDayStart(raceDate: string): Date {
  return new Date(`${raceDate}T00:00:00+09:00`);
}

/** 판정용 마감 시각: 2) 마감이 없으면 대회 전날 23:59:59 KST까지 접수 중 */
export function judgedClosesAt(window: RegistrationWindow, raceDate: string): Date {
  return window.closesAt ?? raceDayStart(raceDate);
}

/** PRD 4.5 표 순서대로 판정 */
export function registrationState(
  race: { status: string; raceDate: string },
  window: RegistrationWindow,
  now: Date,
): RegistrationState {
  if (race.status === 'cancelled') return 'cancelled';
  if (race.raceDate < kstDate(now) || race.status === 'finished') return 'ended';
  if (window.opensAt === null) return 'unscheduled';
  if (now < window.opensAt) return 'upcoming';
  if (now < judgedClosesAt(window, race.raceDate)) return 'open';
  return 'closed';
}

/**
 * 3) 참가 예정자의 마감 시각: 고른 종목의 마감 → 없으면 유효 마감 (N-03, 홈 접수 임박).
 * 마감이 없으면 null (마감 알림·마감 행을 만들지 않는다).
 */
export function eventClosesAt(event: Period, window: RegistrationWindow): Date | null {
  return event.registrationClosesAt ?? window.closesAt;
}
