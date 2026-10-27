import { AppConfig, Me, SignupRes, SocialLoginRes, TermsCurrent, TokenPair } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appConfigs,
  authIdentities,
  authSessions,
  devices,
  notificationSettings,
  privacySettings,
  socialUnlinkJobs,
  userConsents,
  userProfiles,
  users,
} from '../src/db/schema/index.js';
import { kstDate } from '../src/lib/time.js';
import { call, createUser, DAY, errorOf, fromNow, seedTerms } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
let terms: Awaited<ReturnType<typeof seedTerms>>;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  terms = await seedTerms(ctx);
});

const THIS_YEAR = Number(kstDate(new Date()).slice(0, 4));
const DEVICE = '0199f000-0000-7000-8000-00000000d001';

async function social(body: object, headers: Record<string, string> = {}) {
  return ctx.app.inject({ method: 'POST', url: '/v1/auth/social', payload: body, headers });
}

async function signupToken(uid: string, provider: 'kakao' | 'google' | 'apple' = 'kakao') {
  const body =
    provider === 'kakao'
      ? { provider, accessToken: uid }
      : provider === 'google'
        ? { provider, idToken: uid }
        : { provider, identityToken: uid, authorizationCode: 'code' };
  const res = SocialLoginRes.parse((await social(body)).json());
  if (res.result !== 'signup_required') throw new Error('expected signup_required');
  return res.signupToken;
}

const profile = (over: object = {}) => ({
  nickname: '러너',
  birthYear: 1990,
  regionCode: 'seoul',
  gender: null,
  runningSince: 2015,
  ...over,
});

function doSignup(token: string, body: object = {}, headers: Record<string, string> = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    headers: { authorization: `Bearer ${token}`, ...headers },
    payload: {
      agreedTermIds: [terms.service.id, terms.privacy.id],
      profile: profile(),
      ...body,
    },
  });
}

async function signedUp(uid = 'k-1') {
  const res = await doSignup(await signupToken(uid), {}, { 'x-device-id': DEVICE });
  expect(res.statusCode).toBe(201);
  return SignupRes.parse(res.json());
}

const refresh = (refreshToken: string) =>
  ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

describe('POST /v1/auth/social', () => {
  it('신규: users 행 없이 가입 토큰, 30분 뒤 실행될 연결 해제 작업 예약 (카카오)', async () => {
    const res = await social({ provider: 'kakao', accessToken: 'k-new|a@example.com' });
    expect(res.statusCode).toBe(200);
    const body = SocialLoginRes.parse(res.json());
    expect(body).toMatchObject({ result: 'signup_required', emailProvided: true });
    expect(await ctx.db.$count(users)).toBe(0);
    const [job] = await ctx.db.select().from(socialUnlinkJobs);
    expect(job).toMatchObject({ provider: 'kakao', providerUid: 'k-new' });
    expect(job!.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(30 * 60 * 1000);
  });

  it('Google은 연결 해제 작업을 만들지 않는다, 이메일 없으면 emailProvided=false', async () => {
    const body = SocialLoginRes.parse(
      (await social({ provider: 'google', idToken: 'g-1' })).json(),
    );
    expect(body).toMatchObject({ result: 'signup_required', emailProvided: false });
    expect(await ctx.db.$count(socialUnlinkJobs)).toBe(0);
  });

  it('검증 실패 401 SOCIAL_TOKEN_INVALID', async () => {
    const res = await social({ provider: 'kakao', accessToken: 'bad' });
    expect([res.statusCode, errorOf(res).code]).toEqual([401, 'SOCIAL_TOKEN_INVALID']);
  });

  it('기존 회원: 토큰 발급, 정지 계정은 403', async () => {
    const { user } = await signedUp('k-exist');
    const body = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'k-exist' })).json(),
    );
    expect(body).toMatchObject({ result: 'logged_in', pendingTerms: [], reactivated: false });

    // 휴면 → 이번 로그인으로 해제되면 reactivated=true, 다음 로그인은 false (PRD v1.6 4.1)
    await ctx.db.update(users).set({ status: 'dormant' }).where(eq(users.id, user.id));
    const woke = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'k-exist' })).json(),
    );
    expect(woke).toMatchObject({ result: 'logged_in', reactivated: true });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(u!.status).toBe('active');
    const again = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'k-exist' })).json(),
    );
    expect(again).toMatchObject({ reactivated: false });

    await ctx.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    const res = await social({ provider: 'kakao', accessToken: 'k-exist' });
    expect([res.statusCode, errorOf(res).code]).toEqual([403, 'ACCOUNT_SUSPENDED']);
  });
});

