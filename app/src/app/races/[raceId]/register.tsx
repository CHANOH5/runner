import {
  PREDICTION_MAX_DISTANCE_M,
  PREDICTION_MIN_DISTANCE_M,
  type EntryStatus,
  type RaceDetail,
  type Registration,
} from '@berun/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../../../api';
import { isApiError } from '../../../api/client';
import { errorMessage, saveErrorMessage, screenErrorMessage } from '../../../api/messages';
import { invalidateRegistrationQueries } from '../../../components/EntryStatusSheet';
import {
  Badge,
  Button,
  Card,
  CheckRow,
  DurationInput,
  ErrorState,
  Field,
  LinkText,
  Notice,
  RadioRow,
  Row,
  Screen,
  Section,
  Segmented,
  Sheet,
  Skeleton,
  SkeletonCards,
  T,
  TopBar,
} from '../../../components/ui';
import { useConfirm } from '../../../components/useConfirm';
import { checkGoal } from '../../../features/goal';
import { CONFIDENCE_BADGE, formatRange } from '../../../features/prediction';
import { defaultEntryStatus, ENTRY_STATUS_LABEL } from '../../../features/race';
import { savePromptSettled } from '../../../features/returnPrompt';
import { openInAppBrowser } from '../../../lib/external';
import {
  formatDate,
  formatDuration,
  formatHoursMinutes,
  formatKm,
  formatPace,
  formatTime,
  hmsToSec,
  secToHms,
} from '../../../lib/format';
import { kv } from '../../../lib/kv';
import { usePreviewPrediction } from '../../../stores/preview';
import { toast } from '../../../stores/toast';
import { useTheme } from '../../../theme';
import { goBack } from '../../../lib/nav';
import { analytics } from '../../../lib/analyticsClient';

type GoalMode = 'prediction' | 'manual' | 'none';
const HIDE_NOTICE_KEY = 'device.hideOfficialRegistrationNotice';

const supported = (m: number) => m >= PREDICTION_MIN_DISTANCE_M && m <= PREDICTION_MAX_DISTANCE_M;

/** S-023 참가 예정 추가·수정 (PRD 4.10, 6.12) */
export default function RegisterScreen() {
  const { raceId, from } = useLocalSearchParams<{ raceId: string; from?: string }>();
  const race = useQuery({ queryKey: ['race', raceId], queryFn: () => api.race(raceId) });
  // 처음 열 때의 참가 예정으로 모드를 정한다 — 추가 직후 대회를 다시 읽어도 화면이 수정 모드로 바뀌지 않게
  const initialRegId = useRef<string | null | undefined>(undefined);
  if (initialRegId.current === undefined && race.data) {
    initialRegId.current = race.data.my.registration?.id ?? null;
  }
  const regId = initialRegId.current ?? undefined;
  const existing = useQuery({
    queryKey: ['registration', regId],
    queryFn: () => api.registration(regId!),
    enabled: !!regId,
  });

  if (race.isPending || (regId && existing.isPending)) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <TopBar title="참가 예정" />
        <Screen>
          <SkeletonCards count={3} />
        </Screen>
      </>
    );
  }
  if (race.isError || existing.isError) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <TopBar title="참가 예정" />
        <ErrorState
          message={screenErrorMessage(race.error ?? existing.error)}
          onRetry={() => void (race.isError ? race.refetch() : existing.refetch())}
        />
      </>
    );
  }
  return (
    <RegisterForm
      key={existing.data?.id ?? 'new'}
      race={race.data}
      existing={existing.data ?? null}
      fromReturnPrompt={from === 'return_prompt'}
    />
  );
}

