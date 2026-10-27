import { AdminCreateReq } from '@berun/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { adminAuditLogs, adminUsers } from '../../db/schema/index.js';
import type { TokenCipher } from '../../lib/crypto.js';
import { hashPassword } from './auth-service.js';
import { generateTotpSecret, totpUri } from './totp.js';

export class BootstrapError extends Error {
  override name = 'BootstrapError';
}

/** 감사 로그 action — 관리자 웹이 아니라 CLI로 만든 계정임을 구분한다 */
export const BOOTSTRAP_ACTION = 'cli:create-first-owner';

/**
 * 운영 첫 owner 만들기 (T-029, tech/07). 활성 owner가 이미 있으면 거부한다 — 이후 계정은 관리자 웹(POST /admins)에서.
 * 같은 트랜잭션에서 감사 로그를 남긴다 (admin_id = 새 owner, 실행 주체가 CLI라는 것은 action으로 구분).
 * 반환하는 TOTP 비밀키·URI는 호출한 CLI가 화면에 한 번만 보여주고 어디에도 저장하지 않는다.
 */
export async function createFirstOwner(
  db: Db,
  cipher: TokenCipher,
  input: { email: string; password: string },
) {
  const parsed = AdminCreateReq.safeParse({ ...input, role: 'owner' });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new BootstrapError(`입력값 오류: ${fields} (비밀번호 12자 이상)`);
  }
  const email = parsed.data.email.toLowerCase();
  const secret = generateTotpSecret();
  const passwordHash = await hashPassword(parsed.data.password);

  const admin = await db.transaction(async (tx) => {
    // 두 사람이 동시에 실행해도 owner가 하나만 생기게
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('berun:create-first-owner'))`);
    const [existing] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, 'owner'), isNull(adminUsers.disabledAt)))
      .limit(1);
    if (existing) {
      throw new BootstrapError('활성 owner가 이미 있다. 추가 관리자는 관리자 웹에서 만든다');
    }
    const [taken] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email));
    if (taken) throw new BootstrapError('같은 이메일의 관리자 계정이 이미 있다');

    const [row] = await tx
      .insert(adminUsers)
      .values({ email, role: 'owner', passwordHash, totpSecretEnc: cipher.encrypt(secret) })
      .returning({ id: adminUsers.id, email: adminUsers.email });
    await tx.insert(adminAuditLogs).values({
      adminId: row!.id,
      action: BOOTSTRAP_ACTION,
      targetType: 'admin',
      targetId: row!.id,
      memo: 'owner',
    });
    return row!;
  });
  return { admin, totpSecret: secret, totpUri: totpUri(admin.email, secret) };
}
