import { SignupRes, SocialLoginRes } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { authIdentities } from '../src/db/schema/index.js';
import { verifiersFromConfig } from '../src/modules/auth/verifiers.js';
import { errorOf, seedTerms } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

/** 개발 전용 로그인 (T-025, tech/03 8장) */

const BASE_ENV = {
  DATABASE_URL: 'postgres://berun:berun@localhost:55432/berun',
  REDIS_URL: 'redis://localhost:56379',
};
const NO_SOCIAL = { kakao: null, google: null, apple: null };
/** 운영은 KMS 데이터 키가 필수 (T-029). 값은 형식만 맞춘 가짜 */
const PROD_KEY = {
  TOKEN_ENC_KEY_KMS_CIPHERTEXT: Buffer.from('fake-ciphertext').toString('base64'),
};

describe('DEV_LOGIN 설정', () => {
  it('기본은 꺼짐, development에서 true면 켜짐', () => {
    expect(loadConfig({ ...BASE_ENV, NODE_ENV: 'development' }).devLogin).toBe(false);
    expect(loadConfig({ ...BASE_ENV, NODE_ENV: 'development', DEV_LOGIN: 'true' }).devLogin).toBe(
      true,
    );
  });

  it('production에서 켜면 설정 검증 실패', () => {
    expect(() =>
      loadConfig({ ...BASE_ENV, ...PROD_KEY, NODE_ENV: 'production', DEV_LOGIN: 'true' }),
    ).toThrow(ConfigError);
    expect(
      loadConfig({ ...BASE_ENV, ...PROD_KEY, NODE_ENV: 'production', DEV_LOGIN: 'false' }).devLogin,
    ).toBe(false);
  });

  it('설정을 직접 만들어도 production + devLogin이면 verifier를 만들지 않는다', () => {
    expect(() => verifiersFromConfig(NO_SOCIAL, { env: 'production', devLogin: true })).toThrow();
    expect(verifiersFromConfig(NO_SOCIAL, { env: 'production', devLogin: false })).toEqual({});
  });
});

describe('POST /v1/auth/social — 개발 전용 로그인 켜짐', () => {
  let ctx: TestContext;
  let terms: Awaited<ReturnType<typeof seedTerms>>;
  beforeAll(async () => {
    ctx = await createTestContext({ configVerifiers: true, devLogin: true });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await truncateAll(ctx.db);
    terms = await seedTerms(ctx);
  });

  const social = (body: object) =>
    ctx.app.inject({ method: 'POST', url: '/v1/auth/social', payload: body });

  it('dev:{이름} → 가입 토큰 → 가입 → 같은 이름으로 다시 로그인하면 logged_in', async () => {
    const first = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'dev:alice' })).json(),
    );
    expect(first.result).toBe('signup_required');
    if (first.result !== 'signup_required') return;

    const signup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: { authorization: `Bearer ${first.signupToken}` },
      payload: {
        agreedTermIds: [terms.service.id, terms.privacy.id],
        profile: {
          nickname: '개발러너',
          birthYear: 1990,
          regionCode: 'seoul',
          gender: null,
          runningSince: null,
        },
      },
    });
    expect(signup.statusCode).toBe(201);
    const { user } = SignupRes.parse(signup.json());
    const [identity] = await ctx.db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(identity).toMatchObject({ provider: 'kakao', providerUid: 'dev:alice' });

    const again = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'dev:alice' })).json(),
    );
    expect(again.result).toBe('logged_in');
  });

  it('Google·Apple 자리에서도 같은 형식으로 동작한다', async () => {
    const google = SocialLoginRes.parse(
      (await social({ provider: 'google', idToken: 'dev:bob' })).json(),
    );
    expect(google.result).toBe('signup_required');
    const apple = SocialLoginRes.parse(
      (
        await social({ provider: 'apple', identityToken: 'dev:carol', authorizationCode: 'x' })
      ).json(),
    );
    expect(apple.result).toBe('signup_required');
  });

  it('이름 형식이 틀리거나 dev 토큰이 아니면 401 SOCIAL_TOKEN_INVALID (실제 키 없음)', async () => {
    for (const accessToken of ['dev:', 'dev:한글', `dev:${'a'.repeat(41)}`, 'real-token']) {
      const res = await social({ provider: 'kakao', accessToken });
      expect(res.statusCode).toBe(401);
      expect(errorOf(res).code).toBe('SOCIAL_TOKEN_INVALID');
    }
  });
});

describe('POST /v1/auth/social — 개발 전용 로그인 꺼짐 (기본)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ configVerifiers: true });
  });
  afterAll(() => ctx.close());

  it('dev 토큰을 받지 않는다 (provider 미설정 → 500)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/social',
      payload: { provider: 'kakao', accessToken: 'dev:alice' },
    });
    expect(res.statusCode).toBe(500);
    expect(errorOf(res).code).toBe('INTERNAL');
  });
});
