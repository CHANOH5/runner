import type { PredictionSummary } from '@berun/shared';
import { Pressable } from 'react-native';
import { CONFIDENCE_BADGE, formatRange, predictionTitle } from '../features/prediction';
import { formatDotDate, formatDuration } from '../lib/format';
import { useTheme } from '../theme';
import { Badge, Card, LinkText, Row, T } from './ui';

/** 최근 예측 카드 (S-030, 예측 목록) — 목표 거리·예상 기록·범위·신뢰도·날짜·연결 대회 */
export function PredictionCard({
  p,
  onPress,
  onRepredict,
}: {
  p: PredictionSummary;
  onPress: () => void;
  onRepredict: () => void;
}) {
  const c = useTheme();
  return (
    <Card testID={`prediction-${p.id}`}>
      <Pressable accessibilityRole="button" onPress={onPress} style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
            {predictionTitle(p)}
          </T>
          <Badge
            label={CONFIDENCE_BADGE[p.confidence].label}
            tone={CONFIDENCE_BADGE[p.confidence].tone}
          />
        </Row>
        <T variant="h2">{formatDuration(p.predictedSec)}</T>
        <T variant="caption" muted>
          범위 {formatRange(p)}
          {p.createdAt ? ` · ${formatDotDate(p.createdAt)}` : ''}
        </T>
      </Pressable>
      {p.recordsChangedSince ? (
        <LinkText color={c.yellow} label="기록이 바뀌었어요 · 다시 예측" onPress={onRepredict} />
      ) : null}
    </Card>
  );
}

/** "다시 예측" → S-032를 같은 목표로 (참가 예정이면 그 참가 예정, 아니면 같은 거리) */
export const repredictParams = (
  p: Pick<PredictionSummary, 'raceRegistrationId' | 'targetDistanceM'>,
) =>
  p.raceRegistrationId
    ? { registrationId: p.raceRegistrationId }
    : { distanceM: String(p.targetDistanceM) };
