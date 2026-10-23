import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, T } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { useSession } from '../stores/session';
import { useTheme } from '../theme';

/** 점검 중 (503 MAINTENANCE, app-config maintenance.active) */
export default function Maintenance() {
  const router = useRouter();
  const c = useTheme();
  const gate = useSession((s) => s.gate);
  const setGate = useSession((s) => s.setGate);
  const until = gate?.kind === 'maintenance' ? gate.until : null;
  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 16 }}
    >
      <T variant="title">잠시 문제가 생겼어요</T>
      <T muted>{until ? `${formatDateTime(until)}까지 점검 중이에요.` : '서비스 점검 중이에요.'}</T>
      <Button
        kind="secondary"
        label="다시 시도"
        onPress={() => {
          setGate(null);
          router.replace('/');
        }}
      />
    </View>
  );
}
