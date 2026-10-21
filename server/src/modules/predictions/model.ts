import { PREDICTION_MODEL_VERSION } from '@berun/shared';

/**
 * 모델 상수 묶음 (PRD 5장, D-010). 값을 바꾸면 모델 버전을 올리고 새 묶음을 추가한다.
 * 저장된 예측은 다시 계산하지 않으므로 이전 버전 묶음도 지우지 않는다.
 */
export const RIEGEL_1_06_V1 = {
  version: PREDICTION_MODEL_VERSION,
  exponent: 1.06,
  eligible: { minDistanceM: 3000, maxDistanceM: 42195, maxDaysAgo: 365 },
  /** w_최신성: days_ago 상한 오름차순 */
  recencyWeights: [
    { maxDaysAgo: 90, weight: 1.0 },
    { maxDaysAgo: 180, weight: 0.7 },
    { maxDaysAgo: 365, weight: 0.4 },
  ],
  /** w_거리: 거리 비율 r 상한 오름차순 */
  distanceWeights: [
    { maxRatio: 1.2, weight: 1.0 },
    { maxRatio: 2.2, weight: 0.8 },
    { maxRatio: 4.3, weight: 0.5 },
    { maxRatio: Infinity, weight: 0.25 },
  ],
  kindWeights: { race: 1.0, training: 0.8 },
  autoSelectCount: 5,
  confidence: {
    /** L1: r_min 초과 */
    lowMinRatio: 4.3,
    /** L2: 풀 목표인데 하프 이상 기록 없음 */
    fullTargetMinM: 42000,
    halfOrLongerMinM: 21000,
    /** L3: 모든 기록이 이 일수보다 오래됨 */
    staleDaysAgo: 180,
    /** L4 */
    lowCv: 0.06,
    /** H1: r ≤ 2.2 이면서 180일 이내 기록 */
    highMaxRatio: 2.2,
    highMaxDaysAgo: 180,
    /** H3 */
    highCv: 0.03,
  },
  /** [빠른 쪽, 느린 쪽] 비율 */
  range: {
    high: [0.02, 0.03],
    medium: [0.03, 0.06],
    low: [0.05, 0.1],
  },
  /** 목표 ≥ 이 거리면 범위를 분 단위, 아니면 10초 단위로 반올림 */
  rangeMinuteUnitMinM: 21000,
  /** 첫 풀코스 보수 목표 (P-PRED-04): 풀 목표 + 전체 기록에 이 거리 이상 없음 */
  firstFull: { minM: 42000, factor: 1.05 },
  splits: { shortIntervalM: 1000, longIntervalM: 5000, longFromM: 15000, negativeDelta: 0.015 },
} as const;

export type PredictionModel = typeof RIEGEL_1_06_V1;
