import { AdminAppConfig, AppConfig } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adminAuditLogs, appConfigs } from '../src/db/schema/index.js';
import { adminCall, loginAs } from './admin-fixtures.js';
import { errorOf } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => truncateAll(ctx.db));

const appConfig = async () =>
  AppConfig.parse((await ctx.app.inject({ method: 'GET', url: '/v1/app-config' })).json());

describe('privacyPolicyUrl (PRD v1.11 4.2)', () => {
  it('GET /app-config: 값이 없으면 null, 있으면 그 주소, 형식이 틀린 저장값은 null', async () => {
    expect((await appConfig()).privacyPolicyUrl).toBeNull();

    await ctx.db
      .insert(appConfigs)
      .values({ key: 'privacy_policy_url', value: 'https://example.com/privacy' });
    expect((await appConfig()).privacyPolicyUrl).toBe('https://example.com/privacy');

    await ctx.db
      .update(appConfigs)
      .set({ value: 'not a url' })
      .where(eq(appConfigs.key, 'privacy_policy_url'));
    expect((await appConfig()).privacyPolicyUrl).toBeNull();
  });
});

describe('관리자 원격 설정 GET /app-configs, PUT /app-configs/{key} (tech/06 7.7)', () => {
  it('owner가 privacy_policy_url을 넣고 지우면 앱 설정에 바로 반영되고 감사 로그가 남는다', async () => {
    const owner = await loginAs(ctx, 'owner');
    const put = await adminCall(ctx, owner, 'PUT', '/app-configs/privacy_policy_url', {
      value: 'https://example.com/privacy/v1',
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(AdminAppConfig.parse(put.json())).toMatchObject({
      key: 'privacy_policy_url',
      value: 'https://example.com/privacy/v1',
    });
    expect((await appConfig()).privacyPolicyUrl).toBe('https://example.com/privacy/v1');

    // 다시 넣으면 덮어쓴다, null이면 "값 없음"
    await adminCall(ctx, owner, 'PUT', '/app-configs/privacy_policy_url', {
      value: 'https://example.com/privacy/v2',
    });
    expect((await appConfig()).privacyPolicyUrl).toBe('https://example.com/privacy/v2');
    const cleared = await adminCall(ctx, owner, 'PUT', '/app-configs/privacy_policy_url', {
      value: null,
    });
    expect(cleared.statusCode).toBe(200);
    expect((await appConfig()).privacyPolicyUrl).toBeNull();

    const list = z
      .array(AdminAppConfig)
      .parse((await adminCall(ctx, owner, 'GET', '/app-configs')).json());
    expect(list).toEqual([expect.objectContaining({ key: 'privacy_policy_url', value: null })]);

    const logs = await ctx.db
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.targetType, 'app_config'));
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      action: 'PUT /api/admin/v1/app-configs/:key',
      targetId: 'privacy_policy_url',
    });
  });

  it('키별 형식 검사: 허용하지 않는 키·잘못된 값은 400', async () => {
    const owner = await loginAs(ctx, 'owner');
    const bad = [
      ['/app-configs/unknown_key', { value: 'x' }, 'key'],
      ['/app-configs/privacy_policy_url', { value: 'ftp://example.com/p' }, 'value'],
      ['/app-configs/privacy_policy_url', { value: 'example.com/privacy' }, 'value'],
      ['/app-configs/min_native_version_ios', { value: '1.2' }, 'value'],
      ['/app-configs/maintenance', { value: { active: 'yes' } }, 'value'],
      ['/app-configs/support_email', { value: 'nope' }, 'value'],
    ] as const;
    for (const [url, body, path] of bad) {
      const res = await adminCall(ctx, owner, 'PUT', url, body);
      expect(res.statusCode, url).toBe(400);
      expect(errorOf(res).fieldErrors?.[0]?.path, url).toBe(path);
    }
    const ok = await adminCall(ctx, owner, 'PUT', '/app-configs/maintenance', {
      value: { active: true, until: '2026-11-01T06:00:00+09:00' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await appConfig()).maintenance).toEqual({
      active: true,
      until: '2026-11-01T06:00:00+09:00',
    });
  });

  it('PUT은 owner만, GET은 viewer까지. CSRF 없으면 403', async () => {
    const operator = await loginAs(ctx, 'operator', 'op@example.com');
    const viewer = await loginAs(ctx, 'viewer', 'viewer@example.com');
    const owner = await loginAs(ctx, 'owner', 'owner@example.com');
    const body = { value: 'https://example.com/privacy' };
    for (const s of [operator, viewer]) {
      const res = await adminCall(ctx, s, 'PUT', '/app-configs/privacy_policy_url', body);
      expect(res.statusCode).toBe(403);
    }
    expect((await adminCall(ctx, viewer, 'GET', '/app-configs')).statusCode).toBe(200);
    const noCsrf = await adminCall(
      ctx,
      { ...owner, csrf: '' },
      'PUT',
      '/app-configs/privacy_policy_url',
      body,
    );
    expect(noCsrf.statusCode).toBe(403);
    expect((await adminCall(ctx, null, 'GET', '/app-configs')).statusCode).toBe(401);
  });
});
