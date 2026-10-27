import {
  clockAt,
  CONFIDENCE_REASON_TEXT,
  formatRange,
  predictionTitle,
  splitPointLabel,
  strategyView,
  toggleRecordSelection,
} from './prediction';

describe('S-033 화면 상태 (PRD 6.17)', () => {
  it('예측 + 목표 → 결과, 기준 토글(기본 목표 기준)', () => {
    expect(strategyView({ prediction: {}, hasGoalSplits: true, unavailableReason: null })).toEqual({
      kind: 'result',
      bases: ['goal', 'prediction'],
      defaultBasis: 'goal',
    });
  });

  it('예측만 있으면 토글 없이 예측 기준', () => {
    expect(strategyView({ prediction: {}, hasGoalSplits: false, unavailableReason: null })).toEqual(
      {
        kind: 'result',
        bases: ['prediction'],
        defaultBasis: 'prediction',
      },
    );
  });

  it('예측 없음 + 목표 있음 → 목표 기준 스플릿만 (사유 유지)', () => {
    expect(
      strategyView({
        prediction: null,
        hasGoalSplits: true,
        unavailableReason: 'unsupported_distance',
      }),
    ).toEqual({ kind: 'goal_only', reason: 'unsupported_distance' });
    expect(
      strategyView({ prediction: null, hasGoalSplits: true, unavailableReason: 'no_records' }),
    ).toEqual({
      kind: 'goal_only',
      reason: 'no_records',
    });
  });

  it('예측·목표 모두 없음 → 빈 상태', () => {
    expect(
      strategyView({ prediction: null, hasGoalSplits: false, unavailableReason: 'no_records' }),
    ).toEqual({
      kind: 'empty',
    });
  });
});

describe('표시 규칙', () => {
  it('범위: ≥ 21km 분 단위 h:mm, 그 외 mm:ss (PRD 5.5)', () => {
    expect(formatRange({ rangeMinSec: 7200, rangeMaxSec: 7680, rangeDisplayUnit: 'minute' })).toBe(
      '2:00 ~ 2:08',
    );
    expect(
      formatRange({ rangeMinSec: 2960, rangeMaxSec: 3130, rangeDisplayUnit: 'ten_seconds' }),
    ).toBe('49:20 ~ 52:10');
  });

  it('예상 통과 시각: 출발 + 누적, 분 단위 버림 (08:00 + 0:29:14 → 08:29)', () => {
    expect(clockAt('2026-11-08T08:00:00+09:00', 29 * 60 + 14)).toBe('08:29');
    expect(clockAt('2026-11-08T08:00:00+09:00', 7402)).toBe('10:03');
  });

  it('목표 제목: 연결된 대회가 없으면 거리만', () => {
    expect(predictionTitle({ race: null, targetDistanceM: 21097 })).toBe('하프 (21.1km)');
    expect(predictionTitle({ race: null, targetDistanceM: 15000 })).toBe('15km');
    expect(
      predictionTitle({
        race: { id: 'r', name: '2026 서울 하프', eventName: '하프코스', startAt: null },
        targetDistanceM: 21097,
      }),
    ).toBe('2026 서울 하프 하프코스');
    expect(splitPointLabel({ atM: 21097, cumulativeSec: 0, segmentPaceSecPerKm: 0 })).toBe(
      '21.1km',
    );
  });

  it('신뢰도 사유 문구는 7개 사유를 모두 덮는다 (PRD 5.4)', () => {
    expect(Object.keys(CONFIDENCE_REASON_TEXT)).toHaveLength(7);
  });
});

describe('S-032 기록 선택', () => {
  it('최대 5개, 6번째는 안내', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(toggleRecordSelection(five, 'f')).toEqual({
      selected: five,
      error: '기록은 5개까지 고를 수 있어요',
    });
    expect(toggleRecordSelection(five, 'a').selected).toEqual(['b', 'c', 'd', 'e']);
    expect(toggleRecordSelection([], 'a')).toEqual({ selected: ['a'], error: null });
  });
});
