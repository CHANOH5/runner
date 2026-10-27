import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { kv } from './kv';

/** 앱 버전 (X-App-Version, 최소 버전 비교). 네이티브는 스토어 버전, 웹은 app.json 버전 */
export const APP_VERSION =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

/** X-Platform. 웹(로컬 확인용)은 'web' — 서버는 ios·android만 버전 검사한다 */
export const PLATFORM: 'ios' | 'android' | 'web' =
  Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

let cachedDeviceId: string | null = null;

/** X-Device-Id: 설치 시 한 번 만들어 보관하는 UUID (tech/06 1장) */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await kv.get<string | null>('device.id', null);
  if (!id) {
    id = Crypto.randomUUID();
    await kv.set('device.id', id);
  }
  cachedDeviceId = id;
  return id;
}

export const newIdempotencyKey = () => Crypto.randomUUID();

/** "1.2.10" < "1.10.0" 같은 숫자 비교 (서버 app-version 플러그인과 같은 규칙). 형식이 다르면 null */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+(\.\d+){0,2}$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
