import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../../../api';
import { saveErrorMessage, screenErrorMessage } from '../../../api/messages';
import { invalidateRegistrationQueries } from '../../../components/EntryStatusSheet';
import { PaceStrategy, PredictionBody } from '../../../components/PredictionResult';
import { Button, Card, ErrorState, Screen, SkeletonCards, T } from '../../../components/ui';
import { strategyView } from '../../../features/prediction';
import { formatDuration } from '../../../lib/format';
import { toast } from '../../../stores/toast';

/**
 * S-033 페이스 전략 — 참가 예정 기준 (GET /registrations/{id}/strategy, 딥링크 berun://registrations/{id}/strategy).
 * 기록이 바뀌어도 자동 재계산하지 않고 "기록이 바뀌었어요 · 다시 예측"만 띄운다 (PRD 6.17).
 */
export default function StrategyScreen() {
  const { registrationId } = useLocalSearchParams<{ registrationId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const strategy = useQuery({
    queryKey: ['strategy', registrationId],
    queryFn: () => api.strategy(registrationId),
  });
  const reg = useQuery({
    queryKey: ['registration', registrationId],
    queryFn: () => api.registration(registrationId),
  });
  const race = useQuery({
    queryKey: ['race', reg.data?.raceId],
    queryFn: () => api.race(reg.data!.raceId),
    enabled: !!reg.data,
  });

  if (strategy.isPending || reg.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '페이스 전략' }} />
        <SkeletonCards count={3} height={120} />
      </Screen>
    );
  }
  if (strategy.isError || reg.isError) {
    return (
      <>
        <Stack.Screen options={{ title: '페이스 전략' }} />
        <ErrorState
          message={screenErrorMessage(strategy.error ?? reg.error)}
          onRetry={() => void (strategy.isError ? strategy.refetch() : reg.refetch())}
        />
      </>
    );
  }

  const s = strategy.data;
  const r = reg.data;
  const event = race.data?.events.find((e) => e.id === r.raceEventId) ?? null;
  const p = s.prediction;
  const view = strategyView({
    prediction: p,
    hasGoalSplits: !!s.goalSplits,
    unavailableReason: s.predictionUnavailableReason,
  });
  const title = race.data
    ? `${race.data.name} ${r.eventName}`
    : p?.race
      ? `${p.race.name} ${p.race.eventName}`
      : r.eventName;
  const startAt = p?.race?.startAt ?? event?.startAt ?? null;
  const repredict = () => router.push({ pathname: '/records/predict', params: { registrationId } });
  const editGoal = () =>
    router.push({ pathname: '/races/[raceId]/register', params: { raceId: r.raceId } });

  const setGoal = async () => {
    if (!p) return;
    setSaving(true);
    try {
      await api.updateRegistration(registrationId, {
        goalSource: 'prediction',
        goalTimeSec: p.predictedSec,
      });
      toast(`목표 기록을 ${formatDuration(p.predictedSec)}로 정했어요`);
      invalidateRegistrationQueries(qc, r.raceId);
      void qc.invalidateQueries({ queryKey: ['strategy', registrationId] });
      void qc.invalidateQueries({ queryKey: ['registration', registrationId] });
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '페이스 전략' }} />
      <Screen
        footer={
          p ? (
            <>
              <Button
                testID="set-goal"
                label="이 기록을 목표로 설정"
                loading={saving}
                onPress={() => void setGoal()}
              />
              <Button kind="ghost" label="다시 예측" onPress={repredict} />
            </>
          ) : undefined
        }
      >
        <T variant="h2" testID="strategy-title">
          {title}
        </T>
        {r.goalTimeSec !== null ? <T muted>목표 {formatDuration(r.goalTimeSec)}</T> : null}

        {view.kind === 'result' && p ? (
          <>
            <PredictionBody
              p={p}
              timeLimitMin={event?.timeLimitMin ?? null}
              onRepredict={repredict}
            />
            <PaceStrategy
              bases={view.bases}
              defaultBasis={view.defaultBasis}
              goalSplits={s.goalSplits}
              predictionSplits={p.splits}
              startAt={startAt}
            />
          </>
        ) : null}

        {view.kind === 'goal_only' ? (
          <>
            <Card tone="outline" testID="strategy-no-prediction">
              {view.reason === 'unsupported_distance' ? (
                <T>이 종목은 예상 기록을 지원하지 않아요</T>
              ) : (
                <>
                  <T>기록을 넣으면 예상 기록도 볼 수 있어요</T>
                  <Button
                    small
                    kind="secondary"
                    label="기록 추가"
                    onPress={() => router.push('/records/edit')}
                  />
                </>
              )}
            </Card>
            <PaceStrategy
              bases={['goal']}
              defaultBasis="goal"
              goalSplits={s.goalSplits}
              predictionSplits={null}
              startAt={startAt}
            />
          </>
        ) : null}

        {view.kind === 'empty' ? (
          <Card tone="outline" testID="strategy-empty">
            <T>목표 기록이나 최근 기록이 있어야 페이스 전략을 만들 수 있어요</T>
            <Button small label="목표 기록 정하기" onPress={editGoal} />
            <Button
              small
              kind="secondary"
              label="기록 추가"
              onPress={() => router.push('/records/edit')}
            />
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
