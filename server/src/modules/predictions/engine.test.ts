import { describe, expect, it } from 'vitest';
import { addDays } from '../../lib/time.js';
import { buildSplits, predict, rankCandidates, splitPoints, type EngineRecord } from './engine.js';

/** PRD 5.7 예시의 예측일 */
const DATE = '2026-10-21';
const HALF = 21097;
const FULL = 42195;

const rec = (
  id: string,
  distanceM: number,
  durationSec: number,
  daysAgo: number,
  kind: EngineRecord['kind'] = 'race',
): EngineRecord => ({ id, distanceM, durationSec, runDate: addDays(DATE, -daysAgo), kind });

/** h:mm:ss → 초 */
const hms = (s: string) => s.split(':').reduce((acc, v) => acc * 60 + Number(v), 0);

function ok(input: Parameters<typeof predict>[0]) {
  const outcome = predict(input);
  if (!outcome.ok) throw new Error(`expected prediction, got ${outcome.reason}`);
  return outcome.result;
}

describe('riegel-1.06-v1 — PRD 5.7 예시', () => {
  it('예시 1: 10K 기록 3개 → 하프, 신뢰도 높음', () => {
    const r = ok({
      predictionDate: DATE,
      targetDistanceM: HALF,
      records: [rec('A', 10000, 3300, 60), rec('B', 10000, 3390, 150), rec('C', 10000, 3430, 300)],
      selectedRecordIds: null,
      timeLimitSec: null,
    });

    expect(r.modelVersion).toBe('riegel-1.06-v1');
    expect(r.used.map((u) => u.id)).toEqual(['A', 'B', 'C']);
    expect(r.used.map((u) => u.weight)).toEqual([
      expect.closeTo(0.8, 9),
      expect.closeTo(0.56, 9),
      expect.closeTo(0.32, 9),
    ]);
    expect(r.used.map((u) => u.convertedSec)).toEqual([
      expect.closeTo(7280.9, 0),
      expect.closeTo(7479.5, 0),
      expect.closeTo(7567.8, 0),
    ]);
    expect(r.predictedSec).toBe(hms('2:03:22'));
    expect(r.cv).toBeCloseTo(0.0161, 3);
    expect(r.confidence).toBe('high');
    expect(r.confidenceReason).toBe('high');
    expect([r.rangeMinSec, r.rangeMaxSec]).toEqual([hms('2:00:00'), hms('2:08:00')]);
    expect(r.rangeDisplayUnit).toBe('minute');
    expect(r.avgPaceSecPerKm).toBe(5 * 60 + 51);
    expect(r.firstFullSuggestionSec).toBeNull();
    expect(r.timeLimitWarning).toBe(false);

    expect(r.splits.even.map((s) => [s.atM, s.cumulativeSec])).toEqual([
      [5000, hms('0:29:14')],
      [10000, hms('0:58:29')],
      [15000, hms('1:27:43')],
      [20000, hms('1:56:57')],
      [HALF, hms('2:03:22')],
    ]);
    expect(r.splits.negative.map((s) => [s.atM, s.cumulativeSec])).toEqual([
      [5000, hms('0:29:41')],
      [10000, hms('0:59:21')],
      [15000, hms('1:28:15')],
      [20000, hms('1:57:03')],
      [HALF, hms('2:03:22')],
    ]);
    // 네거티브: 전반 5'56"/km, 후반 5'46"/km (PRD 4.13 수용 기준)
    expect(r.splits.negative[0]?.segmentPaceSecPerKm).toBe(5 * 60 + 56);
    expect(r.splits.negative.at(-1)?.segmentPaceSecPerKm).toBe(5 * 60 + 46);
  });

  it('예시 2: 하프·풀·10K 훈련 → 풀, 신뢰도 높음, 첫 풀 아님', () => {
    const r = ok({
      predictionDate: DATE,
      targetDistanceM: FULL,
      records: [
        rec('A', HALF, 5250, 45),
        rec('B', FULL, 11300, 120),
        rec('C', 10000, 2410, 30, 'training'),
      ],
      selectedRecordIds: null,
      timeLimitSec: null,
    });

    expect(r.used.map((u) => u.id)).toEqual(['A', 'B', 'C']);
    expect(r.used.map((u) => u.weight)).toEqual([
      expect.closeTo(0.8, 9),
      expect.closeTo(0.7, 9),
      expect.closeTo(0.4, 9),
    ]);
    expect(r.predictedSec).toBe(hms('3:05:06'));
    expect(r.cv).toBeCloseTo(0.0142, 3);
    expect(r.confidence).toBe('high');
    expect([r.rangeMinSec, r.rangeMaxSec]).toEqual([hms('3:01:00'), hms('3:11:00')]);
    expect(r.avgPaceSecPerKm).toBe(4 * 60 + 23);
    expect(r.firstFullSuggestionSec).toBeNull();

    const at = (rows: typeof r.splits.even, m: number) =>
      rows.find((s) => s.atM === m)?.cumulativeSec;
    expect(at(r.splits.even, 5000)).toBe(hms('0:21:56'));
    expect(at(r.splits.even, 20000)).toBe(hms('1:27:44'));
    expect(at(r.splits.even, 40000)).toBe(hms('2:55:28'));
    expect(at(r.splits.even, FULL)).toBe(hms('3:05:06'));
    expect(at(r.splits.negative, 5000)).toBe(hms('0:22:16'));
    expect(at(r.splits.negative, 20000)).toBe(hms('1:29:03'));
    expect(at(r.splits.negative, 40000)).toBe(hms('2:55:37'));
    expect(at(r.splits.negative, FULL)).toBe(hms('3:05:06'));
    expect(r.splits.negative[0]?.segmentPaceSecPerKm).toBe(4 * 60 + 27);
    expect(r.splits.negative.at(-1)?.segmentPaceSecPerKm).toBe(4 * 60 + 19);
  });

  it('예시 3: 5K 훈련 1개 → 풀, 신뢰도 낮음, 첫 풀 보수 목표 4:12:00', () => {
    const r = ok({
      predictionDate: DATE,
      targetDistanceM: FULL,
      records: [rec('A', 5000, 1500, 20, 'training')],
      selectedRecordIds: null,
      timeLimitSec: null,
    });

    expect(r.used[0]?.ratio).toBeCloseTo(8.439, 3);
    expect(r.used[0]?.weight).toBeCloseTo(0.2, 9);
    expect(r.predictedSec).toBe(hms('3:59:47'));
    expect(r.confidence).toBe('low');
    expect(r.confidenceReason).toBe('short_records');
    expect([r.rangeMinSec, r.rangeMaxSec]).toEqual([hms('3:47:00'), hms('4:24:00')]);
    expect(r.avgPaceSecPerKm).toBe(5 * 60 + 41);
    expect(r.firstFullSuggestionSec).toBe(hms('4:12:00'));
  });
});

