import {
  AdminRaceInput,
  type AdminRace,
  type DistanceCategory,
  type FieldError,
  type RegionCode,
} from '@berun/shared';
import { kstIso, parseLatLng, parseQuickDate, parseQuickTime, splitKst } from '@/lib/format';

/** 폼 상태는 입력 그대로(문자열) 둔다 — 빠른 입력(0315, 1000 등)을 저장 직전에 해석한다 */
export type EventRow = {
  key: string;
  id?: string;
  name: string;
  category: DistanceCategory;
  /** 사용자가 분류를 직접 고르면 거리로 다시 제안하지 않는다 (PRD 8.4.3) */
  categoryTouched: boolean;
  distanceM: string;
  startTime: string;
  timeLimitMin: string;
  feeKrw: string;
  capacity: string;
  advanced: boolean;
  regOpensDate: string;
  regOpensTime: string;
  regClosesDate: string;
  regClosesTime: string;
  registrationCount: number;
};

export type FormState = {
  name: string;
  organizer: string;
  regionCode: RegionCode | '';
  venueName: string;
  venueAddress: string;
  venuePoint: string;
  raceDate: string;
  opensDate: string;
  opensTime: string;
  opensTimeUnknown: boolean;
  closesDate: string;
  closesTime: string;
  officialUrl: string;
  registrationUrl: string;
  courseUrl: string;
  raceType: 'road' | 'trail' | 'ultra' | 'track' | 'virtual';
  registrationMethod: 'first_come' | 'lottery' | 'unknown';
  status: 'scheduled' | 'postponed' | 'cancelled' | 'finished';
  markVerifiedNow: boolean;
  events: EventRow[];
};

let seq = 0;
export const rowKey = () => `row-${++seq}`;

export function emptyForm(
  keep: Partial<Pick<FormState, 'regionCode' | 'raceType'>> = {},
): FormState {
  return {
    name: '',
    organizer: '',
    regionCode: keep.regionCode ?? '',
    venueName: '',
    venueAddress: '',
    venuePoint: '',
    raceDate: '',
    opensDate: '',
    opensTime: '',
    opensTimeUnknown: false,
    closesDate: '',
    closesTime: '',
    officialUrl: '',
    registrationUrl: '',
    courseUrl: '',
    raceType: keep.raceType ?? 'road',
    registrationMethod: 'unknown',
    status: 'scheduled',
    markVerifiedNow: false,
    events: [],
  };
}

export function fromRace(r: AdminRace): FormState {
  const opens = splitKst(r.registrationOpensAt);
  const closes = splitKst(r.registrationClosesAt);
  return {
    name: r.name,
    organizer: r.organizer ?? '',
    regionCode: r.regionCode,
    venueName: r.venueName ?? '',
    venueAddress: r.venueAddress ?? '',
    venuePoint: r.venuePoint ? `${r.venuePoint.lat}, ${r.venuePoint.lng}` : '',
    raceDate: r.raceDate,
    opensDate: opens.date,
    opensTime: r.registrationOpensTimeKnown ? opens.time : '',
    opensTimeUnknown: r.registrationOpensAt !== null && !r.registrationOpensTimeKnown,
    closesDate: closes.date,
    closesTime: closes.time,
    officialUrl: r.officialUrl ?? '',
    registrationUrl: r.registrationUrl ?? '',
    courseUrl: r.courseUrl ?? '',
    raceType: r.raceType as FormState['raceType'],
    registrationMethod: r.registrationMethod,
    status: r.status,
    markVerifiedNow: false,
    events: r.events.map((e) => {
      const o = splitKst(e.registrationOpensAt);
      const c = splitKst(e.registrationClosesAt);
      return {
        key: rowKey(),
        id: e.id,
        name: e.name,
        category: e.category,
        categoryTouched: true,
        distanceM: String(e.distanceM),
        startTime: e.startTime ?? '',
        timeLimitMin: e.timeLimitMin?.toString() ?? '',
        feeKrw: e.feeKrw?.toString() ?? '',
        capacity: e.capacity?.toString() ?? '',
        advanced: Boolean(e.registrationOpensAt || e.registrationClosesAt),
        regOpensDate: o.date,
        regOpensTime: o.time,
        regClosesDate: c.date,
        regClosesTime: c.time,
        registrationCount: e.registrationCount,
      };
    }),
  };
}

/** 종목 프리셋 (PRD 8.4.3) */
export const PRESETS: Record<
  string,
  { name: string; category: DistanceCategory; distanceM: number }
> = {
  '5K': { name: '5K', category: '5k', distanceM: 5000 },
  '10K': { name: '10K', category: '10k', distanceM: 10000 },
  하프: { name: '하프코스', category: 'half', distanceM: 21097 },
  풀: { name: '풀코스', category: 'full', distanceM: 42195 },
  기타: { name: '', category: 'other', distanceM: 0 },
};
export const PRESET_COMBOS: Record<string, string[]> = {
  '하프+풀': ['하프', '풀'],
  '5K+10K+하프+풀': ['5K', '10K', '하프', '풀'],
};

export function presetRow(preset: string): EventRow {
  const p = PRESETS[preset]!;
  return {
    key: rowKey(),
    name: p.name,
    category: p.category,
    categoryTouched: preset !== '기타',
    distanceM: p.distanceM ? String(p.distanceM) : '',
    startTime: '',
    timeLimitMin: '',
    feeKrw: '',
    capacity: '',
    advanced: false,
    regOpensDate: '',
    regOpensTime: '',
    regClosesDate: '',
    regClosesTime: '',
    registrationCount: 0,
  };
}

