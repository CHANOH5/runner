import { kstDate, kstHourMinute } from '../../lib/time.js';
import type { DeliverableKind } from './kinds.js';

/** 알림 문구 (PRD 7.2 초안). 제목 최대 30자, 본문 최대 60자 — 넘치면 대회명을 20자로 줄이고 "…" */
export const TITLE_MAX = 30;
export const BODY_MAX = 60;
const NAME_SHORT = 20;
const NAME_MIN = 8;

export type RenderInput = {
  kind: DeliverableKind;
  race: { id: string; name: string; registrationMethod: string };
  /** 유효 오픈 시각과 시각 확정 여부 */
  opensAt: Date | null;
  opensTimeKnown: boolean;
  /** 이 사용자의 마감 시각 (참가 예정 종목 마감 → 없으면 유효 마감) */
  closesAt: Date | null;
  /** 대회 유효 접수 기간이 이미 마감됐는지 (N-04 본문 변형) */
  registrationClosed: boolean;
  event: { name: string; startAt: Date | null } | null;
  registration: {
    id: string;
    goalTimeSec: number | null;
    goalPaceSecPerKm: number | null;
    entryStatus: string;
  } | null;
  /** N-06c: "{바뀐 항목}: {새 값}" */
  changeSummary?: string | null;
};

export type Rendered = { title: string; body: string; deepLink: string };

const pad = (n: number) => String(n).padStart(2, '0');
const len = (s: string) => [...s].length;

export function hhmm(at: Date): string {
  const { hour, minute } = kstHourMinute(at);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "11월 1일 10:00" */
export function monthDayTime(at: Date): string {
  const [, m, d] = kstDate(at).split('-').map(Number) as [number, number, number];
  return `${m}월 ${d}일 ${hhmm(at)}`;
}

/** 기록 표기: 1시간 이상 h:mm:ss, 미만 mm:ss (PRD 3.2) */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 페이스 표기 m'ss" (PRD 3.2) */
export function formatPace(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}'${pad(secPerKm % 60)}"`;
}

