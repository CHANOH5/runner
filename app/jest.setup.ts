/* 네이티브 모듈 대체 (테스트 전용) */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    setItemAsync: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-crypto', () => {
  let n = 0;
  return {
    randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
});

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
}));

// expo-router: 화면 렌더 테스트용 대체 (이동은 기록만)
jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  const Stack = Object.assign(({ children }: { children?: unknown }) => children ?? null, {
    Screen: () => null,
  });
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments: () => [],
    Stack,
  };
});
