import type { RaceSummary } from '@berun/shared';
import { formatMonthHeader } from '../lib/format';

export type Item =
  { kind: 'header'; key: string; label: string } | { kind: 'race'; key: string; race: RaceSummary };

/** 리스트를 월별 헤더("2026년 11월")로 묶는다 (PRD 4.5) */
export function withMonthHeaders(races: RaceSummary[]): Item[] {
  const items: Item[] = [];
  let month = '';
  for (const race of races) {
    const m = race.raceDate.slice(0, 7);
    if (m !== month) {
      month = m;
      items.push({ kind: 'header', key: `h-${m}`, label: formatMonthHeader(race.raceDate) });
    }
    items.push({ kind: 'race', key: race.id, race });
  }
  return items;
}
