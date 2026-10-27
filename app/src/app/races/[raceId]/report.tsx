import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { api } from '../../../api';
import { saveErrorMessage } from '../../../api/messages';
import {
  Button,
  Chip,
  Field,
  Input,
  Row,
  Screen,
  Section,
  T,
  TopBar,
} from '../../../components/ui';
import { useConfirm } from '../../../components/useConfirm';
import { toast } from '../../../stores/toast';
import { goBack } from '../../../lib/nav';
import { analytics } from '../../../lib/analyticsClient';

const FIELDS = [
  ['date', '대회 일시'],
  ['venue', '장소'],
  ['events', '종목·거리'],
  ['fee', '참가비'],
  ['registration', '접수 기간'],
  ['links', '링크'],
  ['status', '취소·연기'],
  ['other', '기타'],
] as const;

/** S-024 대회 정보 오류 제보 (PRD 4.11, 6.13) */
export default function Report() {
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const race = useQuery({ queryKey: ['race', raceId], queryFn: () => api.race(raceId) });
  const [field, setField] = useState<(typeof FIELDS)[number][0] | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialog, confirm] = useConfirm();
  const len = [...message.trim()].length;
  const valid = field !== null && len >= 10 && len <= 500;

  const back = async () => {
    if (
      (field || message) &&
      !(await confirm({ message: '작성 중인 내용이 사라져요', confirmLabel: '나가기' }))
    )
      return;
    goBack();
  };

  const submit = async () => {
    if (!field) return;
    setSaving(true);
    try {
      await api.report(raceId, { field, message: message.trim() });
      analytics.track('race_report_submitted', { race_id: raceId, field });
      goBack();
      toast('제보해주셔서 감사해요. 확인 후 알려드릴게요');
    } catch (e) {
      toast(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar title="정보 제보" onBack={() => void back()} />
      <Screen
        footer={
          <Button
            testID="report-submit"
            label="제보하기"
            disabled={!valid}
            loading={saving}
            onPress={() => void submit()}
          />
        }
      >
        <T variant="h2">{race.data?.name ?? ''}</T>
        <Section title="어떤 정보가 틀렸나요?">
          <Row wrap>
            {FIELDS.map(([v, label]) => (
              <Chip key={v} label={label} selected={field === v} onPress={() => setField(v)} />
            ))}
          </Row>
        </Section>
        <Field label="내용" hint={`${len}/500 · 제보 내용은 운영자만 봐요`}>
          <Input
            testID="report-message"
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={500}
            placeholder="어떤 정보가 어떻게 다른지 알려주세요. 근거 링크가 있으면 함께 적어주세요."
            style={{ minHeight: 140, textAlignVertical: 'top' }}
          />
        </Field>
      </Screen>
      {dialog}
    </>
  );
}