describe('POST /v1/auth/signup', () => {
  it('한 트랜잭션으로 계정 생성, 연결 해제 작업 취소, 토큰으로 /me 호출', async () => {
    const token = await signupToken('k-1|me@example.com');
    const res = await doSignup(
      token,
      {
        agreedTermIds: [terms.service.id, terms.privacy.id, terms.marketing.id],
        profile: profile({ gender: 'female' }),
      },
      { 'x-device-id': DEVICE, 'x-platform': 'ios' },
    );
    expect(res.statusCode).toBe(201);
    const body = SignupRes.parse(res.json());
    expect(body.user).toMatchObject({
      nickname: '러너',
      birthYear: 1990,
      regionCode: 'seoul',
      gender: 'female',
      runningSince: 2015,
      provider: 'kakao',
      pendingTerms: [],
      counts: { interested: 0, upcoming: 0, past: 0 },
    });
    expect(body.marketingAgreedAt).toMatch(/\+09:00$/);

    const userId = body.user.id;
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u!.email).toBe('me@example.com');
    expect(await ctx.db.$count(authIdentities)).toBe(1);
    expect(await ctx.db.$count(userProfiles)).toBe(1);
    expect(await ctx.db.$count(privacySettings)).toBe(1);
    const [ns] = await ctx.db.select().from(notificationSettings);
    expect(ns!.marketing).toBe(true);
    expect(await ctx.db.$count(userConsents, eq(userConsents.userId, userId))).toBe(3);
    expect(await ctx.db.$count(socialUnlinkJobs)).toBe(0);
    const [device] = await ctx.db.select().from(devices);
    expect(device).toMatchObject({ id: DEVICE, userId, platform: 'ios' });

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(Me.parse(me.json()).id).toBe(userId);

    // 가입 토큰은 한 번만
    const again = await doSignup(token, { profile: profile({ nickname: '다른러너' }) });
    expect([again.statusCode, errorOf(again).code]).toEqual([401, 'SIGNUP_TOKEN_EXPIRED']);
  });

  it('만 14세 판정: 차이 13 → 422 UNDERAGE + 정보 미보관 + 연결 해제 즉시 예약', async () => {
    const token = await signupToken('k-kid');
    const res = await doSignup(token, { profile: profile({ birthYear: THIS_YEAR - 13 }) });
    expect([res.statusCode, errorOf(res).code]).toEqual([422, 'UNDERAGE']);
    expect(await ctx.db.$count(users)).toBe(0);
    const [job] = await ctx.db.select().from(socialUnlinkJobs);
    expect(job!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
    // 가입 세션도 삭제
    const again = await doSignup(token);
    expect(errorOf(again).code).toBe('SIGNUP_TOKEN_EXPIRED');
  });

  it('차이 14: 생일 질문 없으면 400, 아직이면 422, 지났으면 가입', async () => {
    const token = await signupToken('k-14');
    let res = await doSignup(token, { profile: profile({ birthYear: THIS_YEAR - 14 }) });
    expect(errorOf(res).fieldErrors).toEqual([
      { path: 'profile.birthdayPassedThisYear', code: 'required' },
    ]);
    res = await doSignup(token, {
      profile: profile({
        birthYear: THIS_YEAR - 14,
        birthdayPassedThisYear: true,
        runningSince: null,
      }),
    });
    expect(res.statusCode).toBe(201);

    const token2 = await signupToken('k-14b');
    res = await doSignup(token2, {
      profile: profile({
        nickname: '어린러너',
        birthYear: THIS_YEAR - 14,
        birthdayPassedThisYear: false,
      }),
    });
    expect(errorOf(res).code).toBe('UNDERAGE');
  });

  it('필수 약관 누락·현재 버전이 아닌 약관 → 400', async () => {
    const token = await signupToken('k-terms');
    let res = await doSignup(token, { agreedTermIds: [terms.service.id, terms.marketing.id] });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'agreedTermIds', code: 'missing_required' }]);
    res = await doSignup(token, {
      agreedTermIds: [terms.service.id, terms.privacy.id, terms.nightPush.id],
    });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'agreedTermIds[2]', code: 'invalid_value' }]);
  });

  it('닉네임: 대소문자 무시 중복 409, 예약어 부분 일치 422, 형식 400, 러닝 시작 연도 범위 400', async () => {
    await createUser(ctx, 'Runner');
    const token = await signupToken('k-nick');
    let res = await doSignup(token, { profile: profile({ nickname: 'runner' }) });
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'NICKNAME_TAKEN']);
    res = await doSignup(token, { profile: profile({ nickname: 'BeRun_kim' }) });
    expect([res.statusCode, errorOf(res).code]).toEqual([422, 'NICKNAME_FORBIDDEN']);
    res = await doSignup(token, { profile: profile({ nickname: '러 너' }) });
    expect(errorOf(res).fieldErrors).toEqual([
      { path: 'profile.nickname', code: 'invalid_format' },
    ]);
    res = await doSignup(token, { profile: profile({ runningSince: 1993 }) });
    expect(errorOf(res).fieldErrors).toEqual([
      { path: 'profile.runningSince', code: 'out_of_range' },
    ]);
  });

  it('Apple: refresh token을 암호화해 저장', async () => {
    const res = await doSignup(await signupToken('a-1', 'apple'));
    expect(res.statusCode).toBe(201);
    const [identity] = await ctx.db.select().from(authIdentities);
    expect(identity!.revokeTokenEnc).not.toBeNull();
    expect(identity!.revokeTokenEnc!.toString('utf8')).not.toContain('apple-refresh');
    expect(ctx.app.cipher!.decrypt(identity!.revokeTokenEnc!)).toBe('apple-refresh-a-1');
  });
});

