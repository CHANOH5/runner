import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuditLogs, adminUsers } from '../src/db/schema/index.js';
import { totpCode } from '../src/modules/admin/totp.js';
import {
  BOOTSTRAP_ACTION,
  BootstrapError,
  createFirstOwner,
} from '../src/modules/admin/bootstrap-owner.js';
import { adminLoginFlow, createAdminAccount } from './admin-fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => truncateAll(ctx.db));

const PASSWORD = 'first-owner-test-password';

describe('운영 첫 owner 만들기 (T-029)', () => {
  it('owner를 만들고 감사 로그를 남기며, 받은 TOTP로 실제 로그인된다', async () => {
    const res = await createFirstOwner(ctx.db, ctx.app.cipher!, {
      email: 'Owner@Example.com',
      password: PASSWORD,
    });
    expect(res.admin.email).toBe('owner@example.com');
    expect(res.totpUri).toContain('otpauth://totp/');

    const [row] = await ctx.db.select().from(adminUsers).where(eq(adminUsers.id, res.admin.id));
    expect(row).toMatchObject({ role: 'owner', disabledAt: null });
    expect(row!.passwordHash).not.toContain(PASSWORD);
    expect(row!.totpSecretEnc.toString('utf8')).not.toContain(res.totpSecret);

    const logs = await ctx.db.select().from(adminAuditLogs);
    expect(logs).toEqual([
      expect.objectContaining({
        adminId: res.admin.id,
        action: BOOTSTRAP_ACTION,
        targetType: 'admin',
        targetId: res.admin.id,
      }),
    ]);

    const session = await adminLoginFlow(ctx, 'owner@example.com', res.totpSecret, PASSWORD);
    expect(session.csrf).toBeTruthy();
    expect(totpCode(res.totpSecret, new Date())).toMatch(/^\d{6}$/);
  });

  it('활성 owner가 있으면 거부, 비활성 owner만 있으면 허용, 같은 이메일은 거부', async () => {
    const { admin } = await createAdminAccount(ctx, 'owner', 'existing@example.com');
    await expect(
      createFirstOwner(ctx.db, ctx.app.cipher!, { email: 'new@example.com', password: PASSWORD }),
    ).rejects.toThrow(BootstrapError);

    await ctx.db
      .update(adminUsers)
      .set({ disabledAt: new Date() })
      .where(eq(adminUsers.id, admin.id));
    await expect(
      createFirstOwner(ctx.db, ctx.app.cipher!, {
        email: 'existing@example.com',
        password: PASSWORD,
      }),
    ).rejects.toThrow(/같은 이메일/);
    const ok = await createFirstOwner(ctx.db, ctx.app.cipher!, {
      email: 'new@example.com',
      password: PASSWORD,
    });
    expect(ok.admin.email).toBe('new@example.com');
  });

  it('동시에 두 번 실행해도 owner는 하나만 생긴다', async () => {
    const results = await Promise.allSettled([
      createFirstOwner(ctx.db, ctx.app.cipher!, { email: 'a@example.com', password: PASSWORD }),
      createFirstOwner(ctx.db, ctx.app.cipher!, { email: 'b@example.com', password: PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ctx.db.$count(adminUsers)).toBe(1);
  });

  it('입력 검증: 짧은 비밀번호·이메일 형식', async () => {
    for (const input of [
      { email: 'a@example.com', password: 'short' },
      { email: 'not-an-email', password: PASSWORD },
    ]) {
      await expect(createFirstOwner(ctx.db, ctx.app.cipher!, input)).rejects.toThrow(
        BootstrapError,
      );
    }
    expect(await ctx.db.$count(adminUsers)).toBe(0);
  });
});
