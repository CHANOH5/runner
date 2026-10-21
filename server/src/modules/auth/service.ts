import {
  MIN_SIGNUP_AGE,
  Nickname,
  type FieldError,
  type SignupReq,
  type SignupRes,
  type SocialLoginReq,
  type SocialLoginRes,
} from '@berun/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '../../db/client.js';
import {
  authIdentities,
  notificationSettings,
  privacySettings,
  userConsents,
  userProfiles,
  users,
} from '../../db/schema/index.js';
import type { TokenCipher } from '../../lib/crypto.js';
import { AppError, validationFailed } from '../../lib/errors.js';
import { kstDate, toKstIso } from '../../lib/time.js';
import { buildMe } from '../users/me.js';
import { currentTerms, pendingRequiredTerms } from '../users/terms.js';
import { isForbiddenNickname } from './forbidden-words.js';
import {
  createSignupSession,
  deleteSignupSession,
  getSignupSession,
  SIGNUP_TTL_SEC,
  type SignupSession,
} from './signup-session.js';
import type { DeviceInfo, TokenIssuer } from './tokens.js';
import { cancelPendingUnlinks, runUnlinkNow, scheduleSignupUnlink } from './unlink-jobs.js';
import type { SocialVerifiers } from './verifiers.js';

export type AuthDeps = {
  db: Db;
  redis: Redis;
  tokens: TokenIssuer;
  verifiers: SocialVerifiers;
  cipher: TokenCipher | null;
};

/** PostgreSQL unique 위반 (constraint 이름으로 구분) */
function uniqueViolation(err: unknown, constraint: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505' &&
    (e as { constraint_name?: string }).constraint_name === constraint
  );
}

/** POST /auth/social (tech/06 6.2, PRD 4.1) */
export async function socialLogin(
  deps: AuthDeps,
  req: SocialLoginReq,
  device: DeviceInfo,
  now = new Date(),
): Promise<SocialLoginRes> {
  const verifier = deps.verifiers[req.provider];
  if (!verifier) throw new AppError('INTERNAL', `${req.provider} login is not configured`);
  const identity = await verifier.verify(req);

  if (identity.appleRefreshToken && !deps.cipher) {
    throw new AppError('INTERNAL', 'TOKEN_ENC_KEY is not configured');
  }
  const revokeTokenEnc =
    identity.appleRefreshToken && deps.cipher
      ? deps.cipher.encrypt(identity.appleRefreshToken)
      : null;

  const [existing] = await deps.db
    .select({ identityId: authIdentities.id, userId: users.id, status: users.status })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, identity.provider),
        eq(authIdentities.providerUid, identity.providerUid),
      ),
    );

  if (existing) {
    if (existing.status === 'suspended') {
      throw new AppError('ACCOUNT_SUSPENDED', 'account is suspended');
    }
    const tokens = await deps.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ lastLoginAt: now, ...(existing.status === 'dormant' && { status: 'active' }) })
        .where(eq(users.id, existing.userId));
      if (revokeTokenEnc) {
        await tx
          .update(authIdentities)
          .set({ revokeTokenEnc })
          .where(eq(authIdentities.id, existing.identityId));
      }
      return deps.tokens.createSession(tx, existing.userId, device, now);
    });
    const pending = await pendingRequiredTerms(deps.db, existing.userId, now);
    return {
      result: 'logged_in',
      tokens,
      pendingTerms: pending.map((t) => t.kind),
      reactivated: existing.status === 'dormant',
    };
  }

  // 신규: users 행을 만들지 않고 가입 세션만 (만 14세 미만 정보 미보관)
  const unlinkJobId = await scheduleSignupUnlink(
    deps.db,
    { provider: identity.provider, providerUid: identity.providerUid, revokeTokenEnc },
    now,
  );
  const signupToken = await createSignupSession(deps.redis, {
    provider: identity.provider,
    providerUid: identity.providerUid,
    email: identity.email,
    revokeTokenEnc: revokeTokenEnc?.toString('base64') ?? null,
    unlinkJobId,
  });
  return {
    result: 'signup_required',
    signupToken,
    signupTokenExpiresAt: toKstIso(new Date(now.getTime() + SIGNUP_TTL_SEC * 1000)),
    emailProvided: identity.email !== null,
  };
}

/** 가입 토큰 확인 → 세션. 없으면 401 SIGNUP_TOKEN_EXPIRED */
export async function requireSignupSession(redis: Redis, token: string): Promise<SignupSession> {
  const session = await getSignupSession(redis, token);
  if (!session) throw new AppError('SIGNUP_TOKEN_EXPIRED', 'signup token expired or invalid');
  return session;
}

/** POST /auth/signup/abort, 만 14세 미만 — 가입 세션 삭제 + 소셜 연결 해제 즉시 실행 */
export async function abortSignup(deps: Pick<AuthDeps, 'db' | 'redis'>, token: string) {
  const session = await getSignupSession(deps.redis, token);
  await deleteSignupSession(deps.redis, token);
  if (session) await runUnlinkNow(deps.db, session.unlinkJobId);
}

/** 만 14세 판정 (PRD 4.3, P-ACC-01). 연도만 받으므로 차이 14일 때 생일 경과 여부를 묻는다 */
export function judgeAge(
  birthYear: number,
  birthdayPassedThisYear: boolean | undefined,
  now: Date,
): 'ok' | 'underage' | 'needs_birthday' | 'future' {
  const thisYear = Number(kstDate(now).slice(0, 4));
  const diff = thisYear - birthYear;
  if (diff < 0) return 'future';
  if (diff > MIN_SIGNUP_AGE) return 'ok';
  if (diff < MIN_SIGNUP_AGE) return 'underage';
  if (birthdayPassedThisYear === undefined) return 'needs_birthday';
  return birthdayPassedThisYear ? 'ok' : 'underage';
}

