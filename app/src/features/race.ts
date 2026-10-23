import type { EntryStatus, RaceDetail, RaceSummary, RegistrationState } from '@berun/shared';
import type { Tone } from '../components/ui';
import { daysUntil } from '../lib/format';

/** 접수 상태 배지 (PRD 4.5 표) */
export const REGISTRATION_STATE_BADGE: Record<RegistrationState, { label: string; tone: Tone }> = {
  cancelled: { label: '취소', tone: 'gray' },
  ended: { label: '종료', tone: 'gray' },
  unscheduled: { label: '접수 일정 미정', tone: 'gray' },
  upcoming: { label: '접수 예정', tone: 'blue' },
  open: { label: '접수 중', tone: 'green' },
  closed: { label: '접수 마감', tone: 'gray' },
};

/** 참가 예정의 접수 상태 (D-019, PRD 4.10.1) */
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  not_registered: '접수 전',
  registered: '접수 완료',
  missed: '접수 못 함',
};
export const ENTRY_STATUS_TONE: Record<EntryStatus, Tone> = {
  not_registered: 'yellow',
  registered: 'green',
  missed: 'gray',
};

export type BadgeSpec = { label: string; tone: Tone };

/** 카드·상세 헤더 배지: 접수 상태(+접수 예정 7일 이내 D-n) · 연기 · 접수 방식 (PRD 4.5) */
export function raceBadges(
  race: Pick<
    RaceSummary,
    'registrationState' | 'registrationOpensAt' | 'status' | 'registrationMethod'
  >,
  now: Date = new Date(),
): BadgeSpec[] {
  const state = REGISTRATION_STATE_BADGE[race.registrationState];
  const badges: BadgeSpec[] = [];
  if (race.registrationState === 'upcoming' && race.registrationOpensAt) {
    const d = daysUntil(race.registrationOpensAt, now);
    badges.push(d >= 0 && d <= 7 ? { label: `${state.label} D-${d}`, tone: state.tone } : state);
  } else {
    badges.push(state);
  }
  if (race.status === 'postponed') badges.push({ label: '연기', tone: 'yellow' });
  if (race.registrationMethod === 'first_come') badges.push({ label: '선착순', tone: 'gray' });
  if (race.registrationMethod === 'lottery') badges.push({ label: '추첨', tone: 'gray' });
  return badges;
}

/** 리스트 카드의 D-day는 30일 이내만 (PRD 4.5) */
export function cardDDay(dDay: number | null): number | null {
  return dDay !== null && dDay >= 0 && dDay <= 30 ? dDay : null;
}

/** S-023 접수 상태 기본값 (PRD 4.10 3-1): 접수 마감이면 접수 완료, 그 외 접수 전 */
export function defaultEntryStatus(state: RegistrationState): 'not_registered' | 'registered' {
  return state === 'closed' ? 'registered' : 'not_registered';
}

/** [참가 예정 추가] 가능 여부 (PRD 4.7·4.10 제약) */
export function planBlockReason(
  race: Pick<RaceDetail, 'status' | 'registrationState' | 'dDay'>,
): 'cancelled' | 'ended' | null {
  if (race.status === 'cancelled') return 'cancelled';
  if (race.registrationState === 'ended' || race.dDay === null) return 'ended';
  return null;
}

/** "아직 접수 전이에요 · 마감 …" 안내 조건 (PRD 4.10.1): 접수 전 + 대회 접수 중 */
export function showNotRegisteredHint(
  race: Pick<RaceSummary, 'registrationState'>,
  entryStatus: EntryStatus,
): boolean {
  return entryStatus === 'not_registered' && race.registrationState === 'open';
}
