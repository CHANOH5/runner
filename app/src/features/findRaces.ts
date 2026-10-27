import { STANDARD_DISTANCE_M, type DistanceCategory } from '@berun/shared';
import { router } from 'expo-router';
import { EMPTY_FILTERS, useRaceFilters } from './raceFilters';

/** 거리 → 분류 (표준 거리만, 그 외 기타) */
export function categoryOfDistance(m: number): DistanceCategory {
  const hit = (Object.entries(STANDARD_DISTANCE_M) as [DistanceCategory, number][]).find(
    ([, v]) => v === m,
  );
  return hit ? hit[0] : 'other';
}

/** [이 거리 대회 찾기] → S-020 (거리 필터 적용, PRD 6.17) */
export function findRacesForDistance(distanceM: number) {
  useRaceFilters
    .getState()
    .setFilters({ ...EMPTY_FILTERS, category: [categoryOfDistance(distanceM)] });
  router.navigate('/races');
}
