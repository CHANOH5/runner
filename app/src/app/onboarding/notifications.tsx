import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SampleNotifications } from '../../components/PushPrompt';
import { Button, Progress, Screen, T, TopBar } from '../../components/ui';
import { registerDevice } from '../../features/auth';
import { requestPushPermission } from '../../lib/push';
import { toast } from '../../stores/toast';

/** S-006 알림 권한 안내 (PRD 6.6) — 결과와 상관없이 S-010 */
export default function OnboardingNotifications() {
  const router = useRouter();
  const { nickname } = useLocalSearchParams<{ nickname?: string }>();
  const finish = () => {
    router.replace('/home');
    toast(`가입을 환영해요, ${nickname ?? ''}님!`);
  };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopBar />
      <Screen
        footer={
          <>
            <Button
              testID="push-allow"
              label="알림 받기"
              onPress={() =>
                void requestPushPermission()
                  .then(() => registerDevice())
                  .finally(finish)
              }
            />
            <Button testID="push-later" kind="ghost" label="나중에" onPress={finish} />
          </>
        }
      >
        <Progress step={3} total={3} />
        <T variant="title">접수 오픈, 놓치지 않게 알려드릴게요</T>
        <SampleNotifications />
      </Screen>
    </>
  );
}
