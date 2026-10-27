import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 기기 저장소 (민감하지 않은 값): 기기 id, 복귀 질문 제한, 필터·보기 설정, 최근 검색어 등.
 * 웹에서는 AsyncStorage가 localStorage를 쓴다.
 */
export const kv = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
  /** 로그아웃·탈퇴 시 사용자 데이터 정리. 기기 id는 남긴다 */
  async clearUserData(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('user.')));
  },
};
