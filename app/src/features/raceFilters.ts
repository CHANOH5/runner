import type { DistanceCategory, FeeBucket, RegionCode } from '@berun/shared';
import { create } from 'zustand';
import type { RaceFilters } from '../api/endpoints';
import { addDaysKst, CATEGORY_LABELS, REGION_LABELS } from '../lib/format';
import { kv } from '../lib/kv';

/** S-021 필터 (PRD 4.6). 기기에 저장해 앱을 다시 열어도 유지한다 */
export type PeriodFilter =
  | { preset: 'this_month' }
  | { preset: 'next_month' }
  | { preset: 'three_months' }
  | { preset: 'custom'; from: string; to: string };

export type RegistrationStateFilter = 'upcoming' | 'open' | 'closed' | 'unscheduled';

export type RaceFilterState = {
  region: RegionCode[];
  period: PeriodFilter | null;
  category: DistanceCategory[];
  registrationState: RegistrationStateFilter[];
  fee: FeeBucket[];
  includeEnded: boolean;
  hideCancelled: boolean;
};

export const EMPTY_FILTERS: RaceFilterState = {
  region: [],
  period: null,
  category: [],
  registrationState: [],
  fee: [],
  includeEnded: false,
  hideCancelled: false,
};

export const PERIOD_LABEL = {
  this_month: '이번 달',
  next_month: '다음 달',
  three_months: '3개월 이내',
  custom: '직접 선택',
} as const;

export const REG_STATE_LABEL: Record<RegistrationStateFilter, string> = {
  upcoming: '접수 예정',
  open: '접수 중',
  closed: '접수 마감',
  unscheduled: '접수 일정 미정',
};

export const FEE_LABEL: Record<FeeBucket, string> = {
  le30k: '3만 원 이하',
  '30k_50k': '3~5만 원',
  '50k_100k': '5~10만 원',
  gt100k: '10만 원 초과',
};

const monthEnd = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** 기간 프리셋 → from/to (KST 날짜) */
export function periodRange(p: PeriodFilter, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (p.preset) {
    case 'this_month':
      return { from: today, to: monthEnd(y, m) };
    case 'next_month': {
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      return { from: `${ny}-${String(nm).padStart(2, '0')}-01`, to: monthEnd(ny, nm) };
    }
    case 'three_months': {
      const [, , d] = today.split('-').map(Number) as [number, number, number];
      const t = new Date(Date.UTC(y, m - 1 + 3, d));
      const to = addDaysKst(t.toISOString().slice(0, 10), 0);
      return { from: today, to };
    }
    case 'custom':
      return { from: p.from, to: p.to };
  }
}

/** 필터 상태 → GET /races 쿼리 */
export function filtersToQuery(f: RaceFilterState, today: string): RaceFilters {
  return {
    ...(f.region.length && { region: f.region }),
    ...(f.period && periodRange(f.period, today)),
    ...(f.category.length && { category: f.category }),
    ...(f.registrationState.length && { registrationState: f.registrationState }),
    ...(f.fee.length && { fee: f.fee }),
    ...(f.includeEnded && { includeEnded: true }),
    ...(f.hideCancelled && { hideCancelled: true }),
  };
}

export type FilterChip = {
  key: string;
  label: string;
  remove: (f: RaceFilterState) => RaceFilterState;
};

/** S-020 상단 적용 필터 칩 (× 로 하나씩 해제) */
export function filterChips(f: RaceFilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const r of f.region) {
    chips.push({
      key: `region-${r}`,
      label: REGION_LABELS[r],
      remove: (s) => ({ ...s, region: s.region.filter((x) => x !== r) }),
    });
  }
  if (f.period) {
    const label =
      f.period.preset === 'custom'
        ? `${f.period.from}~${f.period.to}`
        : PERIOD_LABEL[f.period.preset];
    chips.push({ key: 'period', label, remove: (s) => ({ ...s, period: null }) });
  }
  for (const c of f.category) {
    chips.push({
      key: `cat-${c}`,
      label: CATEGORY_LABELS[c],
      remove: (s) => ({ ...s, category: s.category.filter((x) => x !== c) }),
    });
  }
  for (const st of f.registrationState) {
    chips.push({
      key: `state-${st}`,
      label: REG_STATE_LABEL[st],
      remove: (s) => ({ ...s, registrationState: s.registrationState.filter((x) => x !== st) }),
    });
  }
  for (const fee of f.fee) {
    chips.push({
      key: `fee-${fee}`,
      label: FEE_LABEL[fee],
      remove: (s) => ({ ...s, fee: s.fee.filter((x) => x !== fee) }),
    });
  }
  if (f.includeEnded)
    chips.push({
      key: 'ended',
      label: '종료 포함',
      remove: (s) => ({ ...s, includeEnded: false }),
    });
  if (f.hideCancelled)
    chips.push({
      key: 'cancelled',
      label: '취소 대회 숨김',
      remove: (s) => ({ ...s, hideCancelled: false }),
    });
  return chips;
}

/** 직접 선택 기간 검증: 시작 ≤ 종료, 최대 12개월 (PRD 4.6) */
export function customPeriodError(from: string, to: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return '날짜를 YYYY-MM-DD 형식으로 입력해주세요';
  if (from > to) return '시작일이 종료일보다 늦어요';
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(y, m - 1 + 12, d)).toISOString().slice(0, 10);
  return to > limit ? '기간은 최대 12개월까지 고를 수 있어요' : null;
}

const STORAGE_KEY = 'device.raceFilters';

type FilterStore = {
  filters: RaceFilterState;
  view: 'list' | 'calendar';
  loaded: boolean;
  setFilters: (f: RaceFilterState) => void;
  setView: (v: 'list' | 'calendar') => void;
  load: () => Promise<void>;
};

export const useRaceFilters = create<FilterStore>((set, get) => ({
  filters: EMPTY_FILTERS,
  view: 'list',
  loaded: false,
  setFilters: (filters) => {
    set({ filters });
    void kv.set(STORAGE_KEY, { filters, view: get().view });
  },
  setView: (view) => {
    set({ view });
    void kv.set(STORAGE_KEY, { filters: get().filters, view });
  },
  load: async () => {
    if (get().loaded) return;
    const saved = await kv.get<{ filters?: RaceFilterState; view?: 'list' | 'calendar' } | null>(
      STORAGE_KEY,
      null,
    );
    set({
      filters: { ...EMPTY_FILTERS, ...saved?.filters },
      view: saved?.view ?? 'list',
      loaded: true,
    });
  },
}));
