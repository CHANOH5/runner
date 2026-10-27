import { router, type Href } from 'expo-router';

/** 뒤로 가기. 기록이 없으면(웹에서 주소로 바로 연 경우·딥링크) 대신 fallback으로 */
export function goBack(fallback: Href = '/home') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
