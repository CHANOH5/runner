import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { api } from '../api';
import { Button, T } from '../components/ui';
import { useTheme } from '../theme';

/** 정지 계정 안내 (PRD 4.1). 고객센터 이메일은 원격 설정 (Q-12 미정이면 표시 안 함) */
export default function Suspended() {
  const router = useRouter();
  const c = useTheme();
  const cfg = useQuery({ queryKey: ['app-config'], queryFn: api.appConfig });
  const email = cfg.data?.supportEmail;
  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 24 }}
    >
      <T variant="title">이용이 제한된 계정이에요.{email ? ` 문의: ${email}` : ''}</T>
      <Button kind="secondary" label="확인" onPress={() => router.replace('/login')} />
    </View>
  );
}