function RegisterForm({
  race,
  existing,
  fromReturnPrompt,
}: {
  race: RaceDetail;
  existing: Registration | null;
  fromReturnPrompt: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const c = useTheme();
  const setPreview = usePreviewPrediction((s) => s.set);
  const [dialog, confirm] = useConfirm();
  const edit = existing !== null;

  const [eventId, setEventId] = useState<string | null>(
    existing?.raceEventId ?? (race.events.length === 1 ? race.events[0]!.id : null),
  );
  const [mode, setMode] = useState<GoalMode>(
    existing ? (existing.goalSource === 'none' ? 'none' : existing.goalSource) : 'none',
  );
  const [manual, setManual] = useState(
    existing?.goalTimeSec && existing.goalSource === 'manual'
      ? secToHms(existing.goalTimeSec)
      : { h: '', m: '', s: '' },
  );
  const [predGoal, setPredGoal] = useState<number | null>(
    existing?.goalSource === 'prediction' ? existing.goalTimeSec : null,
  );
  const [entry, setEntry] = useState<EntryStatus>(
    existing?.entryStatus ??
      (fromReturnPrompt ? 'registered' : defaultEntryStatus(race.registrationState)),
  );
  const [eventNotice, setEventNotice] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [officialNotice, setOfficialNotice] = useState<{ next: () => void } | null>(null);
  const [hideNotice, setHideNotice] = useState(false);

  const event = race.events.find((e) => e.id === eventId) ?? null;
  const canPredict = event ? supported(event.distanceM) : false;

  const preview = useQuery({
    queryKey: ['preview', event?.id],
    queryFn: () =>
      api.previewPrediction({
        target: { type: 'race_event', raceEventId: event!.id },
        recordIds: null,
      }),
    enabled: !!event && canPredict,
    retry: false,
  });

  const goalSec =
    mode === 'manual'
      ? hmsToSec(manual.h, manual.m, manual.s)
      : mode === 'prediction'
        ? predGoal
        : null;
  const goal = event ? checkGoal(goalSec, event.distanceM, event.timeLimitMin) : null;
  const goalReady = mode === 'none' || (goalSec !== null && goalSec > 0 && !goal?.error);

  useEffect(() => setGoalError(null), [goalSec]);

  const title =
    fromReturnPrompt && !edit
      ? '어느 종목에 접수했나요?'
      : edit
        ? '참가 예정 수정'
        : '참가 예정 추가';

  const selectEvent = (id: string) => {
    const next = race.events.find((e) => e.id === id);
    if (event && next && next.distanceM !== event.distanceM && mode !== 'none') {
      setMode('none');
      setManual({ h: '', m: '', s: '' });
      setPredGoal(null);
      setEventNotice(true);
    }
    setEventId(id);
    setDirty(true);
  };

  const applyPrediction = (sec: number) => {
    setPredGoal(sec);
    setMode('prediction');
    setDirty(true);
  };

  const back = async () => {
    if (dirty) {
      const ok = await confirm({ message: '작성 중인 내용이 사라져요', confirmLabel: '나가기' });
      if (!ok) return;
    }
    goBack();
  };

  const afterSave = (reg: Registration) => {
    const go = () => {
      invalidateRegistrationQueries(qc, race.id);
      void qc.invalidateQueries({ queryKey: ['registration', reg.id] });
      void qc.invalidateQueries({ queryKey: ['strategy', reg.id] });
      if (reg.goalTimeSec !== null) router.replace(`/registrations/${reg.id}/strategy`);
      else {
        goBack();
        toast(edit ? '저장했어요' : '참가 예정에 추가했어요');
      }
    };
    if (!edit && reg.showOfficialRegistrationNotice) {
      void kv
        .get<boolean>(HIDE_NOTICE_KEY, false)
        .then((hidden) => (hidden ? go() : setOfficialNotice({ next: go })));
    } else go();
  };

  const submit = async () => {
    if (!event || !goalReady) return;
    setSaving(true);
    const goalBody =
      mode === 'none'
        ? { goalSource: 'none' as const }
        : { goalSource: mode, goalTimeSec: goalSec! };
    try {
      let reg: Registration;
      if (existing) {
        reg = await api.updateRegistration(existing.id, {
          ...(event.id !== existing.raceEventId && { raceEventId: event.id }),
          ...(entry !== existing.entryStatus && {
            entryStatus: entry,
            entryStatusSource: 'form' as const,
          }),
          ...goalBody,
        });
        if (entry !== existing.entryStatus) await savePromptSettled(race.id);
      } else {
        reg = await api.createRegistration(race.id, {
          raceEventId: event.id,
          entryStatus: entry === 'missed' ? 'not_registered' : entry,
          entryStatusSource: fromReturnPrompt ? 'return_prompt' : 'form',
          ...goalBody,
        });
        if (entry === 'registered') await savePromptSettled(race.id);
      }
      setDirty(false);
      analytics.track('registration_saved', {
        race_id: race.id,
        race_event_id: reg.raceEventId,
        has_goal: reg.goalTimeSec !== null,
        goal_source: reg.goalSource,
        is_edit: !!existing,
        entry_status: reg.entryStatus,
        source: fromReturnPrompt ? 'return_prompt' : 'race_detail',
      });
      if (existing && entry !== existing.entryStatus) {
        analytics.track('entry_status_changed', {
          race_id: race.id,
          from: existing.entryStatus,
          to: entry,
          source: 'form',
        });
      }
      afterSave(reg);
    } catch (e) {
      if (isApiError(e) && e.code === 'GOAL_OUT_OF_RANGE') setGoalError(errorMessage(e));
      else {
        toast(saveErrorMessage(e));
        if (
          isApiError(e) &&
          ['ALREADY_PLANNED', 'RACE_CANCELLED', 'RACE_FINISHED'].includes(e.code)
        ) {
          invalidateRegistrationQueries(qc, race.id);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      message: '참가 예정을 해제할까요? 목표 기록도 함께 지워져요.',
      confirmLabel: '해제하기',
      cancelLabel: '닫기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRegistration(existing.id);
      analytics.track('registration_cancelled', { race_id: race.id });
      invalidateRegistrationQueries(qc, race.id);
      goBack();
      toast('참가 예정을 해제했어요');
    } catch (e) {
      toast(saveErrorMessage(e));
    }
  };

  const entryOptions = useMemo(
    () =>
      (edit
        ? (['not_registered', 'registered', 'missed'] as const)
        : (['not_registered', 'registered'] as const)
      ).map((v) => ({ value: v, label: ENTRY_STATUS_LABEL[v] })),
    [edit],
  );

  const p = preview.data;
  const previewErrorCode = isApiError(preview.error) ? preview.error.code : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar title={title} onBack={() => void back()} />
      <Screen
        footer={
          <Button
            testID="register-submit"
            label={edit ? '저장하기' : '추가하기'}
            disabled={!event || !goalReady}
            loading={saving}
            onPress={() => void submit()}
          />
        }
      >
        <View style={{ gap: 2 }}>
          <T variant="h2">{race.name}</T>
          <T variant="caption" muted>
            {formatDate(race.raceDate)}
          </T>
        </View>

        <Section title="종목">
          {race.events.map((ev) => (
            <RadioRow
              key={ev.id}
              testID={`event-${ev.id}`}
              label={`${ev.name} · ${formatKm(ev.distanceM)}`}
              sub={[
                ev.startAt ? `${formatTime(ev.startAt)} 출발` : null,
                ev.timeLimitMin !== null
                  ? `제한 ${formatHoursMinutes(ev.timeLimitMin * 60)}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              selected={ev.id === eventId}
              onPress={() => selectEvent(ev.id)}
            />
          ))}
          {eventNotice ? (
            <Notice tone="yellow">종목이 바뀌어 목표 기록을 다시 정해주세요</Notice>
          ) : null}
        </Section>

        {event ? (
          <Section title="목표 기록">
            {!canPredict ? (
              <Notice>이 종목은 예상 기록을 지원하지 않아요</Notice>
            ) : preview.isPending ? (
              <Skeleton height={110} />
            ) : previewErrorCode === 'NO_ELIGIBLE_RECORDS' ? (
              <Card tone="outline">
                <T>기록을 입력하면 예상 기록을 추천해드려요</T>
                <Button
                  small
                  kind="secondary"
                  label="기록 입력하기"
                  onPress={() =>
                    router.push({ pathname: '/records/edit', params: { returnTo: 'register' } })
                  }
                />
              </Card>
            ) : p ? (
              <Card testID="prediction-card">
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="caption" muted>
                    예상 기록
                  </T>
                  <Badge
                    label={CONFIDENCE_BADGE[p.confidence].label}
                    tone={CONFIDENCE_BADGE[p.confidence].tone}
                  />
                </Row>
                <T variant="title">{formatDuration(p.predictedSec)}</T>
                <T variant="caption" muted>
                  범위 {formatRange(p)} · 평균 {formatPace(p.avgPaceSecPerKm)}
                </T>
                <Row>
                  <Button
                    small
                    testID="use-prediction"
                    label="이 기록을 목표로"
                    onPress={() => applyPrediction(p.predictedSec)}
                  />
                  <LinkText
                    label="자세히"
                    onPress={() => {
                      setPreview(p);
                      router.push('/predictions/preview');
                    }}
                  />
                </Row>
              </Card>
            ) : (
              <Notice>예상 기록을 계산하지 못했어요</Notice>
            )}
            {p?.firstFullSuggestionSec ? (
              <Card tone="outline">
                <T>첫 풀코스라면 {formatDuration(p.firstFullSuggestionSec)} 목표를 권해요</T>
                <Button
                  small
                  kind="secondary"
                  label="이 기록으로"
                  onPress={() => applyPrediction(p.firstFullSuggestionSec!)}
                />
              </Card>
            ) : null}

            <Segmented<GoalMode>
              testID="goal-mode"
              options={[
                { value: 'prediction', label: '예측 추천' },
                { value: 'manual', label: '직접 입력' },
                { value: 'none', label: '목표 없이 완주' },
              ]}
              value={mode}
              onChange={(m) => {
                if (m === 'prediction' && predGoal === null && p) setPredGoal(p.predictedSec);
                if (m === 'prediction' && !p) return;
                setMode(m);
                setDirty(true);
              }}
            />
            {mode === 'manual' ? (
              <Field error={goalError ?? goal?.error}>
                <DurationInput
                  testID="goal-manual"
                  value={manual}
                  onChange={(v) => {
                    setManual(v);
                    setDirty(true);
                  }}
                  invalid={!!(goalError ?? goal?.error)}
                />
              </Field>
            ) : null}
            {mode === 'prediction' && predGoal !== null ? (
              <T variant="bodyStrong">목표 {formatDuration(predGoal)}</T>
            ) : null}
            {mode !== 'none' && goal?.paceSecPerKm && !goal.error ? (
              <T variant="caption" color={c.primary} testID="goal-pace">
                목표 페이스 {formatPace(goal.paceSecPerKm)}
              </T>
            ) : null}
            {goal?.warning ? <Notice tone="yellow">{goal.warning}</Notice> : null}
            {mode === 'prediction' && goalError ? (
              <T variant="caption" color={c.red}>
                {goalError}
              </T>
            ) : null}
          </Section>
        ) : null}

        <Section title="접수 상태">
          <Segmented<EntryStatus>
            testID="entry-segment"
            options={entryOptions}
            value={entry}
            onChange={(v) => {
              setEntry(v);
              setDirty(true);
            }}
          />
          <T variant="caption" muted>
            공식 홈페이지에서 접수를 마쳤다면 접수 완료로 표시해주세요. 마감 알림을 보내지 않아요.
          </T>
        </Section>

        {edit ? (
          <LinkText
            testID="register-remove"
            label="참가 예정 해제"
            color={c.red}
            onPress={() => void remove()}
          />
        ) : null}
      </Screen>

      <Sheet
        visible={officialNotice !== null}
        onClose={() => {
          if (hideNotice) void kv.set(HIDE_NOTICE_KEY, true);
          const next = officialNotice?.next;
          setOfficialNotice(null);
          next?.();
        }}
        title="공식 접수는 대회 홈페이지에서 해야 해요"
        testID="official-notice"
      >
        <T>BeRun은 접수를 대신하지 않아요.</T>
        <CheckRow
          label="다시 보지 않기"
          checked={hideNotice}
          onToggle={() => setHideNotice(!hideNotice)}
        />
        {race.registrationState === 'open' && race.registrationUrl ? (
          <Button
            label="접수하러 가기"
            onPress={() => {
              if (hideNotice) void kv.set(HIDE_NOTICE_KEY, true);
              const next = officialNotice?.next;
              setOfficialNotice(null);
              void openInAppBrowser(race.registrationUrl!);
              next?.();
            }}
          />
        ) : null}
        <Button
          kind="secondary"
          label="닫기"
          onPress={() => {
            if (hideNotice) void kv.set(HIDE_NOTICE_KEY, true);
            const next = officialNotice?.next;
            setOfficialNotice(null);
            next?.();
          }}
        />
      </Sheet>
      {dialog}
    </>
  );
}
