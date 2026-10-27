/**
 * 웹 대체 구현 (로컬 확인용 Expo 웹 전용). 브라우저에는 Keychain이 없어 localStorage에 둔다.
 * 운영 앱은 네이티브(SecureStore)만 배포하므로 이 파일은 개발 확인에만 쓰인다.
 */
const PREFIX = 'berun.secure.';

export const secureStore = {
  get: (key: string) => Promise.resolve(globalThis.localStorage?.getItem(PREFIX + key) ?? null),
  set: (key: string, value: string) => {
    globalThis.localStorage?.setItem(PREFIX + key, value);
    return Promise.resolve();
  },
  remove: (key: string) => {
    globalThis.localStorage?.removeItem(PREFIX + key);
    return Promise.resolve();
  },
};
