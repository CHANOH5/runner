import type { Confidence, ConfidenceReason, RunKind, SplitRow, Splits } from '@berun/shared';
import { daysBetween } from '../../lib/time.js';
import { RIEGEL_1_06_V1, type PredictionModel } from './model.js';

/**
 * 기록 예측 계산 (PRD 5장, riegel-1.06-v1). DB·시계와 무관한 순수 함수.
 * 같은 입력·같은 예측일 → 같은 결과 (결정적). 부동소수점으로 계산하고 마지막에만 반올림한다.
 */

export type EngineRecord = {
  id: string;
  distanceM: number;
  durationSec: number;
  /** YYYY-MM-DD (KST) */
  runDate: string;
  kind: RunKind;
};

export type WeightedRecord = EngineRecord & {
  daysAgo: number;
  /** 거리 비율 r = max(D1, D2) / min(D1, D2) */
  ratio: number;
  /** 자동 선택 가중치 (PRD 5.2) */
  weight: number;
  /** 목표 거리 환산 기록 (반올림 전) */
  convertedSec: number;
};

export type PredictInput = {
  /** 예측일 (KST 날짜) */
  predictionDate: string;
  targetDistanceM: number;
  /** 사용자의 전체 기록 (eligible 판정과 첫 풀 판정에 모두 쓴다) */
  records: EngineRecord[];
  /** null = 자동 선택. 값이 있으면 이 기록만 같은 가중치로 쓴다 (호출 측에서 eligible 검사) */
  selectedRecordIds: string[] | null;
  /** 참가 대회 종목 제한 시간 (초). 없으면 null */
  timeLimitSec: number | null;
};

export type PredictResult = {
  modelVersion: PredictionModel['version'];
  targetDistanceM: number;
  predictedSec: number;
  rangeMinSec: number;
  rangeMaxSec: number;
  rangeDisplayUnit: 'minute' | 'ten_seconds';
  avgPaceSecPerKm: number;
  confidence: Confidence;
  confidenceReason: ConfidenceReason;
  /** 변동계수 (0~1) */
  cv: number;
  firstFullSuggestionSec: number | null;
  timeLimitWarning: boolean;
  /** 계산에 쓴 기록과 실제로 적용한 가중치 (직접 선택이면 1) */
  used: (WeightedRecord & { appliedWeight: number })[];
  splits: Splits;
};

export type PredictOutcome =
  { ok: true; result: PredictResult } | { ok: false; reason: 'none' | 'all_older_than_365d' };

const m = RIEGEL_1_06_V1;

export function isEligible(record: EngineRecord, predictionDate: string): boolean {
  const daysAgo = daysBetween(record.runDate, predictionDate);
  return (
    record.distanceM >= m.eligible.minDistanceM &&
    record.distanceM <= m.eligible.maxDistanceM &&
    daysAgo >= 0 &&
    daysAgo <= m.eligible.maxDaysAgo
  );
}

function pick<T extends { weight: number }>(
  table: readonly T[],
  test: (row: T) => boolean,
): number {
  const row = table.find(test);
  if (!row) throw new Error('weight table does not cover value');
  return row.weight;
}

export function weigh(
  record: EngineRecord,
  targetDistanceM: number,
  predictionDate: string,
): WeightedRecord {
  const daysAgo = daysBetween(record.runDate, predictionDate);
  const ratio =
    Math.max(record.distanceM, targetDistanceM) / Math.min(record.distanceM, targetDistanceM);
  const weight =
    pick(m.recencyWeights, (r) => daysAgo <= r.maxDaysAgo) *
    pick(m.distanceWeights, (r) => ratio <= r.maxRatio) *
    m.kindWeights[record.kind];
  const convertedSec = record.durationSec * (targetDistanceM / record.distanceM) ** m.exponent;
  return { ...record, daysAgo, ratio, weight, convertedSec };
}

/** 가중치가 부동소수점 오차로만 다를 때 동점으로 본다 */
const sameWeight = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * eligible 기록을 자동 선택 순서로 정렬한다 (PRD 5.2):
 * 가중치 내림차순 → 최근 기록 → 긴 거리 → id (결정성 보장용)
 */
