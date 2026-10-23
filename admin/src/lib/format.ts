import type { RegionCode } from '@berun/shared';

/** 시·도 (RegionCode) → 표시 이름 */
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

export const STATUS_LABELS = {
  scheduled: '예정',
  postponed: '연기',
  cancelled: '취소',
  finished: '종료',
} as const;
export const PUBLISH_LABELS = { draft: '초안', published: '게시', hidden: '숨김' } as const;
export const RACE_TYPE_LABELS = {
  road: '도로',
  trail: '트레일',
  ultra: '울트라',
  track: '트랙',
  virtual: '온라인',
} as const;
export const METHOD_LABELS = { first_come: '선착순', lottery: '추첨', unknown: '모름' } as const;
export const CATEGORY_LABELS = {
  '5k': '5K',
  '10k': '10K',
  half: '하프',
  full: '풀',
  other: '기타',
} as const;
export const REPORT_FIELD_LABELS: Record<string, string> = {
  date: '대회 일시',
  venue: '장소',
  events: '종목·거리',
  fee: '참가비',
  registration: '접수 기간',
  links: '링크',
  status: '취소·연기',
  other: '기타',
};

const KST = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 오늘 (KST) YYYY-MM-DD */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + KST).toISOString().slice(0, 10);
}

/**
 * 빠른 날짜 입력 (PRD 8.4.1): `2027-03-15`, `20270315`, `0315`(올해 또는 다음 해 중 가까운 미래).
 * 해석할 수 없으면 null.
 */
export function parseQuickDate(input: string, now = new Date()): string | null {
  const s = input.trim().replace(/[./]/g, '-');
  let y: number;
  let m: number;
  let d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{2})-?(\d{2})$/.exec(s))) {
    const today = todayKst(now);
    [m, d] = [Number(match[1]), Number(match[2])];
    y = Number(today.slice(0, 4));
    if (`${y}-${pad(m)}-${pad(d)}` < today) y += 1;
  } else {
    return null;
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** 빠른 시각 입력: `1000` → 10:00, `9` → 09:00, `930` → 09:30, `8:05` → 08:05 */
export function parseQuickTime(input: string): string | null {
  const s = input.trim().replace(/\s/g, '');
  if (!s) return null;
  let h: number;
  let m: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2}):(\d{2})$/.exec(s))) [h, m] = [Number(match[1]), Number(match[2])];
  else if (/^\d{1,2}$/.test(s)) [h, m] = [Number(s), 0];
  else if (/^\d{3,4}$/.test(s)) [h, m] = [Number(s.slice(0, -2)), Number(s.slice(-2))];
  else return null;
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** "2026.11.08 (일)" */
export function formatDate(date: string | null): string {
  if (!date) return '—';
  return `${date.replace(/-/g, '.')} (${weekday(date)})`;
}

/** ISO(+09:00) → { date: YYYY-MM-DD, time: HH:mm } (KST) */
export function splitKst(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const k = new Date(new Date(iso).getTime() + KST).toISOString();
  return { date: k.slice(0, 10), time: k.slice(11, 16) };
}

/** KST 날짜 + 시각 → ISO +09:00 */
export const kstIso = (date: string, time: string) => `${date}T${time}:00+09:00`;

/** "10.21 09:12" */
export function shortDateTime(iso: string | null): string {
  if (!iso) return '—';
  const { date, time } = splitKst(iso);
  return `${date.slice(5).replace('-', '.')} ${time}`;
}
export const shortDate = (iso: string | null) =>
  iso ? splitKst(iso).date.slice(5).replace('-', '.') : '—';

/** "37.5665, 126.9780" 붙여넣기 → 좌표 */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

/** 분류 자동 제안 (PRD 3.3) */
export function suggestCategory(distanceM: number): '5k' | '10k' | 'half' | 'full' | 'other' {
  if (distanceM >= 4500 && distanceM <= 5500) return '5k';
  if (distanceM >= 9500 && distanceM <= 10500) return '10k';
  if (distanceM >= 21000 && distanceM <= 21200) return 'half';
  if (distanceM >= 42000 && distanceM <= 42300) return 'full';
  return 'other';
}

/** 제한 시간 참고값 (placeholder, 저장하지 않음 — PRD 8.4.3) */
export const TIME_LIMIT_HINT: Record<string, number> = {
  '5k': 60,
  '10k': 90,
  half: 180,
  full: 300,
};

export const number = (n: number) => n.toLocaleString('ko-KR');
