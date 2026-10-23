import {
  PREDICTION_MAX_DISTANCE_M,
  PREDICTION_MIN_DISTANCE_M,
  STANDARD_DISTANCE_M,
} from '@berun/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api } from '../../api';
import { saveErrorMessage, screenErrorMessage } from '../../api/messages';
import {
  Badge,
  Button,
  Card,
  CheckRow,
  Chip,
  ErrorState,
  Field,
  Input,
  LinkText,
  Notice,
  RadioRow,
  Row,
  Screen,
  Section,
  SkeletonCards,
  T,
} from '../../components/ui';
import { toggleRecordSelection, WEIGHT_LABEL } from '../../features/prediction';
import { formatDate, formatDistance, formatDuration, formatKm } from '../../lib/format';
import { toast } from '../../stores/toast';

type Target =
  | { type: 'distance'; distanceM: number; key: string }
  | { type: 'registration'; registrationId: string; distanceM: number; key: string };

const CHIPS = [
  { key: '5k', label: '5K', m: STANDARD_DISTANCE_M['5k'] },
  { key: '10k', label: '10K', m: STANDARD_DISTANCE_M['10k'] },
  { key: 'half', label: '하프', m: STANDARD_DISTANCE_M.half },
  { key: 'full', label: '풀', m: STANDARD_DISTANCE_M.full },
];

/** 직접 입력 거리 3.0~42.195km (PRD 4.12) */
function customKmToM(km: string): number | null {
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(km.trim())) return null;
  const m = Math.round(Number(km) * 1000);
  return m >= PREDICTION_MIN_DISTANCE_M && m <= PREDICTION_MAX_DISTANCE_M ? m : null;
}

