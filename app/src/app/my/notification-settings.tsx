import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { api } from '../../api';
import { saveErrorMessage, screenErrorMessage } from '../../api/messages';
import { Button, ErrorState, Notice, Row, Screen, SkeletonCards, T } from '../../components/ui';
import { marketingToast } from '../../features/consents';
import { getPushPermission } from '../../lib/push';
import { toast } from '../../stores/toast';

type Key = 'registrationAlerts' | 'ddayAlerts' | 'marketing';
const ITEMS: { key: Key; label: string; desc: string }[] = [
  {
    key: 'registrationAlerts',
    label: '접수 알림',
    desc: '관심·참가 예정 대회의 접수 오픈·마감 소식',
  },
  { key: 'ddayAlerts', label: '대회 D-day 알림', desc: '참가 예정 대회 일주일 전·전날' },
  { key: 'marketing', label: '혜택·이벤트 알림 (광고)', desc: '이벤트·혜택 소식 (08:00~21:00)' },
];

/** S-064 알림 설정 (PRD 4.14, 6.22) — 즉시 저장, 실패하면 되돌리고 토스트 */
export default function NotificationSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-settings'], queryFn: api.notificationSettings });
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    void getPushPermission().then((p) => setDenied(p === 'denied'));
  }, []);

  const change = async (key: Key, value: boolean) => {
    const prev = q.data;
    if (!prev) return;
    qc.setQueryData(['notification-settings'], { ...prev, [key]: value });
    try {
      const res = await api.updateNotificationSettings({ [key]: value });
      qc.setQueryData(['notification-settings'], res);
      if (key === 'marketing') toast(marketingToast(value, res.marketingChangedAt));
      void qc.invalidateQueries({ queryKey: ['consents'] });
    } catch (e) {
      qc.setQueryData(['notification-settings'], prev);
      toast(saveErrorMessage(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '알림 설정' }} />
      <Screen>
        {denied ? (
          <Notice tone="yellow">
            <T variant="caption">휴대폰 설정에서 알림이 꺼져 있어요</T>
            <Button
              small
              kind="secondary"
              label="설정 열기"
              onPress={() => void Linking.openSettings()}
            />
          </Notice>
        ) : null}
        {q.isPending ? (
          <SkeletonCards count={3} height={56} />
        ) : q.isError ? (
          <ErrorState
            compact
            message={screenErrorMessage(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : (
          ITEMS.map((item) => (
            <Row key={item.key} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodyStrong">{item.label}</T>
                <T variant="caption" muted>
                  {item.desc}
                </T>
              </View>
              <Switch
                testID={`toggle-${item.key}`}
                value={q.data[item.key]}
                onValueChange={(v) => void change(item.key, v)}
              />
            </Row>
          ))
        )}
        <T variant="caption" muted>
          대회 취소·일정 변경 알림과 공지는 끌 수 없어요
        </T>
      </Screen>
    </>
  );
}
