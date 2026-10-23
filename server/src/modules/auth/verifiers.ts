import type { Provider, SocialLoginReq } from '@berun/shared';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { SocialConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * 소셜 provider 토큰 검증 (tech/03 8장). provider마다 하나씩, 테스트는 가짜 구현을 주입한다.
 * 아래 실제 구현은 각 provider 문서 기준으로 작성했고, 실제 키로는 아직 검증하지 않았다 (키 발급 후 확인).
 */
export type VerifiedIdentity = {
  provider: Provider;
  providerUid: string;
  /** provider가 준 (검증된) 이메일. 없으면 null */
  email: string | null;
  /** Apple만: authorizationCode를 바로 교환한 refresh token (탈퇴·가입 중단 시 revoke용) */
  appleRefreshToken?: string;
};

export type SocialVerifier = {
  verify(req: SocialLoginReq): Promise<VerifiedIdentity>;
};

export type SocialVerifiers = Partial<Record<Provider, SocialVerifier>>;

export const socialTokenInvalid = (message = 'social token verification failed') =>
  new AppError('SOCIAL_TOKEN_INVALID', message);

const TIMEOUT_MS = 5000;

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw socialTokenInvalid(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

/** 카카오: access token 정보로 앱 id를 확인한 뒤 사용자 정보를 읽는다 */
export function kakaoVerifier(cfg: { appId: string }): SocialVerifier {
  const TokenInfo = z.object({ id: z.number(), app_id: z.number() });
  const UserMe = z.object({
    id: z.number(),
    kakao_account: z
      .object({
        email: z.string().optional(),
        is_email_valid: z.boolean().optional(),
        is_email_verified: z.boolean().optional(),
      })
      .optional(),
  });
  return {
    async verify(req) {
      if (req.provider !== 'kakao') throw socialTokenInvalid();
      const headers = { authorization: `Bearer ${req.accessToken}` };
      const info = TokenInfo.safeParse(
        await getJson('https://kapi.kakao.com/v1/user/access_token_info', { headers }),
      );
      if (!info.success || String(info.data.app_id) !== cfg.appId) throw socialTokenInvalid();
      const me = UserMe.safeParse(await getJson('https://kapi.kakao.com/v2/user/me', { headers }));
      if (!me.success || me.data.id !== info.data.id) throw socialTokenInvalid();
      const acc = me.data.kakao_account;
      return {
        provider: 'kakao',
        providerUid: String(me.data.id),
        email: acc?.email && acc.is_email_valid && acc.is_email_verified ? acc.email : null,
      };
    },
  };
}

/** Google: ID 토큰 서명·발급자·audience 검증 */
export function googleVerifier(cfg: { clientIds: string[] }): SocialVerifier {
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    async verify(req) {
      if (req.provider !== 'google') throw socialTokenInvalid();
      try {
        const { payload } = await jwtVerify(req.idToken, jwks, {
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          audience: cfg.clientIds,
        });
        if (!payload.sub) throw socialTokenInvalid();
        const email =
          typeof payload.email === 'string' && payload.email_verified === true
            ? payload.email
            : null;
        return { provider: 'google', providerUid: payload.sub, email };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw socialTokenInvalid();
      }
    },
  };
}

/** Apple: identity token 검증 + authorizationCode → refresh token 교환 (iOS만, D-016) */
export function appleVerifier(cfg: NonNullable<SocialConfig['apple']>): SocialVerifier {
  const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  const TokenRes = z.object({ refresh_token: z.string() });

  async function clientSecret() {
    const key = await importPKCS8(cfg.privateKey, 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(cfg.teamId)
      .setSubject(cfg.clientId)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }

  return {
    async verify(req) {
      if (req.provider !== 'apple') throw socialTokenInvalid();
      let sub: string;
      let email: string | null;
      try {
        const { payload } = await jwtVerify(req.identityToken, jwks, {
          issuer: 'https://appleid.apple.com',
          audience: cfg.clientId,
        });
        if (!payload.sub) throw socialTokenInvalid();
        sub = payload.sub;
        email = typeof payload.email === 'string' ? payload.email : null;
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw socialTokenInvalid();
      }
      // 인가 코드는 수명이 짧아 즉시 교환한다 (tech/03 8장)
      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: await clientSecret(),
        code: req.authorizationCode,
        grant_type: 'authorization_code',
      });
      const token = TokenRes.safeParse(
        await getJson('https://appleid.apple.com/auth/token', { method: 'POST', body }),
      );
      if (!token.success) throw socialTokenInvalid('apple code exchange failed');
      return {
        provider: 'apple',
        providerUid: sub,
        email,
        appleRefreshToken: token.data.refresh_token,
      };
    },
  };
}

/** 개발 전용 로그인 토큰 접두 (T-025). `dev:{이름}` → providerUid `dev:{이름}` */
export const DEV_TOKEN_PREFIX = 'dev:';
const DEV_NAME = /^[A-Za-z0-9_-]{1,40}$/;

const tokenOf = (req: SocialLoginReq) =>
  req.provider === 'kakao'
    ? req.accessToken
    : req.provider === 'apple'
      ? req.identityToken
      : req.idToken;

/**
 * 개발 전용 verifier: `dev:{이름}` 토큰은 provider를 호출하지 않고 통과시키고, 그 밖의 토큰은 실제 verifier에 넘긴다
 * (실제 verifier가 없으면 검증 실패). 소셜 키가 없는 로컬에서 앱 화면을 확인하기 위한 것 (tech/03 8장)
 */
export function devLoginVerifier(provider: Provider, real?: SocialVerifier): SocialVerifier {
  return {
    async verify(req) {
      if (req.provider !== provider) throw socialTokenInvalid();
      const token = tokenOf(req);
      if (token.startsWith(DEV_TOKEN_PREFIX)) {
        const name = token.slice(DEV_TOKEN_PREFIX.length);
        if (!DEV_NAME.test(name)) throw socialTokenInvalid('invalid dev login name');
        return { provider, providerUid: `${DEV_TOKEN_PREFIX}${name}`, email: null };
      }
      if (!real) throw socialTokenInvalid(`${provider} login is not configured`);
      return real.verify(req);
    },
  };
}

export function verifiersFromConfig(
  social: SocialConfig,
  opts: { env: 'development' | 'test' | 'production'; devLogin: boolean } = {
    env: 'production',
    devLogin: false,
  },
): SocialVerifiers {
  const real: SocialVerifiers = {
    ...(social.kakao && { kakao: kakaoVerifier(social.kakao) }),
    ...(social.google && { google: googleVerifier(social.google) }),
    ...(social.apple && { apple: appleVerifier(social.apple) }),
  };
  if (!opts.devLogin) return real;
  // loadConfig도 막지만, 설정을 직접 만든 경우까지 한 번 더 막는다
  if (opts.env === 'production') throw new Error('dev login must not be enabled in production');
  return {
    kakao: devLoginVerifier('kakao', real.kakao),
    google: devLoginVerifier('google', real.google),
    apple: devLoginVerifier('apple', real.apple),
  };
}
