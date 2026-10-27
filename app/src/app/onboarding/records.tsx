import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { saveErrorMessage } from '../../api/messages';
import { RecordForm } from '../../components/RecordForm';
import { Button, Card, LinkText, Progress, Row, Screen, T, TopBar } from '../../components/ui';
import { useConfirm } from '../../components/useConfirm';
import {
  emptyRecordForm,
  isRecordFormEmpty,
  validateRecordForm,
  type RecordFormState,
} from '../../features/recordForm';
import { saveRecordWithDuplicateCheck } from '../../features/records';
import { todayKst } from '../../lib/format';
import { getPushPermission } from '../../lib/push';
import { toast } from '../../stores/toast';
import { analytics } from '../../lib/analyticsClient';

const MAX_FORMS = 3;

/** S-005 최근 기록 입력 (PRD 6.5) — 온보딩에서 최대 3개 */
export default function OnboardingRecords() {
  const router = useRouter();
  const { nickname } = useLocalSearchParams<{ nickname?: string }>();
  const today = todayKst();
  const [forms, setForms] = useState<RecordFormState[]>([emptyRecordForm(today)]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, confirm] = useConfirm();

  const filled = forms.filter((f) => !isRecordFormEmpty(f));
  const results = filled.map((f) => validateRecordForm(f, today));

  const next = async () => {
    // 알림 권한이 이미 결정된 기기면 S-006 건너뜀 (PRD 6.5)
    const permission = await getPushPermission();
    if (permission === 'undetermined') {
      router.replace({ pathname: '/onboarding/notifications', params: { nickname } });
    } else {
      router.replace('/home');
      toast(`가입을 환영해요, ${nickname ?? ''}님!`);
    }
  };

  const save = async () => {
    setTouched(true);
    if (results.some((r) => !r.values)) return;
    setSaving(true);
    try {
      for (const r of results) {
        const saved = await saveRecordWithDuplicateCheck(r.values!, () =>
          confirm({ message: '같은 기록이 이미 있어요. 그래도 저장할까요?', confirmLabel: '저장' }),
        );
        if (saved) {
          analytics.track('record_saved', {
            distance_category: saved.category,
            kind: saved.kind,
            is_edit: false,
            source: 'onboarding',
          });
        }
      }
      await next();
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar
        right={<LinkText testID="records-skip" label="건너뛰기" onPress={() => void next()} />}
      />
      <Screen
        footer={
          <Button
            testID="records-save"
            label="저장하고 계속"
            disabled={filled.length === 0}
            loading={saving}
            onPress={() => void save()}
          />
        }
      >
        <Progress step={2} total={3} />
        <T variant="title">최근에 뛴 기록이 있나요?</T>
        <T muted>기록을 넣으면 대회 예상 기록을 알려드려요</T>
        {forms.map((f, i) => (
          <Card key={i} tone="outline">
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="bodyStrong">기록 {i + 1}</T>
              {i > 0 ? (
                <LinkText
                  label="삭제"
                  onPress={() => setForms((prev) => prev.filter((_, j) => j !== i))}
                />
              ) : null}
            </Row>
            <RecordForm
              testID={`onb-record-${i}`}
              value={f}
              onChange={(v) => setForms((prev) => prev.map((x, j) => (j === i ? v : x)))}
              errors={validateRecordForm(f, today).errors}
              today={today}
              showErrors={touched && !isRecordFormEmpty(f)}
            />
          </Card>
        ))}
        {forms.length < MAX_FORMS ? (
          <Button
            kind="secondary"
            label="+ 기록 더 넣기"
            onPress={() => setForms((prev) => [...prev, emptyRecordForm(today)])}
          />
        ) : null}
      </Screen>
      {dialog}
    </>
  );
}
