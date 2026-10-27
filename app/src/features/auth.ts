import type { SocialLoginRes, TokenPair } from '@berun/shared';
import { router } from 'expo-router';
import { api, clearLocalSession, tokenStore } from '../api';
import { kv } from '../lib/kv';
import { deviceRegistration } from '../lib/push';
import { analytics } from '../lib/analyticsClient';
import { userIdFromAccessToken } from '../lib/analytics';
import { useSession } from '../stores/session';

/** 만 14세 미만 가입 중단 후 24시간 재시도 차단 (기기 플래그만, PRD 4.3) */
const UNDERAGE_KEY = 'device.underageBlockedUntil';
export const UNDERAGE_BLOCK_MS = 24 * 60 * 60 * 1000;

export const setUnderageBlock = (now = Date.now()) => kv.set(UNDERAGE_KEY, now + UNDERAGE_BLOCK_MS);
export async function isUnderageBlocked(now = Date.now()) {
  return (await kv.get<number>(UNDERAGE_KEY, 0)) > now;
}

/** 현재 기기 푸시 토큰·버전 등록 (앱 시작·로그인, tech/06 6.3). 실패해도 흐름을 막지 않는다 */
export async function registerDevice() {
  try {
    const body = await deviceRegistration();
    if (body) await api.putDevice(body);
  } catch {
    // 다음 앱 시작 때 다시 시도
  }
}

export async function startSession(tokens: TokenPair) {
  await tokenStore.save(tokens);
  // 분석 식별은 내부 user_id만 (D-017)
  const userId = userIdFromAccessToken(tokens.accessToken);
  if (userId) analytics.identify(userId);
  useSession.getState().setStatus('signedIn');
  void registerDevice();
}

/** POST /auth/social 결과 처리 → 다음 화면 (PRD 4.1, 6.1) */
export async function handleLoginResult(
  res: SocialLoginRes,
  meta: { provider?: 'kakao' | 'apple' | 'google'; startedAt?: number } = {},
) {
  const session = useSession.getState();
  if (res.result === 'signup_required') {
    if (await isUnderageBlocked()) {
      await api.signupAbort(res.signupToken).catch(() => undefined);
      router.replace('/underage');
      return;
    }
    session.setSignup({
      token: res.signupToken,
      expiresAt: res.signupTokenExpiresAt,
      agreedTermIds: [],
      marketing: false,
      ...meta,
    });
    router.push('/terms');
    return;
  }
  await startSession(res.tokens);
  session.setReactivated(res.reactivated);
  if (res.pendingTerms.length > 0) router.replace('/reconsent');
  else if (res.reactivated) router.replace('/reactivated');
  else router.replace('/home');
}

/** 로그아웃 (S-063): 서버 세션 폐기 → 로컬 정리 → S-002 */
export async function logout() {
  await api.logout().catch(() => undefined);
  await clearLocalSession();
  useSession.getState().setStatus('signedOut');
  router.replace('/login');
}
