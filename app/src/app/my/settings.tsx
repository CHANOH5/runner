import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Linking, Platform, Pressable } from 'react-native';
import { api } from '../../api';
import { Screen, T } from '../../components/ui';
import { useConfirm } from '../../components/useConfirm';
import { logout } from '../../features/auth';
import { APP_VERSION } from '../../lib/device';
import { toast } from '../../stores/toast';
import { useTheme } from '../../theme';

function Item({
  label,
  onPress,
  color,
  testID,
}: {
  label: string;
  onPress?: () => void;
  color?: string;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.border }}
    >
      <T color={color}>{label}</T>
    </Pressable>
  );
}

/** S-063 설정 (PRD 6.21) */
export default function Settings() {
  const router = useRouter();
  const c = useTheme();
  const [dialog, confirm] = useConfirm();
  const cfg = useQuery({ queryKey: ['app-config'], queryFn: api.appConfig });

  // 문의하기: 메일 앱 (사용자 이메일은 넣지 않는다). 고객센터 주소는 원격 설정 (Q-12 미정)
  const contact = () => {
    const email = cfg.data?.supportEmail;
    if (!email) return toast('고객센터 주소가 아직 정해지지 않았어요');
    const body = encodeURIComponent(
      `\n\n---\n앱 버전: ${APP_VERSION}\nOS: ${Platform.OS} ${String(Platform.Version)}`,
    );
    void Linking.openURL(
      `mailto:${email}?subject=${encodeURIComponent('[BeRun 문의]')}&body=${body}`,
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: '설정' }} />
      <Screen padded={false}>
        <Item label="알림 설정" onPress={() => router.push('/my/notification-settings')} />
        <Item label="개인정보·약관" onPress={() => router.push('/my/privacy')} />
        <Item label="문의하기" onPress={contact} />
        <Item label="오픈소스 라이선스" onPress={() => toast('출시 전에 라이선스 목록을 넣어요')} />
        <Item label={`앱 버전 ${APP_VERSION}`} />
        <Item
          testID="logout"
          label="로그아웃"
          onPress={() =>
            void confirm({ message: '로그아웃할까요?', confirmLabel: '로그아웃' }).then((ok) => {
              if (ok) void logout();
            })
          }
        />
        <Item
          testID="delete-account"
          label="회원 탈퇴"
          color={c.subtext}
          onPress={() => router.push('/my/delete-account')}
        />
      </Screen>
      {dialog}
    </>
  );
}
