import * as Crypto from 'expo-crypto';
import { APP_VERSION, PLATFORM } from './device';
import { createAnalytics } from './analytics';

// process.env.EXPO_PUBLIC_*는 번들 시 값으로 바뀐다 (그대로 써야 한다). 실제 키는 커밋하지 않는다
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST as string | undefined;

/** 로그인 전 익명 id — 앱 실행마다 새로 (기기 id·광고 id를 쓰지 않는다) */
const anonymousId = Crypto.randomUUID();

/** 앱 전역 분석 인스턴스. 키가 없으면 no-op */
export const analytics = createAnalytics({
  apiKey: POSTHOG_KEY,
  host: POSTHOG_HOST,
  fetch: (input, init) => fetch(input, init),
  context: () => ({ app_version: APP_VERSION, platform: PLATFORM }),
  anonymousId: () => anonymousId,
});
