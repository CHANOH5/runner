import type { AdminRole } from '@berun/shared';
import { adminUsers } from '../src/db/schema/index.js';
import { hashPassword } from '../src/modules/admin/auth-service.js';
import { generateTotpSecret, totpCode } from '../src/modules/admin/totp.js';
import type { TestContext } from './helpers.js';

export const PASSWORD = 'test-admin-password';

export async function createAdminAccount(
  ctx: TestContext,
  role: AdminRole,
  email = `${role}@example.com`,
) {
  const secret = generateTotpSecret();
  const [admin] = await ctx.db
    .insert(adminUsers)
    .values({
      email,
      role,
      passwordHash: await hashPassword(PASSWORD),
      totpSecretEnc: ctx.app.cipher!.encrypt(secret),
    })
    .returning();
  return { admin: admin!, secret };
}

export type AdminSession = { cookie: string; csrf: string; id: string };

export async function adminLoginFlow(
  ctx: TestContext,
  email: string,
  secret: string,
): Promise<AdminSession> {
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/admin/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  const { mfaToken } = login.json<{ mfaToken: string }>();
  const mfa = await ctx.app.inject({
    method: 'POST',
    url: '/api/admin/v1/auth/mfa',
    payload: { mfaToken, totp: totpCode(secret, new Date()) },
  });
  if (mfa.statusCode !== 200) throw new Error(`mfa failed ${mfa.body}`);
  const setCookie = String(mfa.headers['set-cookie']);
  const body = mfa.json<{ csrfToken: string; admin: { id: string } }>();
  return { cookie: setCookie.split(';')[0]!, csrf: body.csrfToken, id: body.admin.id };
}

export async function loginAs(ctx: TestContext, role: AdminRole, email?: string) {
  const { admin, secret } = await createAdminAccount(ctx, role, email);
  return { ...(await adminLoginFlow(ctx, admin.email, secret)), secret, admin };
}

export function adminCall(
  ctx: TestContext,
  s: AdminSession | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: {
      ...(s && { cookie: s.cookie, 'x-csrf-token': s.csrf }),
      ...headers,
    },
    ...(payload !== undefined && { payload: payload as object }),
  });
}
