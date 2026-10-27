import type { HomeRecommended, RaceSummary } from '@berun/shared';
import { recommendedView } from './home';

const race = (id: string, regionCode: RaceSummary['regionCode']) =>
  ({ id, regionCode }) as RaceSummary;

describe('S-010 추천 대회 (PRD v1.11 6.7)', () => {
  it('내 지역 대회만이면 "{지역} 근처 대회", 안내 없음', () => {
    const v = recommendedView({
      regionCode: 'seoul',
      items: [race('a', 'seoul')],
      filledNationwide: false,
    });
    expect(v).toEqual({ title: '서울 근처 대회', note: null, items: [race('a', 'seoul')] });
  });

  it('전국으로 보충하면 "추천 대회" + 안내 한 줄, 내 지역 대회가 먼저', () => {
    const data: HomeRecommended = {
      regionCode: 'seoul',
      items: [race('b', 'busan'), race('a', 'seoul'), race('c', 'jeju')],
      filledNationwide: true,
    };
    const v = recommendedView(data);
    expect(v.title).toBe('추천 대회');
    expect(v.note).toBe('서울 대회가 적어 전국 대회도 함께 보여드려요');
    expect(v.items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('프로필 지역이 없으면 제목만 "추천 대회"', () => {
    const v = recommendedView({
      regionCode: null,
      items: [race('b', 'busan')],
      filledNationwide: true,
    });
    expect(v).toMatchObject({ title: '추천 대회', note: null });
  });
});