/** S-032 기록 예측 (PRD 4.12, 6.16) */
export default function Predict() {
  const params = useLocalSearchParams<{ registrationId?: string; distanceM?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const upcoming = useQuery({
    queryKey: ['my-races', 'upcoming'],
    queryFn: () => api.myRaces('upcoming'),
  });

  const [target, setTarget] = useState<Target | null>(
    params.distanceM
      ? { type: 'distance', distanceM: Number(params.distanceM), key: 'param' }
      : null,
  );
  const [customKm, setCustomKm] = useState('');
  const [custom, setCustom] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  // 참가 대회에서 왔으면 그 대회를 미리 선택 (PRD 6.16)
  useEffect(() => {
    if (!params.registrationId || target || !upcoming.data) return;
    const item = upcoming.data.items.find((i) => i.registration?.id === params.registrationId);
    if (item?.registration?.predictionSupported) {
      setTarget({
        type: 'registration',
        registrationId: item.registration.id,
        distanceM: item.registration.eventDistanceM,
        key: item.registration.id,
      });
    }
  }, [params.registrationId, target, upcoming.data]);

  const distanceM = target?.distanceM ?? STANDARD_DISTANCE_M.half;
  const candidates = useQuery({
    queryKey: ['candidates', distanceM],
    queryFn: () => api.predictionCandidates(distanceM),
  });
  const auto = useMemo(
    () => candidates.data?.records.filter((r) => r.autoSelected).map((r) => r.record.id) ?? [],
    [candidates.data],
  );
  const chosen = selected ?? auto;
  const [selectError, setSelectError] = useState<string | null>(null);

  const predict = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const p = await api.predict({
        target:
          target.type === 'registration'
            ? { type: 'registration', registrationId: target.registrationId }
            : { type: 'distance', distanceM: target.distanceM },
        recordIds: selected === null ? null : selected,
      });
      void qc.invalidateQueries({ queryKey: ['predictions'] });
      void qc.invalidateQueries({ queryKey: ['strategy'] });
      router.replace(`/predictions/${p.id}`);
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const empty = candidates.data?.emptyReason ?? null;
  const regs = (upcoming.data?.items ?? []).filter((i) => i.registration);

  return (
    <>
      <Stack.Screen options={{ title: '기록 예측' }} />
      <Screen
        footer={
          <Button
            testID="predict-submit"
            label="예측하기"
            disabled={!target || chosen.length === 0 || !!empty}
            loading={saving}
            onPress={() => void predict()}
          />
        }
      >
        <Section title="목표 거리">
          <Row wrap>
            {CHIPS.map((chip) => (
              <Chip
                key={chip.key}
                testID={`target-${chip.key}`}
                label={chip.label}
                selected={target?.type === 'distance' && target.distanceM === chip.m && !custom}
                onPress={() => {
                  setCustom(false);
                  setSelected(null);
                  setTarget({ type: 'distance', distanceM: chip.m, key: chip.key });
                }}
              />
            ))}
            <Chip label="직접 입력" selected={custom} onPress={() => setCustom(true)} />
          </Row>
          {custom ? (
            <Field
              error={
                customKm && customKmToM(customKm) === null
                  ? '3.0~42.195km 사이로 입력해주세요'
                  : null
              }
            >
              <Input
                testID="target-custom"
                value={customKm}
                placeholder="예: 15"
                keyboardType="decimal-pad"
                onChangeText={(t) => {
                  setCustomKm(t);
                  const m = customKmToM(t);
                  setSelected(null);
                  setTarget(m ? { type: 'distance', distanceM: m, key: 'custom' } : null);
                }}
              />
            </Field>
          ) : null}
          {regs.length > 0 ? (
            <View style={{ gap: 8 }}>
              <T variant="caption" muted>
                내 참가 대회
              </T>
              {regs.map((i) => {
                const reg = i.registration!;
                return (
                  <RadioRow
                    key={reg.id}
                    label={`${i.name} ${reg.eventName}`}
                    sub={
                      reg.predictionSupported ? formatKm(reg.eventDistanceM) : '예측 미지원 거리'
                    }
                    disabled={!reg.predictionSupported}
                    selected={target?.type === 'registration' && target.registrationId === reg.id}
                    onPress={() => {
                      setCustom(false);
                      setSelected(null);
                      setTarget({
                        type: 'registration',
                        registrationId: reg.id,
                        distanceM: reg.eventDistanceM,
                        key: reg.id,
                      });
                    }}
                  />
                );
              })}
            </View>
          ) : null}
        </Section>

        <Section
          title="사용할 기록"
          right={
            selected !== null ? (
              <LinkText label="자동 선택으로 되돌리기" onPress={() => setSelected(null)} />
            ) : undefined
          }
        >
          {candidates.isPending ? (
            <SkeletonCards count={3} height={52} />
          ) : candidates.isError ? (
            <ErrorState
              compact
              message={screenErrorMessage(candidates.error)}
              onRetry={() => void candidates.refetch()}
            />
          ) : empty ? (
            <Card tone="outline" testID="predict-empty">
              <T>예측하려면 최근 1년 안에 뛴 3km 이상 기록이 필요해요</T>
              {empty === 'all_older_than_365d' ? (
                <T variant="caption" muted>
                  1년이 지난 기록은 현재 실력과 차이가 클 수 있어요
                </T>
              ) : null}
              <Button
                small
                kind="secondary"
                label="기록 추가"
                onPress={() => router.push('/records/edit')}
              />
            </Card>
          ) : (
            <>
              {selectError ? <Notice tone="yellow">{selectError}</Notice> : null}
              {candidates.data.records.map(({ record, weightLabel }) => (
                <CheckRow
                  key={record.id}
                  testID={`candidate-${record.id}`}
                  label={`${formatDistance(record.distanceM, record.category)} ${formatDuration(record.durationSec)} · ${formatDate(record.runDate)}`}
                  checked={chosen.includes(record.id)}
                  onToggle={() => {
                    const res = toggleRecordSelection(chosen, record.id);
                    setSelectError(res.error);
                    if (!res.error) setSelected(res.selected);
                  }}
                  right={
                    <Badge
                      label={WEIGHT_LABEL[weightLabel]}
                      tone={
                        weightLabel === 'high'
                          ? 'green'
                          : weightLabel === 'medium'
                            ? 'yellow'
                            : 'gray'
                      }
                    />
                  }
                />
              ))}
            </>
          )}
        </Section>
        {!target ? (
          <T variant="caption" muted>
            목표 거리를 골라주세요
          </T>
        ) : null}
      </Screen>
    </>
  );
}
