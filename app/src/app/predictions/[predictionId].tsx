import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../api';
import { screenErrorMessage } from '../../api/messages';
import { repredictParams } from '../../components/PredictionCard';
import { PaceStrategy, PredictionBody } from '../../components/PredictionResult';
import { Button, EmptyState, ErrorState, Screen, SkeletonCards, T } from '../../components/ui';
import { predictionTitle } from '../../features/prediction';
import { findRacesForDistance } from '../../features/findRaces';
import { usePreviewPrediction } from '../../stores/preview';

/** S-033 예측 결과 — 저장된 예측을 그대로 (재계산 없음). id = preview면 S-023 미리보기 */
export default function PredictionScreen() {
  const { predictionId } = useLocalSearchParams<{ predictionId: string }>();
  const router = useRouter();
  const preview = usePreviewPrediction((s) => s.prediction);
  const isPreview = predictionId === 'preview';
  const q = useQuery({
    queryKey: ['predictions', 'detail', predictionId],
    queryFn: () => api.prediction(predictionId),
    enabled: !isPreview,
  });
  const p = isPreview ? preview : q.data;

  if (!isPreview && q.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '예측 결과' }} />
        <SkeletonCards count={3} height={120} />
      </Screen>
    );
  }
  if (!isPreview && q.isError) {
    return (
      <>
        <Stack.Screen options={{ title: '예측 결과' }} />
        <ErrorState message={screenErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      </>
    );
  }
  if (!p) {
    return (
      <>
        <Stack.Screen options={{ title: '예측 결과' }} />
        <EmptyState message="삭제되었거나 찾을 수 없는 정보예요" />
      </>
    );
  }
  const repredict = () => router.push({ pathname: '/records/predict', params: repredictParams(p) });
  return (
    <>
      <Stack.Screen options={{ title: isPreview ? '예상 기록 미리보기' : '예측 결과' }} />
      <Screen
        footer={
          isPreview ? undefined : (
            <>
              {p.raceRegistrationId ? (
                <Button
                  label="페이스 전략·목표 설정"
                  onPress={() => router.push(`/registrations/${p.raceRegistrationId}/strategy`)}
                />
              ) : (
                <Button
                  testID="find-races"
                  label="이 거리 대회 찾기"
                  onPress={() => findRacesForDistance(p.targetDistanceM)}
                />
              )}
              <Button kind="ghost" label="다시 예측" onPress={repredict} />
            </>
          )
        }
      >
        <T variant="h2" testID="prediction-title">
          {predictionTitle(p)}
        </T>
        <PredictionBody p={p} timeLimitMin={null} onRepredict={isPreview ? undefined : repredict} />
        <PaceStrategy
          bases={['prediction']}
          defaultBasis="prediction"
          goalSplits={null}
          predictionSplits={p.splits}
          startAt={p.race?.startAt ?? null}
        />
      </Screen>
    </>
  );
}