/** POST /auth/signup — 약관 동의 + 프로필 → 한 트랜잭션 계정 생성 → 토큰 (tech/03 8장) */
export async function signup(
  deps: AuthDeps,
  signupToken: string,
  req: SignupReq,
  device: DeviceInfo,
  now = new Date(),
): Promise<SignupRes> {
  const session = await requireSignupSession(deps.redis, signupToken);
  const { profile } = req;

  // 1) 나이 — 미만이면 아무것도 저장하지 않고 중단 처리
  const age = judgeAge(profile.birthYear, profile.birthdayPassedThisYear, now);
  if (age === 'future') {
    throw validationFailed([{ path: 'profile.birthYear', code: 'out_of_range' }]);
  }
  if (age === 'needs_birthday') {
    throw validationFailed([{ path: 'profile.birthdayPassedThisYear', code: 'required' }]);
  }
  if (age === 'underage') {
    await abortSignup(deps, signupToken);
    throw new AppError('UNDERAGE', 'user is under the minimum age');
  }

  // 2) 약관: 현재 버전만, 필수 2개 포함
  const terms = await currentTerms(deps.db, now);
  const byId = new Map(terms.map((t) => [t.id, t]));
  const fieldErrors: FieldError[] = [];
  req.agreedTermIds.forEach((id, i) => {
    if (!byId.has(id)) fieldErrors.push({ path: `agreedTermIds[${i}]`, code: 'invalid_value' });
  });
  const agreed = new Set(req.agreedTermIds);
  if (terms.some((t) => t.required && !agreed.has(t.id))) {
    fieldErrors.push({ path: 'agreedTermIds', code: 'missing_required' });
  }
  // 3) 러닝 시작 연도: 출생연도 + 5 ~ 올해
  const thisYear = Number(kstDate(now).slice(0, 4));
  if (
    profile.runningSince !== null &&
    (profile.runningSince < profile.birthYear + 5 || profile.runningSince > thisYear)
  ) {
    fieldErrors.push({ path: 'profile.runningSince', code: 'out_of_range' });
  }
  if (fieldErrors.length) throw validationFailed(fieldErrors);

  // 4) 닉네임 (저장 직전 다시 확인, 선점은 unique 위반으로도 잡는다)
  if (isForbiddenNickname(profile.nickname)) {
    throw new AppError('NICKNAME_FORBIDDEN', 'nickname contains a forbidden word');
  }
  if (await nicknameTaken(deps.db, profile.nickname)) {
    throw new AppError('NICKNAME_TAKEN', 'nickname is already taken');
  }

  const marketing = terms.find((t) => t.kind === 'marketing' && agreed.has(t.id));
  let created: { userId: string; tokens: SignupRes['tokens'] };
  try {
    created = await deps.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: session.email, birthYear: profile.birthYear, lastLoginAt: now })
        .returning({ id: users.id });
      const userId = user!.id;
      await tx.insert(authIdentities).values({
        userId,
        provider: session.provider,
        providerUid: session.providerUid,
        revokeTokenEnc: session.revokeTokenEnc
          ? Buffer.from(session.revokeTokenEnc, 'base64')
          : null,
      });
      await tx.insert(userProfiles).values({
        userId,
        nickname: profile.nickname,
        regionCode: profile.regionCode,
        gender: profile.gender,
        runningSince: profile.runningSince,
      });
      await tx.insert(privacySettings).values({ userId });
      await tx.insert(notificationSettings).values({ userId, marketing: Boolean(marketing) });
      // 동의 이력: 체크한 항목만 agree 1행씩 (PRD 4.2)
      await tx
        .insert(userConsents)
        .values([...agreed].map((termsVersionId) => ({ userId, termsVersionId, action: 'agree' })));
      await cancelPendingUnlinks(tx, session.provider, session.providerUid);
      const tokens = await deps.tokens.createSession(tx, userId, device, now);
      return { userId, tokens };
    });
  } catch (err) {
    if (uniqueViolation(err, 'user_profiles_nickname_lower_key')) {
      throw new AppError('NICKNAME_TAKEN', 'nickname is already taken');
    }
    if (uniqueViolation(err, 'auth_identities_provider_uid_key')) {
      // 같은 소셜 계정으로 다른 가입이 먼저 끝남 → 처음부터(로그인) 다시
      await deleteSignupSession(deps.redis, signupToken);
      throw new AppError('SIGNUP_TOKEN_EXPIRED', 'identity already registered');
    }
    throw err;
  }
  await deleteSignupSession(deps.redis, signupToken);

  return {
    tokens: created.tokens,
    user: await buildMe(deps.db, created.userId, now),
    marketingAgreedAt: marketing ? toKstIso(now) : null,
  };
}

/** 대소문자 무시 중복 (lower(nickname) 유니크와 같은 기준) */
export async function nicknameTaken(db: Db, nickname: string, exceptUserId?: string) {
  const [row] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        sql`lower(${userProfiles.nickname}) = lower(${nickname})`,
        exceptUserId ? ne(userProfiles.userId, exceptUserId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** GET /nicknames/availability */
export async function nicknameAvailability(
  db: Db,
  raw: string,
  exceptUserId?: string,
): Promise<'available' | 'taken' | 'forbidden' | 'invalid_format'> {
  const parsed = Nickname.safeParse(raw);
  if (!parsed.success) return 'invalid_format';
  if (isForbiddenNickname(parsed.data)) return 'forbidden';
  if (await nicknameTaken(db, parsed.data, exceptUserId)) return 'taken';
  return 'available';
}
