import type { DistanceCategory, RegionCode } from '@berun/shared';

/**
 * 표기 규칙 (PRD 3.1·3.2). 모든 날짜·시각은 한국 표준시(Asia/Seoul) 기준으로 계산·표시한다.
 * 기기 시간대와 무관하게 같은 결과가 나오도록 UTC에 +9시간을 더해 계산한다 (KST는 서머타임 없음).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const REGION_LABELS: Record<RegionCode, string> = {
  seoul: '서울',
  busan: '부산',
  daegu: '대구',
  incheon: '인천',
  gwangju: '광주',
  daejeon: '대전',
  ulsan: '울산',
  sejong: '세종',
  gyeonggi: '경기',
  gangwon: '강원',
  chungbuk: '충북',
  chungnam: '충남',
  jeonbuk: '전북',
  jeonnam: '전남',
  gyeongbuk: '경북',
  gyeongnam: '경남',
  jeju: '제주',
};

export const CATEGORY_LABELS: Record<DistanceCategory, string> = {
  '5k': '5K',
  '10k': '10K',
  half: '하프',
  full: '풀',
  other: '기타',
};

const pad = (n: number) => String(n).padStart(2, '0');

type KstParts = { y: number; m: number; d: number; hh: number; mm: number; wd: number };

/** ISO 시각(어떤 오프셋이든) 또는 Date → KST 구성 요소 */
export function kstParts(value: string | Date): KstParts {
  const t = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    wd: t.getUTCDay(),
  };
}

/** `YYYY-MM-DD` (KST 날짜) → 구성 요소. 날짜 문자열은 시간대 변환 없이 그대로 읽는다 */
function dateParts(date: string): KstParts {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d, hh: 0, mm: 0, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** 오늘(KST) `YYYY-MM-DD` */
export function todayKst(now: Date = new Date()): string {
  const p = kstParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** `2026.11.08 (일)` */
export function formatDate(date: string): string {
  const p = dateParts(date);
  return `${p.y}.${pad(p.m)}.${pad(p.d)} (${WEEKDAYS[p.wd]})`;
}

/** `2026.08.01 (금) 10:00` */
export function formatDateTime(iso: string): string {
  const p = kstParts(iso);
  return `${p.y}.${pad(p.m)}.${pad(p.d)} (${WEEKDAYS[p.wd]}) ${pad(p.hh)}:${pad(p.mm)}`;
}

/** `08:00` */
export function formatTime(iso: string): string {
  const p = kstParts(iso);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** `8.31 (일) 23:59` — 마감 안내 (와이어프레임 S-022) */
export function formatMonthDayTime(iso: string): string {
  const p = kstParts(iso);
  return `${p.m}.${p.d} (${WEEKDAYS[p.wd]}) ${pad(p.hh)}:${pad(p.mm)}`;
}

/** `8.31` */
export function formatMonthDay(value: string): string {
  const p = value.length === 10 ? dateParts(value) : kstParts(value);
  return `${p.m}.${p.d}`;
}

/** `11.01 10:00` (홈 접수 임박) */
export function formatShortDateTime(iso: string): string {
  const p = kstParts(iso);
  return `${pad(p.m)}.${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

/** `{M월 D일}` */
export function formatKoreanMonthDay(value: string): string {
  const p = value.length === 10 ? dateParts(value) : kstParts(value);
  return `${p.m}월 ${p.d}일`;
}

/** `2026년 11월` (리스트 월별 헤더) */
export function formatMonthHeader(date: string): string {
  const p = dateParts(date);
  return `${p.y}년 ${p.m}월`;
}

/** 기록: 1시간 이상 `h:mm:ss`, 미만 `mm:ss` (PRD 3.2) */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** `h:mm` (예측 범위 분 단위, 제한 시간) */
export function formatHoursMinutes(totalSec: number): string {
  const totalMin = Math.round(totalSec / 60);
  return `${Math.floor(totalMin / 60)}:${pad(totalMin % 60)}`;
}

/** 페이스 `5'38"/km` */
export function formatPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}'${pad(s % 60)}"/km`;
}

/** 거리: 5K / 10K / 하프 / 풀 / `12.5km` (PRD 3.2) */
export function formatDistance(distanceM: number, category?: DistanceCategory): string {
  if (category && category !== 'other') return CATEGORY_LABELS[category];
  const km = distanceM / 1000;
  return `${Number.isInteger(km) ? km : Number(km.toFixed(1))}km`;
}

/** `21.1km` — 종목 표·목표 거리 표시 */
export function formatKm(distanceM: number): string {
  const km = Math.round(distanceM / 100) / 10;
  return `${km}km`;
}

/** D-day (PRD 3.1): 당일 `D-DAY`, 그 외 `D-n`, 지난 대회 null */
export function formatDDay(dDay: number | null): string | null {
  if (dDay === null || dDay < 0) return null;
  return dDay === 0 ? 'D-DAY' : `D-${dDay}`;
}

/** 두 KST 날짜 사이 일수 (b − a) */
export function daysBetween(a: string, b: string): number {
  const pa = dateParts(a);
  const pb = dateParts(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / (24 * 3600 * 1000),
  );
}

/** 지금부터 시각까지 KST 날짜 차이 (마감 D-n 등) */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return daysBetween(todayKst(now), todayKst(new Date(iso)));
}

/** 상대 시각 "방금 전" / "3분 전" / "3시간 전" / "2일 전", 7일 넘으면 날짜 (S-011) */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffSec = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  const days = Math.floor(diffSec / 86400);
  if (days <= 7) return `${days}일 전`;
  const p = kstParts(iso);
  return `${p.y}.${pad(p.m)}.${pad(p.d)}`;
}

/** "오픈까지 2일 4시간" (접수 예정 7일 이내 카운트다운, PRD 4.7) */
export function formatCountdown(iso: string, now: Date = new Date()): string {
  const diffMin = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 60000));
  const d = Math.floor(diffMin / 1440);
  const h = Math.floor((diffMin % 1440) / 60);
  const m = diffMin % 60;
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

/** 참가비 `40,000원` */
export function formatWon(krw: number): string {
  return `${krw.toLocaleString('ko-KR')}원`;
}

/** 시·분·초 → 초. 비었거나 숫자가 아니면 null */
export function hmsToSec(h: string, m: string, s: string): number | null {
  const parts = [h, m, s].map((v) => (v.trim() === '' ? 0 : Number(v)));
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  const [hh, mm, ss] = parts as [number, number, number];
  if (mm > 59 || ss > 59 || hh > 23) return null;
  return hh * 3600 + mm * 60 + ss;
}

export function secToHms(total: number): { h: string; m: string; s: string } {
  return {
    h: String(Math.floor(total / 3600)),
    m: String(Math.floor((total % 3600) / 60)),
    s: String(total % 60),
  };
}

/** `2026.10.23` (동의 날짜 토스트 등) */
export function formatDotDate(value: string): string {
  const p = value.length === 10 ? dateParts(value) : kstParts(value);
  return `${p.y}.${pad(p.m)}.${pad(p.d)}`;
}

/** KST 날짜에 일수 더하기 */
export function addDaysKst(date: string, days: number): string {
  const p = dateParts(date);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
