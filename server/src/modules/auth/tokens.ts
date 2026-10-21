import { SignJWT, type CryptoKey } from 'jose';

/** access token 수명 (tech/06 2.1) */
export const ACCESS_TOKEN_TTL = '15m';

/**
 * access token 발급 (JWT, ES256, claims: sub, sid, iat, exp).
 * 지금은 테스트·개발 스크립트만 쓴다. /auth/* 구현 시 같은 함수를 쓴다.
 */
export function signAccessToken(
  privateKey: CryptoKey,
  claims: { userId: string; sessionId: string },
  options: { expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? ACCESS_TOKEN_TTL)
    .sign(privateKey);
}
