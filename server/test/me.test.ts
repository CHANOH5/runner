import { ConsentStatus, Me, NotificationSettingsRes, PrivacySettings } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devices, userConsents, userProfiles } from '../src/db/schema/index.js';
import { kstDate } from '../src/lib/time.js';
import { call, createUser, DAY, errorOf, fromNow, seedTerms } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
let userId: string;
let terms: Awaited<ReturnType<typeof seedTerms>>;
const DEVICE = '0199f000-0000-7000-8000-00000000d0a1';
const THIS_YEAR = Number(kstDate(new Date()).slice(0, 4));

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  terms = await seedTerms(ctx);
  userId = (await createUser(ctx, '처음닉')).id;
  // 필수 약관 동의 (게이트 통과)
  await ctx.db.insert(userConsents).values(
    [terms.service, terms.privacy].map((t) => ({
      userId,
      termsVersionId: t.id,
      action: 'agree',
    })),
  );
});

const patchProfile = (body: object) => call(ctx, userId, 'PATCH', '/v1/me/profile', body);

describe('PATCH /v1/me/profile (S-062, PRD 4.3)', () => {
  it('지역·성별·러닝 시작 연도 수정 → Me', async () => {
    const res = await patchProfile({ regionCode: 'busan', gender: 'male', runningSince: 2015 });
    expect(Me.parse(res.json())).toMatchObject({
      regionCode: 'busan',
      gender: 'male',
      runningSince: 2015,
    });
  });

  it('출생연도는 바꿀 수 없다 (400), 러닝 시작 연도 범위', async () => {
    let res = await patchProfile({ birthYear: 2000 });
    expect(res.statusCode).toBe(400);
    res = await patchProfile({ runningSince: 1990 }); // 출생 1990 + 5 미만
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'runningSince', code: 'out_of_range' }]);
    res = await patchProfile({ runningSince: THIS_YEAR + 1 });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'runningSince', code: 'out_of_range' }]);
  });

  it('닉네임: 바꾸면 7일 동안 다시 못 바꿈(422 + availableAt), 금칙어 422, 중복(대소문자 무시) 409', async () => {
    await createUser(ctx, 'Taken');
    let res = await patchProfile({ nickname: 'taken' });
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'NICKNAME_TAKEN']);
    res = await patchProfile({ nickname: '공식러너' });
    expect([res.statusCode, errorOf(res).code]).toEqual([422, 'NICKNAME_FORBIDDEN']);

    res = await patchProfile({ nickname: '새닉' });
    const me = Me.parse(res.json());
    expect(me.nickname).toBe('새닉');
    expect(me.nicknameChangeAvailableAt).toMatch(/\+09:00$/);

    res = await patchProfile({ nickname: '또바꿈' });
    expect([res.statusCode, errorOf(res).code]).toEqual([422, 'NICKNAME_CHANGE_COOLDOWN']);
    expect(errorOf(res).details?.availableAt).toBe(me.nicknameChangeAvailableAt);
    // 같은 닉네임을 다시 보내는 것은 변경이 아니다
    expect((await patchProfile({ nickname: '새닉', regionCode: 'jeju' })).statusCode).toBe(200);

    // 7일이 지나면 다시 바꿀 수 있다
    await ctx.db
      .update(userProfiles)
      .set({ nicknameChangedAt: fromNow(-7 * DAY - 1000) })
      .where(eq(userProfiles.userId, userId));
    expect((await patchProfile({ nickname: '또바꿈' })).statusCode).toBe(200);
  });
});

