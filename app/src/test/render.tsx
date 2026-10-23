import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

/** 화면 렌더 테스트: 매번 새 QueryClient (재시도 없음) */
export function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper });
}

/** 테스트용 API 모듈 대체: jest.mock('../../api', () => mockApiModule()) */
export function mockApiModule() {
  return {
    api: new Proxy({} as Record<string, jest.Mock>, {
      get(target, key: string) {
        target[key] ??= jest.fn(() => new Promise(() => undefined));
        return target[key];
      },
    }),
    apiClient: { refresh: jest.fn() },
    tokenStore: { hasRefreshToken: jest.fn(), save: jest.fn(), clear: jest.fn() },
    queryClient: { clear: jest.fn() },
    clearLocalSession: jest.fn(() => Promise.resolve()),
  };
}
