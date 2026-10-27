import type { HomeRecommended } from '@berun/shared';
import { REGION_LABELS } from '../lib/format';

/**
 * S-010 추천 대회 섹션 (PRD v1.11 6.7)
 * - 내 지역 대회만: "{지역} 근처 대회"
 * - 전국으로 보충(filledNationwide): "추천 대회" + 회색 안내 한 줄
 * - 내 지역 대회를 먼저 보여준다. 서버도 이 순서로 주지만(home/service.ts) 앱에서 한 번 더 맞춘다 (안정 정렬)
 */
export function recommendedView(data: HomeRecommended) {
  const region = data.regionCode ? REGION_LABELS[data.regionCode] : null;
  const local = data.items.filter((r) => r.regionCode === data.regionCode);
  const rest = data.items.filter((r) => r.regionCode !== data.regionCode);
  if (!data.filledNationwide && region) {
    return { title: `${region} 근처 대회`, note: null, items: [...local, ...rest] };
  }
  return {
    title: '추천 대회',
    note:
      data.filledNationwide && region ? `${region} 대회가 적어 전국 대회도 함께 보여드려요` : null,
    items: [...local, ...rest],
  };
}
