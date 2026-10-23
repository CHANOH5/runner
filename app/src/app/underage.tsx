import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, T } from '../components/ui';
import { useTheme } from '../theme';

/** 가입 중단 (만 14세 미만, PRD 4.3) — 서버에는 아무 정보도 남기지 않는다 */
export default function Underage() {
  const router = useRouter();
  const c = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 24 }}
    >
      <T variant="title">BeRun은 만 14세 이상부터 이용할 수 있어요.</T>
      <Button label="확인" onPress={() => router.replace('/login')} />
    </View>
  );
}
