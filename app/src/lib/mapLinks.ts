import { Linking, Platform } from 'react-native';
import { kv } from './kv';
import { openInAppBrowser } from './external';

/**
 * [길찾기]·[지도 앱에서 검색] — 외부 지도 앱 열기 (PRD 4.7, handoff 20261021-planner-developer-venue-map-admin-input 답변 2번).
 * 서버 호출 없이 URL 스킴으로 연다. 카카오맵 스킴은 [추정]이라 실기기에서 확인해야 한다.
 */

export type MapApp = 'naver' | 'kakao' | 'apple' | 'google';
export type Venue = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export const MAP_APP_LABEL: Record<MapApp, string> = {
  naver: '네이버 지도',
  kakao: '카카오맵',
  apple: 'Apple 지도',
  google: 'Google 지도',
};

const APP_NAME = 'app.berun.dev';

const queryOf = (v: Venue) => v.name ?? v.address ?? '';

export function mapAppUrl(app: MapApp, v: Venue): string {
  const q = encodeURIComponent(queryOf(v));
  const hasPoint = v.lat !== null && v.lng !== null;
  switch (app) {
    case 'naver':
      return hasPoint
        ? `nmap://route/walk?dlat=${v.lat}&dlng=${v.lng}&dname=${q}&appname=${APP_NAME}`
        : `nmap://search?query=${q}&appname=${APP_NAME}`;
    case 'kakao':
      return hasPoint
        ? `kakaomap://route?ep=${v.lat},${v.lng}&by=FOOT`
        : `kakaomap://search?q=${q}`;
    case 'apple':
      return hasPoint
        ? `https://maps.apple.com/?daddr=${v.lat},${v.lng}&dirflg=w`
        : `https://maps.apple.com/?q=${q}`;
    case 'google':
      // 국내 도보 길찾기가 안 될 수 있어 대중교통으로 연다 [추정]
      return hasPoint
        ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}&travelmode=transit`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
}

/** 실패 시 대체: 네이버 지도 웹 검색을 인앱 브라우저로 (좌표 길찾기 웹 URL은 문서화돼 있지 않음) */
export const naverWebSearchUrl = (v: Venue) =>
  `https://map.naver.com/p/search/${encodeURIComponent(queryOf(v))}`;

const LAST_APP_KEY = 'device.lastMapApp';

/** 선택 시트에 보여줄 앱: 설치된 앱만 (Apple·Google 지도는 기본 앱이라 항상), 마지막 선택을 맨 위로 */
export async function availableMapApps(): Promise<MapApp[]> {
  let apps: MapApp[];
  if (Platform.OS === 'web') {
    // 웹 대체: 지도 앱이 없으므로 웹 지도만 (네이버는 웹 검색으로 연다)
    apps = ['naver', 'google'];
  } else {
    const base: MapApp[] = Platform.OS === 'ios' ? ['apple'] : ['google'];
    const optional: MapApp[] = [];
    if (await Linking.canOpenURL('nmap://').catch(() => false)) optional.push('naver');
    if (await Linking.canOpenURL('kakaomap://').catch(() => false)) optional.push('kakao');
    apps = [...optional, ...base];
  }
  const last = await kv.get<MapApp | null>(LAST_APP_KEY, null);
  return last && apps.includes(last) ? [last, ...apps.filter((a) => a !== last)] : apps;
}

export async function openMapApp(app: MapApp, v: Venue): Promise<void> {
  await kv.set(LAST_APP_KEY, app);
  if (Platform.OS === 'web') {
    await openInAppBrowser(app === 'naver' ? naverWebSearchUrl(v) : mapAppUrl(app, v));
    return;
  }
  try {
    await Linking.openURL(mapAppUrl(app, v));
  } catch {
    await openInAppBrowser(naverWebSearchUrl(v));
  }
}