/** 받침 있는 글자인지 (한글은 종성, 숫자·영문은 읽는 소리 기준) */
function hasFinalConsonant(word: string): boolean | null {
  const ch = [...word.replace(/[\s…)\]"'”]+$/u, '')].at(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // 영·일·삼·육·칠·팔은 받침 있음, 이·사·오·구는 없음
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  if (/[a-z]/i.test(ch)) return 'lmnr'.includes(ch.toLowerCase());
  return null;
}

/** 이/가 */
export function josaIGa(word: string): string {
  const f = hasFinalConsonant(word);
  return f === null ? '이(가)' : f ? '이' : '가';
}

function linkFor(input: RenderInput, kind: 'race' | 'register' | 'strategy'): string {
  if (kind === 'strategy' && input.registration) {
    return `berun://registrations/${input.registration.id}/strategy`;
  }
  return kind === 'register'
    ? `berun://races/${input.race.id}/register`
    : `berun://races/${input.race.id}`;
}

function renderWith(input: RenderInput, name: string): Rendered {
  const reg = input.registration;
  switch (input.kind) {
    case 'reg_open_d1':
      return {
        title: `내일 ${name} 접수가 시작돼요`,
        body:
          input.opensAt && input.opensTimeKnown
            ? `${monthDayTime(input.opensAt)} 오픈이에요. 인기 대회는 빨리 마감돼요.`
            : '오픈 시각은 공식 홈페이지를 확인하세요.',
        deepLink: linkFor(input, 'race'),
      };
    case 'reg_open_soon':
      if (!input.opensAt || !input.opensTimeKnown) {
        return {
          title: `오늘 ${name} 접수가 시작돼요`,
          body: '정확한 시각은 공식 홈페이지를 확인하세요.',
          deepLink: linkFor(input, 'race'),
        };
      }
      return {
        title: `${name} 접수 10분 전이에요`,
        body:
          input.race.registrationMethod === 'lottery'
            ? `${hhmm(input.opensAt)}에 추첨 접수가 열려요. 마감 전까지만 신청하면 돼요.`
            : `${hhmm(input.opensAt)}에 접수가 열려요. 지금 접수 페이지를 열어두세요.`,
        deepLink: linkFor(input, 'race'),
      };
    case 'reg_close_d1':
      return {
        title: `${name} 접수가 내일 마감돼요`,
        body: `${input.closesAt ? `${monthDayTime(input.closesAt)} 마감이에요. ` : ''}아직 접수 전이라면 서둘러주세요.`,
        deepLink: linkFor(input, 'race'),
      };
    case 'race_d7': {
      const title = `${name}까지 일주일 남았어요`;
      if (reg?.entryStatus === 'not_registered' && input.registrationClosed) {
        return {
          title,
          body: '아직 접수 전으로 되어 있어요. 접수했다면 접수 상태를 바꿔주세요.',
          deepLink: linkFor(input, 'race'),
        };
      }
      if (reg?.goalTimeSec != null) {
        return {
          title,
          body: `${input.event?.name ?? ''} 목표 ${formatDuration(reg.goalTimeSec)} · 구간별 페이스를 확인해보세요.`.trim(),
          deepLink: linkFor(input, 'strategy'),
        };
      }
      return {
        title,
        body: '목표 기록을 정하고 페이스 전략을 받아보세요.',
        deepLink: linkFor(input, 'register'),
      };
    }
    case 'race_d1': {
      const start = input.event?.startAt ? hhmm(input.event.startAt) : null;
      if (reg?.goalPaceSecPerKm != null) {
        const pace = `목표 페이스 ${formatPace(reg.goalPaceSecPerKm)}/km`;
        return {
          title: `내일은 ${name}!`,
          body: `${start ? `${start} 출발 · ` : ''}${pace}. 푹 자고 내일 만나요.`,
          deepLink: linkFor(input, 'strategy'),
        };
      }
      return {
        title: `내일은 ${name}!`,
        body: start ? `${start} 출발이에요. 즐겁게 완주하세요!` : '즐겁게 완주하세요!',
        deepLink: linkFor(input, 'race'),
      };
    }
    case 'race_cancelled':
      return {
        title: `${name}${josaIGa(name)} 취소됐어요`,
        body: '자세한 내용은 공식 홈페이지를 확인해주세요. 환불은 주최 측에 문의해주세요.',
        deepLink: linkFor(input, 'race'),
      };
    case 'race_postponed':
      return {
        title: `${name}${josaIGa(name)} 연기됐어요`,
        body: '새 일정은 공식 홈페이지를 확인해주세요.',
        deepLink: linkFor(input, 'race'),
      };
    case 'race_schedule_changed':
      return {
        title: `${name} 일정이 바뀌었어요`,
        body: `${input.changeSummary ? `${input.changeSummary}. ` : ''}공식 홈페이지에서 한 번 더 확인해주세요.`,
        deepLink: linkFor(input, 'race'),
      };
  }
}

const fits = (r: Rendered) => len(r.title) <= TITLE_MAX && len(r.body) <= BODY_MAX;

/**
 * 넘치면 대회명을 20자 + "…"로 줄인다 (PRD 7.2). 그래도 넘치면(예: N-01 제목은 고정 문구가 12자라
 * 20자 이름으로 33자) 들어갈 때까지 더 줄인다 — 최소 8자. 본문 고정 문구가 60자를 넘는 경우(N-06a)는 그대로 둔다.
 */
export function render(input: RenderInput): Rendered {
  const full = renderWith(input, input.race.name);
  if (fits(full)) return full;
  const chars = [...input.race.name];
  let best = full;
  for (let n = Math.min(NAME_SHORT, chars.length - 1); n >= NAME_MIN; n--) {
    best = renderWith(input, `${chars.slice(0, n).join('')}…`);
    if (fits(best)) return best;
  }
  return best;
}

/**
 * 묶음 푸시 (PRD 7.1): 같은 사용자·같은 종류·같은 예약 시각 2건 이상 → 푸시 1건, 탭하면 S-011.
 * 문구는 PRD에 예시 하나("내일 접수가 시작되는 관심 대회 3개")만 있어 나머지는 초안 [미정].
 */
const BUNDLE_TITLES: Record<DeliverableKind, (n: number) => string> = {
  reg_open_d1: (n) => `내일 접수가 시작되는 관심 대회 ${n}개`,
  reg_open_soon: (n) => `곧 접수가 열리는 대회 ${n}개`,
  reg_close_d1: (n) => `내일 접수가 마감되는 대회 ${n}개`,
  race_d7: (n) => `일주일 남은 대회 ${n}개`,
  race_d1: (n) => `내일 열리는 대회 ${n}개`,
  race_cancelled: (n) => `취소된 대회 ${n}개`,
  race_postponed: (n) => `연기된 대회 ${n}개`,
  race_schedule_changed: (n) => `일정이 바뀐 대회 ${n}개`,
};

export function renderBundle(kind: DeliverableKind, raceNames: string[]): Rendered {
  const names: string[] = [];
  for (const name of raceNames) {
    const next = [...names, name].join(', ');
    const rest = raceNames.length - names.length - 1;
    if (len(next) + (rest > 0 ? ` 외 ${rest}개`.length : 0) > BODY_MAX && names.length > 0) break;
    names.push(name);
  }
  const rest = raceNames.length - names.length;
  return {
    title: BUNDLE_TITLES[kind](raceNames.length),
    body: `${names.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}`,
    deepLink: 'berun://notifications',
  };
}
