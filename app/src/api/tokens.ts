import type { TokenPair } from '@berun/shared';
import { secureStore } from '../lib/secureStore';
import type { StoredAccess, TokenStore } from './client';

const REFRESH_KEY = 'refreshToken';

/**
 * access token은 메모리에만, refresh token은 SecureStore에 둔다 (tech/06 2.1).
 * 웹(로컬 확인용)은 secureStore.web.ts가 localStorage로 대체한다.
 */
export function createTokenStore(
  store = secureStore,
): TokenStore & { hasRefreshToken(): Promise<boolean> } {
  let access: StoredAccess | null = null;
  return {
    getAccess: () => access,
    getRefreshToken: () => store.get(REFRESH_KEY),
    async hasRefreshToken() {
      return (await store.get(REFRESH_KEY)) !== null;
    },
    async save(pair: TokenPair) {
      access = {
        token: pair.accessToken,
        expiresAt: new Date(pair.accessTokenExpiresAt).getTime(),
      };
      await store.set(REFRESH_KEY, pair.refreshToken);
    },
    async clear() {
      access = null;
      await store.remove(REFRESH_KEY);
    },
  };
}
