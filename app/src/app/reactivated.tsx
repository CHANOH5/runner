import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { api } from '../api';
import { Button, LinkText, T } from '../components/ui';
import { useSession } from '../stores/session';
import { useTheme } from '../theme';

/** 휴면 해제 안내 (PRD 4.1) — 1회. 닫기·뒤로 = [시작하기] */
export default function Reactivated() {
  const router = useRouter();
  const c = useTheme();
  const setReactivated = useSession((s) => s.setReactivated);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const go = (path: '/home' | '/my/notification-settings') => {
    setReactivated(false);
    router.replace('/home');
    if (path !== '/home') router.push(path);
  };
  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 16 }}
    >
      <T variant="title">다시 만나서 반가워요, {me.data?.nickname ?? ''}님</T>
      <T muted>
        1년 넘게 접속하지 않아 휴면 상태였던 계정을 다시 사용할 수 있게 했어요. 기록과 관심 대회는
        그대로 있어요.
      </T>
      <T variant="caption">알림 설정을 확인해주세요</T>
      <LinkText label="알림 설정 보기" onPress={() => go('/my/notification-settings')} />
      <Button label="시작하기" onPress={() => go('/home')} />
    </View>
  );
}