const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim());

export type BuildResult =
  { ok: true; input: AdminRaceInput } | { ok: false; fieldErrors: FieldError[] };

/**
 * 폼 → API 입력 (AdminRaceInput). 빠른 입력을 해석하고, 공유 Zod 스키마로 서버와 같은 검증을 먼저 한다.
 */
export function buildInput(f: FormState, opts: { notifyChange?: boolean } = {}): BuildResult {
  const errors: FieldError[] = [];
  const raceDate = parseQuickDate(f.raceDate);
  if (!raceDate)
    errors.push({ path: 'raceDate', code: f.raceDate ? 'invalid_format' : 'required' });

  const date = (raw: string, path: string) => {
    if (!raw.trim()) return null;
    const d = parseQuickDate(raw);
    if (!d) errors.push({ path, code: 'invalid_format' });
    return d;
  };
  const time = (raw: string, fallback: string, path: string) => {
    if (!raw.trim()) return fallback;
    const t = parseQuickTime(raw);
    if (!t) errors.push({ path, code: 'invalid_format' });
    return t ?? fallback;
  };

  const od = date(f.opensDate, 'registrationOpensAt');
  const cd = date(f.closesDate, 'registrationClosesAt');
  const venue = f.venuePoint.trim() ? parseLatLng(f.venuePoint) : null;
  if (f.venuePoint.trim() && !venue) errors.push({ path: 'venuePoint', code: 'invalid_format' });

  const events = f.events.map((e, i) => {
    const rod = date(e.regOpensDate, `events[${i}].registrationOpensAt`);
    const rcd = date(e.regClosesDate, `events[${i}].registrationClosesAt`);
    const start = e.startTime.trim() ? parseQuickTime(e.startTime) : null;
    if (e.startTime.trim() && !start)
      errors.push({ path: `events[${i}].startTime`, code: 'invalid_format' });
    return {
      ...(e.id && { id: e.id }),
      name: e.name.trim(),
      category: e.category,
      distanceM: Number(e.distanceM.replace(/,/g, '')) || 0,
      startTime: start,
      timeLimitMin: intOrNull(e.timeLimitMin),
      feeKrw: intOrNull(e.feeKrw),
      capacity: intOrNull(e.capacity),
      registrationOpensAt: rod
        ? kstIso(rod, time(e.regOpensTime, '00:00', `events[${i}].registrationOpensAt`))
        : null,
      registrationClosesAt: rcd
        ? kstIso(rcd, time(e.regClosesTime, '23:59', `events[${i}].registrationClosesAt`))
        : null,
    };
  });

  const candidate = {
    name: f.name.trim(),
    organizer: textOrNull(f.organizer),
    regionCode: f.regionCode || undefined,
    venueName: textOrNull(f.venueName),
    venueAddress: textOrNull(f.venueAddress),
    venuePoint: venue,
    raceDate: raceDate ?? '',
    registrationOpensAt: od
      ? kstIso(od, f.opensTimeUnknown ? '00:00' : time(f.opensTime, '00:00', 'registrationOpensAt'))
      : null,
    registrationOpensTimeKnown: !f.opensTimeUnknown,
    registrationClosesAt: cd
      ? kstIso(cd, time(f.closesTime, '23:59', 'registrationClosesAt'))
      : null,
    officialUrl: textOrNull(f.officialUrl),
    registrationUrl: textOrNull(f.registrationUrl),
    courseUrl: textOrNull(f.courseUrl),
    raceType: f.raceType,
    registrationMethod: f.registrationMethod,
    status: f.status,
    events,
    markVerifiedNow: f.markVerifiedNow,
    notifyChange: opts.notifyChange ?? true,
  };
  const parsed = AdminRaceInput.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.reduce<string>(
        (acc, p) =>
          typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${String(p)}` : String(p),
        '',
      );
      if (errors.some((e) => e.path === path)) continue;
      const code =
        (issue.code === 'custom' && (issue.params as { code?: string } | undefined)?.code) ||
        (issue.code === 'too_small' || issue.code === 'too_big'
          ? 'out_of_range'
          : issue.code === 'invalid_format'
            ? 'invalid_format'
            : issue.code === 'invalid_type' && !path.includes('.')
              ? 'required'
              : 'invalid_value');
      errors.push({ path, code });
    }
  }
  if (errors.length || !parsed.success) return { ok: false, fieldErrors: errors };
  return { ok: true, input: parsed.data };
}

/** 게시 대회 저장 시 영향 확인이 필요한 변경 (PRD 8.4 저장 시 동작) */
export function scheduleChanged(before: AdminRace, input: AdminRaceInput): boolean {
  const sec = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
  if (before.raceDate !== input.raceDate) return true;
  if (sec(before.registrationOpensAt) !== sec(input.registrationOpensAt)) return true;
  if (sec(before.registrationClosesAt) !== sec(input.registrationClosesAt)) return true;
  return input.events.some((e) => {
    const old = before.events.find((o) => o.id === e.id);
    return (
      old &&
      (old.startTime !== e.startTime ||
        sec(old.registrationOpensAt) !== sec(e.registrationOpensAt) ||
        sec(old.registrationClosesAt) !== sec(e.registrationClosesAt))
    );
  });
}
