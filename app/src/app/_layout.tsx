import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient, tokenStore } from '../api';
import { ToastHost } from '../components/ui';
import { useSession } from '../stores/session';
import { palettes } from '../theme';

/** 로그인 없이 열 수 있는 화면 (스플래시·로그인·가입·게이트) */
const PUBLIC_ROUTES = new Set([
  '',
  'index',
  'login',
  'terms',
  'profile-setup',
  'underage',
  'suspended',
  'update-required',
  'maintenance',
]);

/** 강제 업데이트·재동의·점검 게이트, 인증 만료 → 로그인 (PRD 3.4, 6.1) */
function useGuards() {
  const router = useRouter();
  const segments = useSegments();
  const status = useSession((s) => s.status);
  const gate = useSession((s) => s.gate);
  const first = segments[0] ?? '';

  useEffect(() => {
    if (!gate) return;
    if (gate.kind === 'upgrade' && first !== 'update-required') router.replace('/update-required');
    if (gate.kind === 'maintenance' && first !== 'maintenance') router.replace('/maintenance');
    if (gate.kind === 'terms' && first !== 'reconsent') router.replace('/reconsent');
  }, [gate, first, router]);

  useEffect(() => {
    if (status === 'signedOut' && !PUBLIC_ROUTES.has(first)) router.replace('/login');
    // 스플래시를 거치지 않고 화면이 바로 열린 경우(웹 새로고침·딥링크): 저장된 토큰으로 판단
    if (status === 'booting' && !PUBLIC_ROUTES.has(first)) {
      void tokenStore
        .hasRefreshToken()
        .then((has) => useSession.getState().setStatus(has ? 'signedIn' : 'signedOut'));
    }
  }, [status, first, router]);
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? palettes.dark : palettes.light;
  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          value={{ ...navTheme, colors: { ...navTheme.colors, background: c.bg, card: c.bg } }}
        >
          <Guards />
          <Stack
            screenOptions={{
              headerBackTitle: '뒤로',
              headerTintColor: c.text,
              headerStyle: { backgroundColor: c.bg },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: c.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="update-required"
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="maintenance"
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="reconsent"
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="reactivated"
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen name="underage" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="suspended" options={{ headerShown: false }} />
          </Stack>
          <ToastHost />
          <StatusBar style="auto" />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Guards() {
  useGuards();
  return null;
}
