import { kstDate, kstHourMinute } from '../../lib/time.js';
import type { DeliverableKind, ReportResultKind } from './kinds.js';

/**
 * 알림 문구 (PRD v1.7 7.2). 제목 최대 30자, 본문 최대 60자.
 * 넘치면 대회명만 줄인다: 대회명 최대 길이 = 상한 − 고정 문구 길이 ("…"도 1자로 센다).
 */
export const TITLE_MAX = 30;
export const BODY_MAX = 60;

export type RenderInput = {
  kind: DeliverableKind | ReportResultKind;
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
  /** N-07b: 반려 사유 문구 */
  rejectReasonText?: string | null;
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
        title: `${name} 대회가 취소됐어요`,
        body: '자세한 내용은 공식 홈페이지를 확인해주세요. 환불은 주최 측에 문의해주세요.',
        deepLink: linkFor(input, 'race'),
      };
    case 'race_postponed':
      return {
        title: `${name} 대회가 연기됐어요`,
        body: '새 일정은 공식 홈페이지를 확인해주세요.',
        deepLink: linkFor(input, 'race'),
      };
    case 'race_schedule_changed':
      return {
        title: `${name} 일정이 바뀌었어요`,
        body: `${input.changeSummary ? `${input.changeSummary}. ` : ''}공식 홈페이지에서 한 번 더 확인해주세요.`,
        deepLink: linkFor(input, 'race'),
      };
    case 'report_applied':
      return {
        title: '제보가 반영됐어요',
        body: `${name} 정보를 고쳤어요. 알려주셔서 감사해요.`,
        deepLink: linkFor(input, 'race'),
      };
    case 'report_rejected':
      return {
        title: '제보를 확인했어요',
        body: `${name}: ${input.rejectReasonText ?? ''}. 다른 점이 있으면 다시 알려주세요.`,
        deepLink: linkFor(input, 'race'),
      };
  }
}

const fits = (r: Rendered) => len(r.title) <= TITLE_MAX && len(r.body) <= BODY_MAX;

/** 대회명이 들어가는 칸마다 (상한 − 고정 문구 길이) 중 가장 작은 값 = 대회명 최대 길이 */
function maxNameLength(input: RenderInput): number {
  const empty = renderWith(input, '');
  const probe = renderWith(input, 'X');
  const limits: number[] = [];
  if (probe.title !== empty.title) limits.push(TITLE_MAX - len(empty.title));
  if (probe.body !== empty.body) limits.push(BODY_MAX - len(empty.body));
  return limits.length ? Math.min(...limits) : Infinity;
}

export function render(input: RenderInput): Rendered {
  const full = renderWith(input, input.race.name);
  if (fits(full)) return full;
  const max = maxNameLength(input);
  const chars = [...input.race.name];
  if (chars.length <= max) return full; // 고정 문구 자체가 상한을 넘는 경우 — 대회명은 줄이지 않는다
  return renderWith(input, `${chars.slice(0, Math.max(max - 1, 1)).join('')}…`);
}

/**
 * 묶음 푸시 (PRD 7.1): 같은 사용자·같은 종류·같은 예약 시각 2건 이상 → 푸시 1건, 탭하면 S-011.
 * 문구는 PRD v1.7 7.1. N-02는 오픈 시각 미정 대회가 하나라도 섞이면 "오늘 접수가 시작되는"
 * (10분 뒤가 아닐 수 있으므로).
 */
const BUNDLE_TITLES: Record<DeliverableKind, (n: number) => string> = {
  reg_open_d1: (n) => `내일 접수가 시작되는 대회 ${n}개`,
  reg_open_soon: (n) => `10분 뒤 접수가 열리는 대회 ${n}개`,
  reg_close_d1: (n) => `내일 접수가 마감되는 대회 ${n}개`,
  race_d7: (n) => `일주일 뒤 열리는 대회 ${n}개`,
  race_d1: (n) => `내일 열리는 대회 ${n}개`,
  race_cancelled: (n) => `취소된 대회 ${n}개`,
  race_postponed: (n) => `연기된 대회 ${n}개`,
  race_schedule_changed: (n) => `일정이 바뀐 대회 ${n}개`,
};

export function renderBundle(
  kind: DeliverableKind,
  raceNames: string[],
  opts: { anyOpensTimeUnknown?: boolean } = {},
): Rendered {
  const names: string[] = [];
  for (const name of raceNames) {
    const next = [...names, name].join(', ');
    const rest = raceNames.length - names.length - 1;
    if (len(next) + (rest > 0 ? ` 외 ${rest}개`.length : 0) > BODY_MAX && names.length > 0) break;
    names.push(name);
  }
  const rest = raceNames.length - names.length;
  return {
    title:
      kind === 'reg_open_soon' && opts.anyOpensTimeUnknown
        ? `오늘 접수가 시작되는 대회 ${raceNames.length}개`
        : BUNDLE_TITLES[kind](raceNames.length),
    body: `${names.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}`,
    deepLink: 'berun://notifications',
  };
}
