import type { DeletionReason } from '@berun/shared';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import type { z } from 'zod';
import { api, clearLocalSession } from '../../api';
import {
  Button,
  Card,
  CheckRow,
  Field,
  Input,
  RadioRow,
  Screen,
  Section,
  T,
} from '../../components/ui';
import { useConfirm } from '../../components/useConfirm';
import { useSession } from '../../stores/session';
import { toast } from '../../stores/toast';
import { analytics } from '../../lib/analyticsClient';

type Reason = z.infer<typeof DeletionReason>;
const REASONS: [Reason, string][] = [
  ['no_races', '쓸 만한 대회가 없어요'],
  ['too_many_alerts', '알림이 너무 많아요'],
  ['bad_prediction', '예측이 맞지 않아요'],
  ['other_app', '다른 앱을 써요'],
  ['privacy', '개인정보가 걱정돼요'],
  ['other', '기타'],
];

/** S-066 회원 탈퇴 (PRD 4.15, 6.24) */
export default function DeleteAccount() {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();

  const submit = async () => {
    const ok = await confirm({
      message: '탈퇴하면 기록과 대회 정보가 모두 지워지고 되돌릴 수 없어요.',
      confirmLabel: '탈퇴',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteMe({
        reasonCode: reason,
        reasonText: reason === 'other' && text.trim() ? text.trim() : null,
        confirmed: true,
      });
      analytics.track('account_deleted', { reason_code: reason });
      await clearLocalSession();
      useSession.getState().setGate(null);
      useSession.getState().setStatus('signedOut');
      router.replace('/login');
      toast('탈퇴가 완료되었어요. 그동안 이용해주셔서 감사해요');
    } catch {
      toast('탈퇴 처리 중 문제가 생겼어요. 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '회원 탈퇴', gestureEnabled: !busy }} />
      <Screen
        footer={
          <Button
            testID="delete-submit"
            kind="danger"
            label="탈퇴하기"
            disabled={!ack}
            onPress={() => void submit()}
          />
        }
      >
        <Card tone="outline">
          <T variant="bodyStrong">즉시 삭제돼요</T>
          <T variant="caption" muted>
            계정·프로필·이메일, 기록, 예측, 관심·참가 예정, 알림, 기기 정보
          </T>
          <T variant="bodyStrong" style={{ marginTop: 8 }}>
            법에 따라 보관돼요
          </T>
          <T variant="caption" muted>
            동의 이력 (법정 기간), 오류 제보 내용 (작성자 정보 없이 익명으로)
          </T>
        </Card>
        <CheckRow
          testID="delete-ack"
          label="안내를 모두 확인했어요"
          checked={ack}
          onToggle={() => setAck(!ack)}
        />
        <Section title="탈퇴 사유 (선택)">
          {REASONS.map(([v, label]) => (
            <RadioRow
              key={v}
              label={label}
              selected={reason === v}
              onPress={() => setReason(reason === v ? null : v)}
            />
          ))}
          {reason === 'other' ? (
            <Field hint={`${[...text].length}/200`}>
              <Input
                value={text}
                onChangeText={setText}
                maxLength={200}
                multiline
                style={{ minHeight: 80 }}
              />
            </Field>
          ) : null}
        </Section>
      </Screen>
      {dialog}
      <Modal visible={busy} transparent>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        >
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </Modal>
    </>
  );
}
