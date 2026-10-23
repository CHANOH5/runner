import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../api';
import { isApiError } from '../api/client';
import { errorMessage } from '../api/messages';
import { Button, Card, Field, Input, Segmented, T } from '../components/ui';
import { handleLoginResult } from '../features/auth';
import { toast } from '../stores/toast';
import { useTheme } from '../theme';

type Provider = 'kakao' | 'apple' | 'google';

/** 개발 전용 로그인 표시 여부: 개발 번들(__DEV__)에서만. 서버도 DEV_LOGIN=true일 때만 받는다 */
const DEV_LOGIN_ENABLED = __DEV__;

const PROVIDER_LABEL: Record<Provider, string> = {
  kakao: '카카오로 계속하기',
  apple: 'Apple로 계속하기',
  google: 'Google로 계속하기',
};

/** S-002 로그인 (PRD 6.2, 4.1) */
export default function Login() {
  const router = useRouter();
  const c = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [devName, setDevName] = useState('runner1');
  const [devProvider, setDevProvider] = useState<Provider>('kakao');

  // iOS: 카카오 → Apple → Google / Android(·웹): 카카오 → Google (D-016)
  const providers: Provider[] =
    Platform.OS === 'ios' ? ['kakao', 'apple', 'google'] : ['kakao', 'google'];

  const login = async (key: string, run: () => ReturnType<typeof api.socialLogin>) => {
    setBusy(key);
    try {
      await handleLoginResult(await run());
    } catch (e) {
      if (isApiError(e) && e.code === 'ACCOUNT_SUSPENDED') router.push('/suspended');
      else
        toast(
          isApiError(e) && e.code === 'NETWORK'
            ? errorMessage(e)
            : '로그인하지 못했어요. 다시 시도해주세요',
        );
    } finally {
      setBusy(null);
    }
  };

  const devToken = `dev:${devName.trim()}`;
  const devBody = (): Parameters<typeof api.socialLogin>[0] =>
    devProvider === 'kakao'
      ? { provider: 'kakao', accessToken: devToken }
      : devProvider === 'google'
        ? { provider: 'google', idToken: devToken }
        : { provider: 'apple', identityToken: devToken, authorizationCode: 'dev' };

  return (
    <View
      style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 28 }}
    >
      <View style={{ gap: 10 }}>
        <T variant="display" color={c.primary}>
          BeRun
        </T>
        <T variant="h2">대회를 찾고, 목표를 세우고, 함께 달려요</T>
      </View>

      <View style={{ gap: 10 }}>
        {providers.map((p) => (
          <Button
            key={p}
            testID={`login-${p}`}
            kind="secondary"
            label={PROVIDER_LABEL[p]}
            disabled={busy !== null}
            loading={busy === p}
            // 소셜 SDK 연동은 provider 키 발급 후 (tech/03 8장)
            onPress={() => toast('소셜 로그인은 provider 키 발급 후 연결돼요')}
          />
        ))}
      </View>

      {DEV_LOGIN_ENABLED ? (
        <Card tone="outline" testID="dev-login">
          <T variant="bodyStrong">개발 전용 로그인</T>
          <T variant="caption" muted>
            로컬 서버가 DEV_LOGIN=true일 때만 동작해요. 같은 이름이면 같은 계정이에요.
          </T>
          <Segmented<Provider>
            options={[
              { value: 'kakao', label: '카카오' },
              { value: 'google', label: 'Google' },
              { value: 'apple', label: 'Apple' },
            ]}
            value={devProvider}
            onChange={setDevProvider}
          />
          <Field hint="영문·숫자·_·- 1~40자">
            <Input
              testID="dev-login-name"
              value={devName}
              onChangeText={setDevName}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
            />
          </Field>
          <Button
            testID="dev-login-submit"
            label="개발 계정으로 로그인"
            disabled={busy !== null || !/^[A-Za-z0-9_-]{1,40}$/.test(devName.trim())}
            loading={busy === 'dev'}
            onPress={() => void login('dev', () => api.socialLogin(devBody()))}
          />
        </Card>
      ) : null}
    </View>
  );
}
