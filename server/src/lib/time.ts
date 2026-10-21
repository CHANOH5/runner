/** 모든 날짜 계산은 Asia/Seoul (UTC+9, 서머타임 없음) 기준 (tech/06 1장, PRD 3.1) */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 시각 → KST 날짜 `YYYY-MM-DD` */
export function kstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 시각 → `2026-11-01T10:00:00+09:00` (응답은 항상 +09:00) */
export function toKstIso(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export function toKstIsoOrNull(at: Date | null): string | null {
  return at ? toKstIso(at) : null;
}

/** `b − a` 일수 (날짜 문자열 기준) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** KST 날짜 + 시각 → Date. 예: kstAt('2026-10-31', '19:00') */
export function kstAt(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

/** KST 시·분 (0~23, 0~59) */
export function kstHourMinute(at: Date): { hour: number; minute: number } {
  const local = new Date(at.getTime() + KST_OFFSET_MS);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}