describe('GET/PATCH /v1/me/privacy (P-PRI-03)', () => {
  it('기본값(기록 친구, 참가자 목록 비노출) → 일부만 수정', async () => {
    const def = PrivacySettings.parse((await call(ctx, userId, 'GET', '/v1/me/privacy')).json());
    expect(def).toEqual({
      ageVisibility: 'participants',
      genderVisibility: 'private',
      regionVisibility: 'participants',
      recordsVisibility: 'friends',
      listedInParticipants: false,
    });
    const res = await call(ctx, userId, 'PATCH', '/v1/me/privacy', {
      recordsVisibility: 'private',
      listedInParticipants: true,
    });
    expect(PrivacySettings.parse(res.json())).toMatchObject({
      recordsVisibility: 'private',
      listedInParticipants: true,
      ageVisibility: 'participants',
    });
    expect(
      (await call(ctx, userId, 'PATCH', '/v1/me/privacy', { recordsVisibility: 'everyone' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('알림 설정·동의 (PRD 4.14, S-064, S-065)', () => {
  it('토글 저장, 마케팅 ON/OFF는 동의 이력(agree/withdraw) 추가 + 날짜', async () => {
    let s = NotificationSettingsRes.parse(
      (await call(ctx, userId, 'GET', '/v1/me/notification-settings')).json(),
    );
    expect(s).toEqual({
      registrationAlerts: true,
      ddayAlerts: true,
      marketing: false,
      marketingChangedAt: null,
    });

    s = NotificationSettingsRes.parse(
      (
        await call(ctx, userId, 'PATCH', '/v1/me/notification-settings', {
          ddayAlerts: false,
          marketing: true,
        })
      ).json(),
    );
    expect(s).toMatchObject({ ddayAlerts: false, marketing: true });
    expect(s.marketingChangedAt).toMatch(/\+09:00$/);

    // 같은 값이면 이력을 추가하지 않는다
    await call(ctx, userId, 'PATCH', '/v1/me/notification-settings', { marketing: true });
    // 선택 동의 철회
    await call(ctx, userId, 'PATCH', '/v1/me/notification-settings', { marketing: false });
    const rows = await ctx.db
      .select({ action: userConsents.action })
      .from(userConsents)
      .where(eq(userConsents.termsVersionId, terms.marketing.id))
      .orderBy(userConsents.createdAt);
    expect(rows.map((r) => r.action)).toEqual(['agree', 'withdraw']);

    const consents = ConsentStatus.parse(
      (await call(ctx, userId, 'GET', '/v1/me/consents')).json(),
    );
    expect(consents.map((c) => [c.kind, c.agreed])).toEqual([
      ['service', true],
      ['privacy', true],
      ['marketing', false],
    ]);
    expect(consents[0]!.agreedAt).toMatch(/\+09:00$/);
  });

  it('알 수 없는 필드 400', async () => {
    const res = await call(ctx, userId, 'PATCH', '/v1/me/notification-settings', {
      socialAlerts: false,
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /me/consents는 재동의 게이트 예외', async () => {
    await seedTerms(ctx, fromNow(-60_000)); // 새 필수 약관 시행
    expect((await call(ctx, userId, 'GET', '/v1/me/notification-settings')).statusCode).toBe(403);
    expect((await call(ctx, userId, 'GET', '/v1/me/consents')).statusCode).toBe(200);
  });
});

describe('PUT/DELETE /v1/me/device', () => {
  const put = (body: object, deviceId: string | null = DEVICE, who = userId) =>
    call(ctx, who, 'PUT', '/v1/me/device', body, deviceId ? { 'x-device-id': deviceId } : {});
  const body = {
    pushToken: 'ExponentPushToken[aaa]',
    pushPermission: 'granted',
    appVersion: '1.0.3',
    platform: 'ios',
  };

  it('등록·갱신, 같은 토큰이 다른 기기에 있으면 그쪽에서 제거, 삭제는 푸시 토큰만 해제', async () => {
    expect((await put(body)).statusCode).toBe(204);
    await put({ ...body, appVersion: '1.0.4' });
    let [d] = await ctx.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(d).toMatchObject({
      userId,
      pushToken: 'ExponentPushToken[aaa]',
      appVersion: '1.0.4',
      platform: 'ios',
    });

    // 다른 사용자가 같은 토큰을 다른 기기로 등록 (기기 양도 등)
    const other = (await createUser(ctx)).id;
    await ctx.db.insert(userConsents).values(
      [terms.service, terms.privacy].map((t) => ({
        userId: other,
        termsVersionId: t.id,
        action: 'agree',
      })),
    );
    await put(body, '0199f000-0000-7000-8000-00000000d0a2', other);
    [d] = await ctx.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(d!.pushToken).toBeNull();

    await put(body);
    expect(
      (await call(ctx, userId, 'DELETE', '/v1/me/device', undefined, { 'x-device-id': DEVICE }))
        .statusCode,
    ).toBe(204);
    [d] = await ctx.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(d).toMatchObject({ pushToken: null, userId });
  });

  it('X-Device-Id 없으면 400, 권한 거부면 토큰 null', async () => {
    const res = await put(body, null);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'x-device-id', code: 'required' }]);
    await put({ ...body, pushToken: null, pushPermission: 'denied' });
    const [d] = await ctx.db.select().from(devices);
    expect(d!.pushToken).toBeNull();
  });
});
