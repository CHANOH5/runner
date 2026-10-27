import type {
  Confidence,
  ConfidenceReason,
  Prediction,
  PredictionSummary,
  SplitRow,
} from '@berun/shared';
import type { Tone } from '../components/ui';
import { formatDuration, formatHoursMinutes, kstParts } from '../lib/format';

/** 면책 문구 (P-PRED-01) — 예측 결과가 있으면 항상 표시 */
export const PREDICTION_DISCLAIMER =
  '예상 기록은 통계적 추정이며 훈련 상태, 코스, 날씨, 컨디션에 따라 달라질 수 있습니다. 무리한 목표 설정은 부상의 원인이 될 수 있습니다.';

export const CONFIDENCE_BADGE: Record<Confidence, { label: string; tone: Tone }> = {
  high: { label: '신뢰도 높음', tone: 'green' },
  medium: { label: '신뢰도 보통', tone: 'yellow' },
  low: { label: '신뢰도 낮음', tone: 'gray' },
};

/** 신뢰도 사유 문구 (PRD 5.4) */
export const CONFIDENCE_REASON_TEXT: Record<ConfidenceReason, string> = {
  high: '목표 거리와 비슷한 최근 기록이 여러 개 있어 비교적 믿을 만해요.',
  single_record: '기록이 1개뿐이에요. 기록을 더 넣으면 정확해져요.',
  distance_gap: '목표 거리와 차이가 있는 기록으로 계산했어요.',
  cv_moderate: '기록 간 차이가 조금 있어요.',
  short_records:
    '목표 거리보다 훨씬 짧은 기록으로 계산했어요. 장거리 훈련으로 실제 기록을 확인해보세요.',
  stale_records: '최근 6개월 안의 기록이 없어요. 현재 실력과 차이가 클 수 있어요.',
  cv_high: '기록 간 차이가 커서 범위를 넓게 잡았어요.',
};

export const WEIGHT_LABEL = { high: '많이 반영', medium: '보통', low: '조금 반영' } as const;

/** 범위 "2:00 ~ 2:08" (≥ 21km 분 단위 h:mm) / "49:20 ~ 52:10" (10초 단위 mm:ss) — PRD 5.5 */
export function formatRange(
  p: Pick<Prediction, 'rangeMinSec' | 'rangeMaxSec' | 'rangeDisplayUnit'>,
) {
  const f = p.rangeDisplayUnit === 'minute' ? formatHoursMinutes : formatDuration;
  return `${f(p.rangeMinSec)} ~ ${f(p.rangeMaxSec)}`;
}

/** 목표 거리 이름: 하프 (21.1km) 등 */
export function targetLabel(distanceM: number): string {
  const named: Record<number, string> = { 5000: '5K', 10000: '10K', 21097: '하프', 42195: '풀' };
  const km = `${Math.round(distanceM / 100) / 10}km`;
  return named[distanceM] ? `${named[distanceM]} (${km})` : km;
}

/** S-033 상단 목표: "하프 (21.1km)" 또는 "{대회명} {종목}" (연결된 참가 예정이 해제됐으면 거리만) */
export function predictionTitle(p: Pick<PredictionSummary, 'race' | 'targetDistanceM'>): string {
  return p.race ? `${p.race.name} ${p.race.eventName}` : targetLabel(p.targetDistanceM);
}

/** 출발 시각 + 누적 → 시계 시각 (분 단위 버림, PRD 4.13: 08:00 + 0:29:14 → 08:29) */
export function clockAt(startAt: string, cumulativeSec: number): string {
  const p = kstParts(
    new Date(new Date(startAt).getTime() + Math.floor(cumulativeSec / 60) * 60_000),
  );
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

export function splitPointLabel(row: SplitRow): string {
  const km = row.atM / 1000;
  return `${Number.isInteger(km) ? km : Math.round(km * 10) / 10}km`;
}

export type SplitBasis = 'goal' | 'prediction';

/**
 * S-033 화면 상태 (PRD 6.17)
 * - result: 예측 결과 카드 + 면책 문구. 목표가 있으면 기준 토글(기본 목표 기준)
 * - goal_only: 예측 없음 + 목표 있음 → 목표 기준 스플릿만, 토글·면책 숨김
 * - empty: 예측·목표 모두 없음
 */
export type StrategyView =
  | { kind: 'result'; bases: SplitBasis[]; defaultBasis: SplitBasis }
  | { kind: 'goal_only'; reason: 'no_records' | 'unsupported_distance' }
  | { kind: 'empty' };

export function strategyView(input: {
  prediction: unknown;
  hasGoalSplits: boolean;
  unavailableReason: 'no_records' | 'unsupported_distance' | null;
}): StrategyView {
  if (input.prediction) {
    return input.hasGoalSplits
      ? { kind: 'result', bases: ['goal', 'prediction'], defaultBasis: 'goal' }
      : { kind: 'result', bases: ['prediction'], defaultBasis: 'prediction' };
  }
  if (input.hasGoalSplits) {
    return { kind: 'goal_only', reason: input.unavailableReason ?? 'no_records' };
  }
  return { kind: 'empty' };
}

/** S-032 기록 체크 (최대 5개, PRD 4.12) */
export function toggleRecordSelection(
  selected: readonly string[],
  id: string,
  max = 5,
): { selected: string[]; error: string | null } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), error: null };
  if (selected.length >= max) {
    return { selected: [...selected], error: `기록은 ${max}개까지 고를 수 있어요` };
  }
  return { selected: [...selected, id], error: null };
}