export function rankCandidates(
  records: EngineRecord[],
  targetDistanceM: number,
  predictionDate: string,
): WeightedRecord[] {
  return records
    .filter((r) => isEligible(r, predictionDate))
    .map((r) => weigh(r, targetDistanceM, predictionDate))
    .sort((a, b) => {
      if (!sameWeight(a.weight, b.weight)) return b.weight - a.weight;
      if (a.runDate !== b.runDate) return a.runDate < b.runDate ? 1 : -1;
      if (a.distanceM !== b.distanceM) return b.distanceM - a.distanceM;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function emptyReason(records: EngineRecord[]): 'none' | 'all_older_than_365d' {
  const inDistance = records.filter(
    (r) => r.distanceM >= m.eligible.minDistanceM && r.distanceM <= m.eligible.maxDistanceM,
  );
  return inDistance.length > 0 ? 'all_older_than_365d' : 'none';
}

function judgeConfidence(
  used: WeightedRecord[],
  targetDistanceM: number,
  cv: number,
): { confidence: Confidence; reason: ConfidenceReason } {
  const c = m.confidence;
  const rMin = Math.min(...used.map((r) => r.ratio));
  const l1 = rMin > c.lowMinRatio;
  const l2 =
    targetDistanceM >= c.fullTargetMinM && !used.some((r) => r.distanceM >= c.halfOrLongerMinM);
  const l3 = used.every((r) => r.daysAgo > c.staleDaysAgo);
  const l4 = cv > c.lowCv;
  if (l1 || l2) return { confidence: 'low', reason: 'short_records' };
  if (l3) return { confidence: 'low', reason: 'stale_records' };
  if (l4) return { confidence: 'low', reason: 'cv_high' };

  const h1 = used.some((r) => r.ratio <= c.highMaxRatio && r.daysAgo <= c.highMaxDaysAgo);
  const h2 = used.length >= 2;
  const h3 = cv <= c.highCv;
  if (h1 && h2 && h3) return { confidence: 'high', reason: 'high' };
  // 보통 사유는 PRD 5.4 표 순서대로 첫 번째
  if (!h2) return { confidence: 'medium', reason: 'single_record' };
  if (!h1) return { confidence: 'medium', reason: 'distance_gap' };
  return { confidence: 'medium', reason: 'cv_moderate' };
}

function roundRange(
  predictedSec: number,
  confidence: Confidence,
  targetDistanceM: number,
): Pick<PredictResult, 'rangeMinSec' | 'rangeMaxSec' | 'rangeDisplayUnit'> {
  const [fast, slow] = m.range[confidence];
  const minuteUnit = targetDistanceM >= m.rangeMinuteUnitMinM;
  const unit = minuteUnit ? 60 : 10;
  return {
    rangeMinSec: Math.floor((predictedSec * (1 - fast)) / unit) * unit,
    rangeMaxSec: Math.ceil((predictedSec * (1 + slow)) / unit) * unit,
    rangeDisplayUnit: minuteUnit ? 'minute' : 'ten_seconds',
  };
}

/** 스플릿 지점: 구간 단위의 배수 + 결승 (PRD 5.6) */
export function splitPoints(distanceM: number): number[] {
  const s = m.splits;
  const interval = distanceM < s.longFromM ? s.shortIntervalM : s.longIntervalM;
  const points: number[] = [];
  for (let x = interval; x < distanceM; x += interval) points.push(x);
  points.push(distanceM);
  return points;
}

/** 기준 기록 T로 이븐·네거티브 스플릿을 만든다 (PRD 5.6). 목표 기록 기준 전략에도 쓴다. */
export function buildSplits(totalSec: number, distanceM: number): Splits {
  const p = totalSec / distanceM;
  const half = distanceM / 2;
  const d = m.splits.negativeDelta;
  const even = (x: number) => p * x;
  const negative = (x: number) =>
    x <= half ? x * p * (1 + d) : half * p * (1 + d) + (x - half) * p * (1 - d);

  const rows = (cum: (x: number) => number): SplitRow[] => {
    let prev = 0;
    return splitPoints(distanceM).map((x) => {
      const row = {
        atM: x,
        cumulativeSec: Math.round(cum(x)),
        segmentPaceSecPerKm: Math.round((cum(x) - cum(prev)) / ((x - prev) / 1000)),
      };
      prev = x;
      return row;
    });
  };
  return { even: rows(even), negative: rows(negative) };
}

export function predict(input: PredictInput): PredictOutcome {
  const { predictionDate, targetDistanceM, records } = input;
  const ranked = rankCandidates(records, targetDistanceM, predictionDate);

  let chosen: WeightedRecord[];
  let manual = false;
  if (input.selectedRecordIds) {
    const ids = new Set(input.selectedRecordIds);
    chosen = ranked.filter((r) => ids.has(r.id));
    manual = true;
  } else {
    chosen = ranked.slice(0, m.autoSelectCount);
  }
  if (chosen.length === 0) return { ok: false, reason: emptyReason(records) };

  // 직접 고른 기록은 같은 가중치로 계산한다 (PRD 5.2)
  const used = chosen.map((r) => ({ ...r, appliedWeight: manual ? 1 : r.weight }));
  const weightSum = used.reduce((s, r) => s + r.appliedWeight, 0);
  const predictedSec = Math.round(
    used.reduce((s, r) => s + r.appliedWeight * r.convertedSec, 0) / weightSum,
  );
  const cv =
    used.length < 2
      ? 0
      : Math.sqrt(
          used.reduce((s, r) => s + r.appliedWeight * (r.convertedSec - predictedSec) ** 2, 0) /
            weightSum,
        ) / predictedSec;

  const { confidence, reason } = judgeConfidence(used, targetDistanceM, cv);
  const range = roundRange(predictedSec, confidence, targetDistanceM);

  const firstFull =
    targetDistanceM >= m.firstFull.minM && !records.some((r) => r.distanceM >= m.firstFull.minM);

  return {
    ok: true,
    result: {
      modelVersion: m.version,
      targetDistanceM,
      predictedSec,
      ...range,
      avgPaceSecPerKm: Math.round(predictedSec / (targetDistanceM / 1000)),
      confidence,
      confidenceReason: reason,
      cv,
      firstFullSuggestionSec: firstFull
        ? Math.ceil((predictedSec * m.firstFull.factor) / 60) * 60
        : null,
      timeLimitWarning: input.timeLimitSec !== null && range.rangeMaxSec > input.timeLimitSec,
      used,
      splits: buildSplits(predictedSec, targetDistanceM),
    },
  };
}
