import { importPKCS8, SignJWT } from 'jose';
import type { SocialConfig } from '../../config/env.js';

/**
 * 소셜 연결 해제 provider 호출 (tech/03 8장). 워커는 이 인터페이스만 쓴다 — 테스트는 가짜를 넣는다.
 * 결과는 세 가지로 나눈다:
 * - done: 해제됨, 또는 이미 연결이 없음(다시 시도할 필요 없음)
 * - transient: 네트워크·5xx·429·우리 설정 문제(키 없음·잘못됨) → 백오프 재시도
 * - permanent: 다시 해도 소용없음 (토큰 없음 등) → 바로 최종 실패
 * reason에는 HTTP 상태·provider 오류 코드만 담는다. 식별자·토큰 원문은 절대 넣지 않는다.
 */
export type UnlinkOutcome =
  | { kind: 'done'; note?: string }
  | { kind: 'transient'; reason: string }
  | { kind: 'permanent'; reason: string };

export type UnlinkClient = {
  kakaoUnlink(providerUid: string): Promise<UnlinkOutcome>;
  appleRevoke(refreshToken: string): Promise<UnlinkOutcome>;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 10_000;

async function call(fetchImpl: FetchLike, url: string, init: RequestInit) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { networkError: (err as Error).name || 'network_error' } as const;
  }
}

async function errorCode(res: Response): Promise<string | number | undefined> {
  try {
    const body = (await res.json()) as { code?: number; error?: string };
    return body.code ?? body.error;
  } catch {
    return undefined;
  }
}

/** 카카오 연결 끊기 — 어드민 키 + 회원번호 (POST /v1/user/unlink) */
export function kakaoUnlinkCall(
  adminKey: string | undefined,
  fetchImpl: FetchLike,
): UnlinkClient['kakaoUnlink'] {
  return async (providerUid) => {
    if (!adminKey) return { kind: 'transient', reason: 'kakao_admin_key_missing' };
    const res = await call(fetchImpl, 'https://kapi.kakao.com/v1/user/unlink', {
      method: 'POST',
      headers: {
        authorization: `KakaoAK ${adminKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ target_id_type: 'user_id', target_id: providerUid }),
    });
    if ('networkError' in res) return { kind: 'transient', reason: `network:${res.networkError}` };
    if (res.ok) return { kind: 'done' };
    const code = await errorCode(res);
    // -101: 이 앱에 연결되지 않은 사용자 (이미 해제됨) → 할 일 없음
    if (code === -101) return { kind: 'done', note: 'already_unlinked' };
    if (res.status >= 500 || res.status === 429) {
      return { kind: 'transient', reason: `kakao_http_${res.status}` };
    }
    // -401(어드민 키)·-2(파라미터) 등은 우리 쪽 설정 문제일 수 있어 재시도로 둔다 (24시간 안에 고칠 수 있게)
    if (code === -401 || res.status === 401)
      return { kind: 'transient', reason: `kakao_auth_${code ?? res.status}` };
    return { kind: 'permanent', reason: `kakao_${res.status}_${code ?? 'unknown'}` };
  };
}

/** Apple 토큰 revoke (POST /auth/revoke, refresh token) */
export function appleRevokeCall(
  cfg: SocialConfig['apple'],
  fetchImpl: FetchLike,
): UnlinkClient['appleRevoke'] {
  return async (refreshToken) => {
    if (!cfg) return { kind: 'transient', reason: 'apple_config_missing' };
    const key = await importPKCS8(cfg.privateKey, 'ES256');
    const clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(cfg.teamId)
      .setSubject(cfg.clientId)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    const res = await call(fetchImpl, 'https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });
    if ('networkError' in res) return { kind: 'transient', reason: `network:${res.networkError}` };
    if (res.ok) return { kind: 'done' };
    const code = await errorCode(res);
    // invalid_grant: 토큰이 이미 무효(사용자가 직접 해제 등) → 할 일 없음
    if (code === 'invalid_grant') return { kind: 'done', note: 'token_already_invalid' };
    if (res.status >= 500 || res.status === 429) {
      return { kind: 'transient', reason: `apple_http_${res.status}` };
    }
    if (code === 'invalid_client') return { kind: 'transient', reason: 'apple_invalid_client' };
    return { kind: 'permanent', reason: `apple_${res.status}_${code ?? 'unknown'}` };
  };
}

export function httpUnlinkClient(
  cfg: { kakaoAdminKey: string | undefined; apple: SocialConfig['apple'] },
  fetchImpl: FetchLike = fetch,
): UnlinkClient {
  return {
    kakaoUnlink: kakaoUnlinkCall(cfg.kakaoAdminKey, fetchImpl),
    appleRevoke: appleRevokeCall(cfg.apple, fetchImpl),
  };
}

/** 호출하지 않고 성공으로 처리 (로컬·개발 기본값, UNLINK_DRY_RUN) */
export const dryRunUnlinkClient: UnlinkClient = {
  kakaoUnlink: () => Promise.resolve({ kind: 'done', note: 'dry_run' }),
  appleRevoke: () => Promise.resolve({ kind: 'done', note: 'dry_run' }),
};
