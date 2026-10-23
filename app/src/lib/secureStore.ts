import * as SecureStore from 'expo-secure-store';

/** 민감값(refresh token) 저장 — iOS Keychain / Android Keystore (tech/06 2.1) */
export const secureStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
