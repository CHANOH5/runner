import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, apiClient, tokenStore } from '../api';
import { Button, T } from '../components/ui';
import { decideBoot } from '../features/bootstrap';
import { APP_VERSION, PLATFORM } from '../lib/device';
import { useSession } from '../stores/session';
import { useTheme } from '../theme';

/** S-001 스플래시 (PRD 6.1) */
export default function Splash() {
  const router = useRouter();
  const c = useTheme();
  const setStatus = useSession((s) => s.setStatus);
  const setGate = useSession((s) => s.setGate);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    const target = await decideBoot({
      platform: PLATFORM,
      appVersion: APP_VERSION,
      appConfig: api.appConfig,
      hasRefreshToken: () => tokenStore.hasRefreshToken(),
      refresh: apiClient.refresh,
      me: api.me,
    });
    switch (target.to) {
      case 'upgrade':
        setGate({ kind: 'upgrade' });
        return router.replace('/update-required');
      case 'maintenance':
        setGate({ kind: 'maintenance', until: target.until });
        return router.replace('/maintenance');
      case 'login':
        setStatus('signedOut');
        return router.replace('/login');
      case 'reconsent':
        setStatus('signedIn');
        return router.replace('/reconsent');
      case 'home':
        setStatus('signedIn');
        return router.replace('/home');
      case 'error':
        setError(target.message);
    }
  }, [router, setGate, setStatus]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        backgroundColor: c.bg,
      }}
    >
      <T variant="display" color={c.primary}>
        BeRun
      </T>
      {error ? (
        <>
          <T muted>{error}</T>
          <Button small kind="secondary" label="다시 시도" onPress={() => void run()} />
        </>
      ) : null}
    </View>
  );
}
