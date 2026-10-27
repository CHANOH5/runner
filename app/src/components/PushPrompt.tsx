import { View } from 'react-native';
import { registerDevice } from '../features/auth';
import { kv } from '../lib/kv';
import { getPushPermission, requestPushPermission } from '../lib/push';
import { Button, Card, Sheet, T } from './ui';
import { analytics } from '../lib/analyticsClient';

/** 예시 알림 카드 — N-02, N-05 문구 (PRD 6.6, 7.2) */
export function SampleNotifications() {
  return (
    <View style={{ gap: 10 }}>
      <Card>
        <T variant="bodyStrong">2026 서울 하프 접수 10분 전이에요</T>
        <T variant="caption" muted>
          10:00에 접수가 열려요. 지금 접수 페이지를 열어두세요.
        </T>
      </Card>
      <Card>
        <T variant="bodyStrong">내일은 2026 서울 하프!</T>
        <T variant="caption" muted>
          08:00 출발 · 목표 페이스 5&apos;36&quot;/km. 푹 자고 내일 만나요.
        </T>
      </Card>
    </View>
  );
}

const ASKED_KEY = 'device.pushSheetShown';

/** 알림 권한 미결정 상태에서 처음 관심 등록할 때 1회 (PRD 4.8, 6.6). 띄워야 하면 true */
export async function shouldShowPushSheet(): Promise<boolean> {
  if (await kv.get<boolean>(ASKED_KEY, false)) return false;
  return (await getPushPermission()) === 'undetermined';
}

export function PushPermissionSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const close = () => {
    void kv.set(ASKED_KEY, true);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title="접수 오픈, 놓치지 않게 알려드릴게요">
      <SampleNotifications />
      <Button
        label="알림 받기"
        onPress={() =>
          void requestPushPermission()
            .then((p) => {
              analytics.track('notification_permission_result', {
                granted: p === 'granted',
                source: 'first_interest',
              });
              return registerDevice();
            })
            .finally(close)
        }
      />
      <Button kind="ghost" label="나중에" onPress={close} />
    </Sheet>
  );
}
