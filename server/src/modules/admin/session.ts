import type { AdminRole } from '@berun/shared';
import type { Redis } from 'ioredis';
import { randomToken, sha256 } from '../../lib/crypto.js';

/**
 * 관리자 세션 (tech/06 2.3): Redis 서버 세션 + httpOnly 쿠키. 8시간 절대 만료, 30분 무활동 만료 (PRD 8.2).
 * 2단계 인증 대기 토큰은 5분, 시도 5회.
 */
export const ADMIN_COOKIE = 'berun_admin_session';
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const MFA_TTL_SEC = 5 * 60;
export const MFA_MAX_ATTEMPTS = 5;

export type AdminSession = {
  adminId: string;
  role: AdminRole;
  csrfToken: string;
  createdAt: number;
};

const sessKey = (token: string) => `admin:sess:${sha256(token).toString('hex')}`;
const mfaKey = (token: string) => `admin:mfa:${sha256(token).toString('hex')}`;

export async function createAdminSession(
  redis: Redis,
  v: { adminId: string; role: AdminRole },
  now: number,
) {
  const token = randomToken();
  const session: AdminSession = { ...v, csrfToken: randomToken(), createdAt: now };
  await redis.set(sessKey(token), JSON.stringify(session), 'PX', SESSION_IDLE_MS);
  return { token, session };
}

/** 세션을 읽고 무활동 만료를 연장한다. 절대 만료가 지났으면 삭제 후 null */
export async function touchAdminSession(redis: Redis, token: string, now: number) {
  const raw = await redis.get(sessKey(token));
  if (!raw) return null;
  const session = JSON.parse(raw) as AdminSession;
  const left = session.createdAt + SESSION_ABSOLUTE_MS - now;
  if (left <= 0) {
    await redis.del(sessKey(token));
    return null;
  }
  await redis.pexpire(sessKey(token), Math.min(SESSION_IDLE_MS, left));
  return session;
}

export async function destroyAdminSession(redis: Redis, token: string) {
  await redis.del(sessKey(token));
}

export async function createMfaChallenge(redis: Redis, adminId: string) {
  const token = randomToken();
  await redis.set(mfaKey(token), JSON.stringify({ adminId, attempts: 0 }), 'EX', MFA_TTL_SEC);
  return token;
}

export async function readMfaChallenge(redis: Redis, token: string) {
  const raw = await redis.get(mfaKey(token));
  return raw ? (JSON.parse(raw) as { adminId: string; attempts: number }) : null;
}

/** 실패 1회 기록. 한도를 넘으면 토큰 폐기 */
export async function failMfaChallenge(redis: Redis, token: string) {
  const c = await readMfaChallenge(redis, token);
  if (!c) return;
  if (c.attempts + 1 >= MFA_MAX_ATTEMPTS) {
    await redis.del(mfaKey(token));
  } else {
    await redis.set(mfaKey(token), JSON.stringify({ ...c, attempts: c.attempts + 1 }), 'KEEPTTL');
  }
}

export async function consumeMfaChallenge(redis: Redis, token: string) {
  await redis.del(mfaKey(token));
}
