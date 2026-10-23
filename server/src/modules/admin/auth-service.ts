import type { AdminRole } from '@berun/shared';
import { hash, verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Db } from '../../db/client.js';
import { adminUsers } from '../../db/schema/index.js';
import type { TokenCipher } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import {
  consumeMfaChallenge,
  createAdminSession,
  createMfaChallenge,
  failMfaChallenge,
  readMfaChallenge,
} from './session.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

/** 비밀번호 5회 실패 시 15분 잠금 (PRD 8.2) */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;

type AdminRow = typeof adminUsers.$inferSelect;
export type AdminAuthDeps = { db: Db; redis: Redis; cipher: TokenCipher | null };

const invalid = () => new AppError('UNAUTHENTICATED', 'invalid email or password');

function requireCipher(cipher: TokenCipher | null): TokenCipher {
  if (!cipher) throw new AppError('INTERNAL', 'TOKEN_ENC_KEY is not configured');
  return cipher;
}

/** argon2id (tech/04 admin_users.password_hash) */
export const hashPassword = (password: string) => hash(password);

/** 1단계: 이메일·비밀번호 → 2단계 인증 토큰. 없는 계정·비활성·틀린 비밀번호는 같은 401 */
export async function adminLogin(
  deps: AdminAuthDeps,
  email: string,
  password: string,
  now = new Date(),
) {
  const [admin] = await deps.db
    .select()
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = lower(${email})`);
  if (!admin || admin.disabledAt) throw invalid();
  if (admin.lockedUntil && admin.lockedUntil > now) {
    throw new AppError('RATE_LIMITED', 'account locked', {
      details: { lockedUntil: toKstIso(admin.lockedUntil) },
    });
  }
  if (!(await verify(admin.passwordHash, password))) {
    const failed = admin.failedLoginCount + 1;
    await deps.db
      .update(adminUsers)
      .set(
        failed >= MAX_FAILED_LOGINS
          ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) }
          : { failedLoginCount: failed },
      )
      .where(eq(adminUsers.id, admin.id));
    throw invalid();
  }
  await deps.db
    .update(adminUsers)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(adminUsers.id, admin.id));
  return { mfaRequired: true as const, mfaToken: await createMfaChallenge(deps.redis, admin.id) };
}

/** 2단계: TOTP → 세션 */
export async function adminVerifyMfa(
  deps: AdminAuthDeps,
  mfaToken: string,
  code: string,
  now = new Date(),
) {
  const challenge = await readMfaChallenge(deps.redis, mfaToken);
  if (!challenge) throw new AppError('UNAUTHENTICATED', 'mfa token expired');
  const [admin] = await deps.db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, challenge.adminId));
  if (!admin || admin.disabledAt) throw new AppError('UNAUTHENTICATED', 'mfa token expired');
  const secret = requireCipher(deps.cipher).decrypt(admin.totpSecretEnc);
  if (!verifyTotp(secret, code, now)) {
    await failMfaChallenge(deps.redis, mfaToken);
    throw new AppError('UNAUTHENTICATED', 'invalid totp');
  }
  await consumeMfaChallenge(deps.redis, mfaToken);
  const { token, session } = await createAdminSession(
    deps.redis,
    { adminId: admin.id, role: admin.role as AdminRole },
    now.getTime(),
  );
  return { token, admin: toMe(admin), csrfToken: session.csrfToken };
}

export const toMe = (a: AdminRow) => ({ id: a.id, email: a.email, role: a.role as AdminRole });
export const toAccount = (a: AdminRow) => ({
  ...toMe(a),
  disabled: a.disabledAt !== null,
  lockedUntil: toKstIsoOrNull(a.lockedUntil),
});

/** 관리자 계정 생성 (owner만). TOTP 비밀키를 만들어 암호화 저장하고 등록 URI는 이번 응답에만 */
export async function createAdmin(
  deps: AdminAuthDeps,
  v: { email: string; role: AdminRole; password: string },
) {
  const secret = generateTotpSecret();
  try {
    const [admin] = await deps.db
      .insert(adminUsers)
      .values({
        email: v.email.toLowerCase(),
        role: v.role,
        passwordHash: await hashPassword(v.password),
        totpSecretEnc: requireCipher(deps.cipher).encrypt(secret),
      })
      .returning();
    return { admin: toAccount(admin!), totpUri: totpUri(admin!.email, secret) };
  } catch (err) {
    const e = (err as { cause?: { code?: string } }).cause;
    if (e?.code === '23505') {
      throw new AppError('VALIDATION_FAILED', 'email already exists', {
        fieldErrors: [{ path: 'email', code: 'taken' }],
      });
    }
    throw err;
  }
}

/** 역할 변경·비활성화. 자기 자신 비활성화·마지막 owner 강등은 막는다 */
export async function patchAdmin(
  db: Db,
  actorId: string,
  id: string,
  v: { role?: AdminRole | undefined; disabled?: boolean | undefined },
  now = new Date(),
) {
  const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!target) throw new AppError('NOT_FOUND', 'admin not found');
  const losingOwner =
    target.role === 'owner' && ((v.role && v.role !== 'owner') || v.disabled === true);
  if (id === actorId && v.disabled) {
    throw new AppError('VALIDATION_FAILED', 'cannot disable yourself', {
      fieldErrors: [{ path: 'disabled', code: 'self' }],
    });
  }
  if (losingOwner) {
    const owners = await db.$count(
      adminUsers,
      sql`${adminUsers.role} = 'owner' AND ${adminUsers.disabledAt} IS NULL`,
    );
    if (owners <= 1) {
      throw new AppError('VALIDATION_FAILED', 'last owner', {
        fieldErrors: [{ path: v.role ? 'role' : 'disabled', code: 'last_owner' }],
      });
    }
  }
  const [updated] = await db
    .update(adminUsers)
    .set({
      ...(v.role && { role: v.role }),
      ...(v.disabled !== undefined && { disabledAt: v.disabled ? now : null }),
    })
    .where(eq(adminUsers.id, id))
    .returning();
  return toAccount(updated!);
}
