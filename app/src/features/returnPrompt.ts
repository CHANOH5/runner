import type { EntryStatus, RegistrationState } from '@berun/shared';
import { kv } from '../lib/kv';

/**
 * 공식 접수 링크에서 돌아왔을 때 묻기 — "접수 완료했나요?" (D-019, PRD 4.10.1)
 * 제한 기록은 기기에만 저장한다 (서버 저장 없음, 재설치 시 초기화 허용).
 */

export const MIN_STAY_MS = 10_000;
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
export const MAX_DISMISSALS = 3;

export type PromptRecord = {
  /** [아직이에요]·무시 누적 횟수 */
  dismissCount: number;
  lastDismissedAt: number | null;
  /** [접수 완료했어요] 또는 접수 상태 수동 변경 → 이후 묻지 않음 */
  settled: boolean;
};

export const EMPTY_RECORD: PromptRecord = {
  dismissCount: 0,
  lastDismissedAt: null,
  settled: false,
};

export function shouldAskReturnPrompt(input: {
  openedAt: number;
  returnedAt: number;
  registrationState: RegistrationState;
  /** 참가 예정이 없으면 null */
  entryStatus: EntryStatus | null;
  record: PromptRecord;
}): boolean {
  const { openedAt, returnedAt, registrationState, entryStatus, record } = input;
  // ① 10초 이상 머묾
  if (returnedAt - openedAt < MIN_STAY_MS) return false;
  // ② 돌아온 시점의 접수 상태가 접수 중 또는 접수 일정 미정
  if (registrationState !== 'open' && registrationState !== 'unscheduled') return false;
  // ③ 참가 예정이 아니거나 접수 전
  if (entryStatus !== null && entryStatus !== 'not_registered') return false;
  // ④ 횟수 제한
  if (record.settled || record.dismissCount >= MAX_DISMISSALS) return false;
  if (record.lastDismissedAt !== null && returnedAt - record.lastDismissedAt < SNOOZE_MS) {
    return false;
  }
  return true;
}

export const recordDismissal = (r: PromptRecord, now: number): PromptRecord => ({
  ...r,
  dismissCount: r.dismissCount + 1,
  lastDismissedAt: now,
});

export const recordSettled = (r: PromptRecord): PromptRecord => ({ ...r, settled: true });

/* ---------- 기기 저장 ---------- */

const key = (raceId: string) => `user.returnPrompt.${raceId}`;

export const loadPromptRecord = (raceId: string) => kv.get<PromptRecord>(key(raceId), EMPTY_RECORD);

export async function savePromptDismissed(raceId: string, now = Date.now()) {
  await kv.set(key(raceId), recordDismissal(await loadPromptRecord(raceId), now));
}

/** 접수 상태를 직접 기록·변경했으면 그 대회는 더 묻지 않는다 */
export async function savePromptSettled(raceId: string) {
  await kv.set(key(raceId), recordSettled(await loadPromptRecord(raceId)));
}