describe('riegel-1.06-v1 — 규칙', () => {
  const base = { predictionDate: DATE, selectedRecordIds: null, timeLimitSec: null };

  it('같은 입력이면 같은 결과 (결정적)', () => {
    const input = {
      ...base,
      targetDistanceM: HALF,
      records: [rec('A', 10000, 3300, 60), rec('B', 5000, 1500, 10)],
    };
    expect(predict(input)).toEqual(predict(input));
  });

  it('eligible: 3km 미만·42.195km 초과·365일 초과·미래 기록은 제외', () => {
    const ranked = rankCandidates(
      [
        rec('short', 2999, 900, 10),
        rec('ultra', 50000, 18000, 10),
        rec('old', 10000, 3000, 366),
        rec('future', 10000, 3000, -1),
        rec('edge', 3000, 900, 365),
      ],
      HALF,
      DATE,
    );
    expect(ranked.map((r) => r.id)).toEqual(['edge']);
  });

  it('기록 0개면 none, 거리는 맞지만 전부 365일 초과면 all_older_than_365d', () => {
    expect(predict({ ...base, targetDistanceM: HALF, records: [] })).toEqual({
      ok: false,
      reason: 'none',
    });
    expect(
      predict({ ...base, targetDistanceM: HALF, records: [rec('short', 1000, 300, 1)] }),
    ).toEqual({ ok: false, reason: 'none' });
    expect(
      predict({ ...base, targetDistanceM: HALF, records: [rec('old', 10000, 3000, 400)] }),
    ).toEqual({ ok: false, reason: 'all_older_than_365d' });
  });

  it('자동 선택은 상위 5개, 동점이면 최근 → 긴 거리 순', () => {
    const records = [
      rec('r1', 10000, 3000, 10),
      rec('r2', 10000, 3010, 20),
      rec('r3', 10000, 3020, 30),
      rec('r4', 10000, 3030, 40),
      rec('r5', 10000, 3040, 50),
      rec('r6', 10000, 3050, 60),
      rec('long', 12000, 3700, 10),
    ];
    const r = ok({ ...base, targetDistanceM: HALF, records });
    // 12km(r 1.76)와 10km(r 2.11)는 같은 w_거리 0.8 → 같은 날짜면 긴 거리 먼저
    expect(r.used.map((u) => u.id)).toEqual(['long', 'r1', 'r2', 'r3', 'r4']);
  });

  it('직접 고른 기록은 같은 가중치로 계산', () => {
    const records = [rec('A', 10000, 3300, 60), rec('C', 10000, 3430, 300)];
    const r = ok({ ...base, targetDistanceM: HALF, records, selectedRecordIds: ['A', 'C'] });
    const mean = (r.used[0]!.convertedSec + r.used[1]!.convertedSec) / 2;
    expect(r.predictedSec).toBe(Math.round(mean));
    expect(r.used.every((u) => u.appliedWeight === 1)).toBe(true);
  });

  it('신뢰도 보통 사유: 기록 1개 → single_record', () => {
    const r = ok({ ...base, targetDistanceM: HALF, records: [rec('A', HALF, 7000, 10)] });
    expect([r.confidence, r.confidenceReason]).toEqual(['medium', 'single_record']);
  });

  it('신뢰도 보통 사유: r ≤ 2.2인 최근 기록 없음 → distance_gap', () => {
    // 5K → 하프 (r 4.22) 기록 2개, 서로 비슷
    const r = ok({
      ...base,
      targetDistanceM: HALF,
      records: [rec('A', 5000, 1500, 10), rec('B', 5000, 1510, 20)],
    });
    expect([r.confidence, r.confidenceReason]).toEqual(['medium', 'distance_gap']);
  });

  it('신뢰도 낮음: 모두 180일 초과 → stale_records, CV > 6% → cv_high', () => {
    const stale = ok({
      ...base,
      targetDistanceM: HALF,
      records: [rec('A', 10000, 3300, 200), rec('B', 10000, 3310, 250)],
    });
    expect([stale.confidence, stale.confidenceReason]).toEqual(['low', 'stale_records']);

    const spread = ok({
      ...base,
      targetDistanceM: HALF,
      records: [rec('A', 10000, 3000, 10), rec('B', 10000, 3600, 20)],
    });
    expect(spread.cv).toBeGreaterThan(0.06);
    expect([spread.confidence, spread.confidenceReason]).toEqual(['low', 'cv_high']);
  });

  it('10K 미만 목표는 범위를 10초 단위로 내림·올림', () => {
    const r = ok({ ...base, targetDistanceM: 10000, records: [rec('A', 10000, 3001, 10)] });
    expect(r.predictedSec).toBe(3001);
    // 보통: 3001 × 0.97 = 2910.97 → 2910, 3001 × 1.06 = 3181.06 → 3190
    expect([r.rangeMinSec, r.rangeMaxSec, r.rangeDisplayUnit]).toEqual([2910, 3190, 'ten_seconds']);
  });

  it('제한 시간 경고: 상한 > 제한 시간', () => {
    const records = [rec('A', HALF, 9000, 10)];
    expect(
      ok({ ...base, targetDistanceM: HALF, records, timeLimitSec: 150 * 60 }).timeLimitWarning,
    ).toBe(true);
    expect(
      ok({ ...base, targetDistanceM: HALF, records, timeLimitSec: 180 * 60 }).timeLimitWarning,
    ).toBe(false);
  });

  it('첫 풀 판정은 기간 무관 전체 기록 기준', () => {
    const r = ok({
      ...base,
      targetDistanceM: FULL,
      records: [rec('half', HALF, 6000, 10), rec('oldFull', FULL, 14000, 800)],
    });
    expect(r.firstFullSuggestionSec).toBeNull();
  });
});

describe('스플릿', () => {
  it('15km 미만은 1km 단위, 이상은 5km 단위, 마지막은 결승', () => {
    expect(splitPoints(10000)).toEqual([
      1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
    ]);
    expect(splitPoints(12500).at(-2)).toBe(12000);
    expect(splitPoints(12500).at(-1)).toBe(12500);
    expect(splitPoints(HALF)).toEqual([5000, 10000, 15000, 20000, HALF]);
  });

  it('네거티브 스플릿 총 기록은 이븐과 같다', () => {
    const s = buildSplits(3001, 10000);
    expect(s.negative.at(-1)?.cumulativeSec).toBe(3001);
    expect(s.even.at(-1)?.cumulativeSec).toBe(3001);
  });
});
