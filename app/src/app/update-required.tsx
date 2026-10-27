import { Linking, Platform, View } from 'react-native';
import { Button, T } from '../components/ui';
import { useTheme } from '../theme';

/** 강제 업데이트 (PRD 6.1) — 닫을 수 없다. 스토어 주소는 출시 시 확정 [미정] */
const STORE_URL =
  Platform.OS === 'ios' ? 'https://apps.apple.com' : 'https://play.google.com/store';

export default function UpdateRequired() {
  const c = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 24 }}
    >
      <T variant="title">새 버전이 필요해요</T>
      <T muted>더 안정적인 서비스를 위해 최신 버전으로 업데이트해주세요.</T>
      <Button label="업데이트" onPress={() => void Linking.openURL(STORE_URL)} />
    </View>
  );
}
