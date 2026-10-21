import { kstHourMinute } from '../../lib/time.js';

/** 대회 단위 예약 알림 N-01~N-05 (notification_schedules.kind) */
export const SCHEDULED_KINDS = [
  'reg_open_d1',
  'reg_open_soon',
  'reg_close_d1',
  'race_d7',
  'race_d1',
] as const;
export type ScheduledKind = (typeof SCHEDULED_KINDS)[number];

/** 대회 변경 N-06 (관리자 저장 즉시, 끌 수 없음) */
export const RACE_CHANGE_KINDS = [
  'race_cancelled',
  'race_postponed',
  'race_schedule_changed',
] as const;
export type RaceChangeKind = (typeof RACE_CHANGE_KINDS)[number];

export type DeliverableKind = ScheduledKind | RaceChangeKind;

export const isScheduledKind = (k: string): k is ScheduledKind =>
  (SCHEDULED_KINDS as readonly string[]).includes(k);
export const isRaceChangeKind = (k: string): k is RaceChangeKind =>
  (RACE_CHANGE_KINDS as readonly string[]).includes(k);

/** 알림 설정 항목 (notification_settings, PRD 4.14). N-06은 끌 수 없다 (P-NOTI-04) */
export function settingFor(kind: DeliverableKind): 'registration_alerts' | 'dday_alerts' | null {
  if (kind === 'reg_open_d1' || kind === 'reg_open_soon' || kind === 'reg_close_d1') {
    return 'registration_alerts';
  }
  if (kind === 'race_d7' || kind === 'race_d1') return 'dday_alerts';
  return null;
}

/** 야간 = 21:00~07:59 KST (P-NOTI-02) */
export function isNightKst(at: Date): boolean {
  const { hour } = kstHourMinute(at);
  return hour >= 21 || hour < 8;
}

/**
 * 야간 발송 가능 여부. 서비스 알림(N-01~N-07)은 야간에도 보낸다 (P-NOTI-05).
 * 마케팅(N-08b)만 08:00~20:59 — 마케팅 발송은 Phase 1 공지 작업에서 같은 함수를 쓴다.
 */
export function canSendAt(kind: string, at: Date): boolean {
  return kind === 'marketing' ? !isNightKst(at) : true;
}
