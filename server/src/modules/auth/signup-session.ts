import type { Provider } from '@berun/shared';
import type { Redis } from 'ioredis';
import { randomToken, sha256 } from '../../lib/crypto.js';

/**
 * 가입 세션 (tech/06 2.1, tech/03 8장). Redis `signup:{sha256(token)}`, 30분.
 * 만 14세 미만 개인정보를 남기지 않기 위해 가입 완료 전에는 DB에 users 행을 만들지 않는다.
 */
export const SIGNUP_TTL_SEC = 30 * 60;

export type SignupSession = {
  provider: Provider;
  providerUid: string;
  email: string | null;
  /** Apple refresh token 암호문 (base64) */
  revokeTokenEnc: string | null;
  /** 가입이 끝나지 않으면 실행될 소셜 연결 해제 작업 (social_unlink_jobs.id) */
  unlinkJobId: number | null;
};

const keyOf = (token: string) => `signup:${sha256(token).toString('hex')}`;

export async function createSignupSession(redis: Redis, session: SignupSession) {
  const token = randomToken();
  await redis.set(keyOf(token), JSON.stringify(session), 'EX', SIGNUP_TTL_SEC);
  return token;
}

export async function getSignupSession(redis: Redis, token: string): Promise<SignupSession | null> {
  const raw = await redis.get(keyOf(token));
  return raw ? (JSON.parse(raw) as SignupSession) : null;
}

export async function deleteSignupSession(redis: Redis, token: string) {
  await redis.del(keyOf(token));
}
