import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { APP_VERSION, getDeviceId, PLATFORM } from '../lib/device';
import { kv } from '../lib/kv';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { ApiError, createApiClient } from './client';
import { createEndpoints } from './endpoints';
import { createTokenStore } from './tokens';

/**
 * API 기본 주소
 * - EXPO_PUBLIC_API_BASE_URL이 있으면 그 값 (Development Build·실기기: 예 http://192.168.0.10:3000/v1)
 * - 웹(로컬 확인): 같은 출처 /v1 → Metro 개발 서버가 localhost:3000으로 넘긴다 (metro.config.js)
 * - 그 외: http://localhost:3000/v1 (iOS 시뮬레이터)
 */
// process.env.EXPO_PUBLIC_*는 번들 시 값으로 바뀐다 (그대로 써야 한다)
const ENV_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined;

export const API_BASE_URL =
  ENV_API_BASE_URL ??
  (Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'http://localhost:3000/v1');

export const tokenStore = createTokenStore();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // 네트워크·서버 오류만 재시도 (4xx는 바로 화면에 표시)
      retry: (count, err) =>
        err instanceof ApiError && (err.status === 0 || err.status >= 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** 로그아웃·탈퇴·인증 만료 공통 정리: 토큰·캐시·사용자 기기 데이터 삭제 */
export async function clearLocalSession() {
  await tokenStore.clear();
  queryClient.clear();
  await kv.clearUserData();
}

export const apiClient = createApiClient({
  baseUrl: API_BASE_URL,
  fetch: (input, init) => fetch(input, init),
  tokens: tokenStore,
  headers: async () => ({
    'x-app-version': APP_VERSION,
    'x-platform': PLATFORM,
    'x-device-id': await getDeviceId(),
  }),
  onAuthLost: () => {
    if (useSession.getState().status !== 'signedIn') return;
    queryClient.clear();
    useSession.getState().setStatus('signedOut');
    toast('다시 로그인해주세요');
  },
  onGate: (gate) => useSession.getState().setGate(gate),
});

export const api = createEndpoints(apiClient);