describe('가입 중단·닉네임 확인', () => {
  it('POST /auth/signup/abort → 204, 연결 해제 즉시 예약, 가입 토큰 폐기', async () => {
    const token = await signupToken('k-abort');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/signup/abort',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    const [job] = await ctx.db.select().from(socialUnlinkJobs);
    expect(job!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(errorOf(await doSignup(token)).code).toBe('SIGNUP_TOKEN_EXPIRED');
  });

  it('GET /nicknames/availability: 가입 토큰 또는 사용자 토큰', async () => {
    await createUser(ctx, 'Taken');
    const token = await signupToken('k-avail');
    const check = async (nickname: string, bearer: string | null = token) =>
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/v1/nicknames/availability?nickname=${encodeURIComponent(nickname)}`,
          headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
        })
      ).json<{ result: string }>().result;
    expect(await check('새러너')).toBe('available');
    expect(await check('taken')).toBe('taken');
    expect(await check('관리자님')).toBe('forbidden');
    expect(await check('a')).toBe('invalid_format');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/nicknames/availability?nickname=x1',
    });
    expect(res.statusCode).toBe(401);

    // 사용자 토큰: 내 닉네임은 taken이 아니다
    const me = await createUser(ctx, 'Mine');
    expect(await check('mine', await ctx.tokenFor(me.id))).toBe('available');
  });
});

describe('POST /v1/auth/refresh · logout', () => {
  it('회전: 새 토큰 발급, 이전 토큰 재사용 → 401 REFRESH_REUSED + family 전체 폐기', async () => {
    const { tokens } = await signedUp();
    const res = await refresh(tokens.refreshToken);
    expect(res.statusCode).toBe(200);
    const next = TokenPair.parse(res.json());
    expect(next.refreshToken).not.toBe(tokens.refreshToken);

    const reuse = await refresh(tokens.refreshToken);
    expect([reuse.statusCode, errorOf(reuse).code]).toEqual([401, 'REFRESH_REUSED']);
    const afterTheft = await refresh(next.refreshToken);
    expect(errorOf(afterTheft).code).toBe('REFRESH_INVALID');
  });

  it('모르는 토큰·만료 토큰 → 401 REFRESH_INVALID', async () => {
    expect(errorOf(await refresh('nope')).code).toBe('REFRESH_INVALID');
    const { tokens } = await signedUp();
    await ctx.db.update(authSessions).set({ expiresAt: fromNow(-DAY) });
    expect(errorOf(await refresh(tokens.refreshToken)).code).toBe('REFRESH_INVALID');
  });

  it('같은 기기로 다시 로그인하면 그 기기의 이전 세션 폐기', async () => {
    const { tokens } = await signedUp('k-dev');
    await social({ provider: 'kakao', accessToken: 'k-dev' }, { 'x-device-id': DEVICE });
    expect(errorOf(await refresh(tokens.refreshToken)).code).toBe('REFRESH_INVALID');
  });

  it('로그아웃: 204, 세션 폐기, 기기 푸시 토큰 해제', async () => {
    const { tokens } = await signedUp();
    await ctx.db.update(devices).set({ pushToken: 'ExponentPushToken[x]' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(errorOf(await refresh(tokens.refreshToken)).code).toBe('REFRESH_INVALID');
    const [device] = await ctx.db.select().from(devices);
    expect(device!.pushToken).toBeNull();
  });
});

describe('약관 재동의 게이트 (tech/06 2.2)', () => {
  it('필수 약관 새 버전 시행 → 403 TERMS_REQUIRED, GET /me는 통과, 재동의 후 정상', async () => {
    const { user, tokens } = await signedUp();
    const auth = { authorization: `Bearer ${tokens.accessToken}` };
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me/records', headers: auth })).statusCode,
    ).toBe(200);

    const next = await seedTerms(ctx, fromNow(-60 * 1000));
    const blocked = await ctx.app.inject({ method: 'GET', url: '/v1/me/records', headers: auth });
    expect([blocked.statusCode, errorOf(blocked)]).toEqual([
      403,
      expect.objectContaining({
        code: 'TERMS_REQUIRED',
        details: { kinds: ['privacy', 'service'] },
      }),
    ]);

    const me = Me.parse(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json(),
    );
    expect(me.pendingTerms.map((t) => t.kind).sort()).toEqual(['privacy', 'service']);
    const login = SocialLoginRes.parse(
      (await social({ provider: 'kakao', accessToken: 'k-1' })).json(),
    );
    expect(login.result === 'logged_in' && login.pendingTerms.sort()).toEqual([
      'privacy',
      'service',
    ]);

    const consent = await call(ctx, user.id, 'POST', '/v1/me/consents', {
      agreedTermIds: [next.service.id, next.privacy.id],
    });
    expect(consent.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me/records', headers: auth })).statusCode,
    ).toBe(200);
  });

  it('GET /terms/current: Phase 1 항목만 (night_push 제외), 아직 시행 전 버전 제외', async () => {
    await seedTerms(ctx, fromNow(DAY));
    const list = TermsCurrent.parse(
      (await ctx.app.inject({ method: 'GET', url: '/v1/terms/current' })).json(),
    );
    expect(list.map((t) => t.id).sort()).toEqual(
      [terms.marketing.id, terms.privacy.id, terms.service.id].sort(),
    );
  });
});

describe('최소 앱 버전 (426)·앱 설정', () => {
  it('X-App-Version < 최소 버전이면 426, 같거나 높으면 통과, 헤더 없으면 통과, /app-config는 예외', async () => {
    await ctx.db.insert(appConfigs).values([
      { key: 'min_native_version_ios', value: '1.2.0' },
      { key: 'min_native_version_android', value: '1.0.0' },
      { key: 'maintenance', value: { active: false, until: null } },
    ]);
    // 약관 동의를 마친 사용자 (fixtures의 createUser는 동의 행이 없어 게이트에 걸린다)
    const { user } = await signedUp();
    const get = (url: string, headers: Record<string, string>) =>
      call(ctx, user.id, 'GET', url, undefined, headers);

    const old = await get('/v1/me/records', { 'x-app-version': '1.1.9', 'x-platform': 'ios' });
    expect([old.statusCode, errorOf(old)]).toEqual([
      426,
      expect.objectContaining({ code: 'UPGRADE_REQUIRED', details: { minVersion: '1.2.0' } }),
    ]);
    expect(
      (await get('/v1/me/records', { 'x-app-version': '1.2.0', 'x-platform': 'ios' })).statusCode,
    ).toBe(200);
    expect(
      (await get('/v1/me/records', { 'x-app-version': '1.1.9', 'x-platform': 'android' }))
        .statusCode,
    ).toBe(200);
    expect((await get('/v1/me/records', {})).statusCode).toBe(200);

    const cfg = await ctx.app.inject({
      method: 'GET',
      url: '/v1/app-config',
      headers: { 'x-app-version': '0.1.0', 'x-platform': 'ios' },
    });
    expect(cfg.statusCode).toBe(200);
    expect(AppConfig.parse(cfg.json())).toEqual({
      minNativeVersion: { ios: '1.2.0', android: '1.0.0' },
      maintenance: { active: false, until: null },
      supportEmail: null,
      privacyPolicyUrl: null,
    });
  });
});
