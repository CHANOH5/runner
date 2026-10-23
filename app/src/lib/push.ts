import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { APP_VERSION } from './device';

/**
 * 푸시 권한·토큰 (S-006, PUT /me/device). 실제 발송 확인은 Development Build + 실기기에서 한다 (T-019).
 * Expo push token은 EAS projectId가 있어야 받을 수 있다 — 아직 EAS 프로젝트가 없으면 토큰 null로 등록한다.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export async function getPushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

export async function requestPushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

async function expoPushToken(): Promise<string | null> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** PUT /me/device 본문. 웹은 등록하지 않는다 (null) */
export async function deviceRegistration() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  const pushPermission = await getPushPermission();
  return {
    pushToken: pushPermission === 'granted' ? await expoPushToken() : null,
    pushPermission,
    appVersion: APP_VERSION,
    platform: Platform.OS,
  };
}
