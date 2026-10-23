import { SignupRes } from '@berun/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountDeletionStats,
  authIdentities,
  authSessions,
  devices,
  notifications,
  notificationSettings,
  predictions,
  privacySettings,
  raceInterests,
  raceRegistrations,
  raceReports,
  runRecords,
  socialUnlinkJobs,
  userConsents,
  userProfiles,
  users,
} from '../src/db/schema/index.js';
import { addDays, kstDate } from '../src/lib/time.js';
import { createRace, errorOf, seedTerms } from './fixtures.js';
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

/** 실제 가입 흐름으로 사용자 + 데이터 전부 만들기 */
async function fullUser(provider: 'kakao' | 'apple' | 'google', uid: string, nickname: string) {
  const body =
    provider === 'kakao'
      ? { provider, accessToken: `${uid}|${uid}@example.com` }
      : provider === 'google'
        ? { provider, idToken: uid }
        : { provider, identityToken: uid, authorizationCode: 'code' };
  const social = (
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/social', payload: body })
  ).json<{
    signupToken: string;
  }>();
  const signup = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    headers: {
      authorization: `Bearer ${social.signupToken}`,
      'x-device-id': `0199f000-0000-7000-8000-${uid
        .padStart(12, '0')
        .slice(-12)
        .replace(/[^0-9a-f]/g, '0')}`,
    },
    payload: {
      agreedTermIds: [terms.service.id, terms.privacy.id, terms.marketing.id],
      profile: { nickname, birthYear: 1990, regionCode: 'seoul', gender: null, runningSince: null },
    },
  });
  const { user, tokens } = SignupRes.parse(signup.json());
  const auth = { authorization: `Bearer ${tokens.accessToken}` };
  const userId = user.id;

  const { race, event } = await createRace(ctx);
  await ctx.app.inject({ method: 'PUT', url: `/v1/races/${race.id}/interest`, headers: auth });
  await ctx.app.inject({
    method: 'POST',
    url: '/v1/me/records',
    headers: auth,
    payload: {
      category: '10k',
      distanceM: 10000,
      durationSec: 3000,
      runDate: addDays(kstDate(new Date()), -5),
      kind: 'race',
      title: null,
    },
  });
  const reg = await ctx.app.inject({
    method: 'POST',
    url: `/v1/races/${race.id}/registration`,
    headers: auth,
    payload: { raceEventId: event.id, goalSource: 'manual', goalTimeSec: 7200 },
  });
  expect(reg.json<{ predictionId: string | null }>().predictionId).not.toBeNull();
  await ctx.app.inject({
    method: 'POST',
    url: `/v1/races/${race.id}/reports`,
    headers: auth,
    payload: { field: 'fee', message: '참가비가 공식 홈페이지와 달라요.' },
  });
  await ctx.db
    .update(devices)
    .set({ pushToken: `ExponentPushToken[${uid}]` })
    .where(eq(devices.userId, userId));
  await ctx.db.insert(notifications).values({
    userId,
    raceId: race.id,
    kind: 'race_d7',
    scheduledAt: new Date(Date.now() + 86_400_000),
    payload: {},
  });
  return { userId, auth, raceId: race.id };
}

const countBy = async (table: Parameters<typeof ctx.db.$count>[0], col: unknown, userId: string) =>
  ctx.db.$count(table, sql`${col} = ${userId}`);

const deleteMe = (auth: Record<string, string>, body: object) =>
  ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: auth, payload: body });

describe('DELETE /v1/me (F-072, P-RET)', () => {
  it('즉시 파기 대상은 0행, 보존 대상은 남는다 (테이블별)', async () => {
    const { userId, auth } = await fullUser('kakao', 'k1', '탈퇴러너');
    const keep = await fullUser('google', 'g1', '남는러너');

    // 탈퇴 전: 각 테이블에 데이터가 있다
    const before = {
      users: await countBy(users, users.id, userId),
      records: await countBy(runRecords, runRecords.userId, userId),
      predictions: await countBy(predictions, predictions.userId, userId),
      consents: await countBy(userConsents, userConsents.userId, userId),
    };
    expect(before).toEqual({ users: 1, records: 1, predictions: 1, consents: 3 });

    const res = await deleteMe(auth, {
      reasonCode: 'other',
      reasonText: '그냥요',
      confirmed: true,
    });
    expect(res.statusCode).toBe(204);

    // 즉시 파기 (PRD 4.15 수용 기준 + 연관 테이블)
    const purged: [string, Parameters<typeof ctx.db.$count>[0], unknown][] = [
      ['users', users, users.id],
      ['auth_identities', authIdentities, authIdentities.userId],
      ['auth_sessions', authSessions, authSessions.userId],
      ['user_profiles', userProfiles, userProfiles.userId],
      ['privacy_settings', privacySettings, privacySettings.userId],
      ['notification_settings', notificationSettings, notificationSettings.userId],
      ['devices', devices, devices.userId],
      ['race_interests', raceInterests, raceInterests.userId],
      ['race_registrations', raceRegistrations, raceRegistrations.userId],
      ['run_records', runRecords, runRecords.userId],
      ['predictions', predictions, predictions.userId],
      ['notifications', notifications, notifications.userId],
    ];
    for (const [name, table, col] of purged) {
      expect(await countBy(table, col, userId), name).toBe(0);
    }

    // 보존: 동의 이력(법정), 제보 내용(익명화)
    expect(await countBy(userConsents, userConsents.userId, userId)).toBe(3);
    const reports = await ctx.db.select().from(raceReports);
    expect(reports.map((r) => r.userId).sort()).toEqual([keep.userId, null].sort());
    // 탈퇴 사유 통계: user_id·시각 없이 날짜만
    const [stat] = await ctx.db.select().from(accountDeletionStats);
    expect(Object.keys(stat!).sort()).toEqual(['deletedOn', 'id', 'reasonCode', 'reasonText']);
    expect(stat).toMatchObject({
      reasonCode: 'other',
      reasonText: '그냥요',
      deletedOn: kstDate(new Date()),
    });
    // 카카오 연결 해제 작업 (실제 호출은 워커, 지금은 큐에만)
    const [job] = await ctx.db.select().from(socialUnlinkJobs);
    expect(job).toMatchObject({ provider: 'kakao', providerUid: 'k1', attempts: 0 });
    expect(job!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());

    // 다른 사용자 데이터는 그대로
    expect(await countBy(users, users.id, keep.userId)).toBe(1);
    expect(await countBy(runRecords, runRecords.userId, keep.userId)).toBe(1);

    // 탈퇴 후 같은 토큰으로는 아무것도 못 한다 (refresh도 폐기됨)
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth })).statusCode).toBe(
      404,
    );
  });

  it('Apple은 revoke용 토큰과 함께 작업 생성, Google은 작업 없음', async () => {
    const apple = await fullUser('apple', 'a1', '애플러너');
    const google = await fullUser('google', 'g2', '구글러너');
    await deleteMe(apple.auth, { reasonCode: null, confirmed: true });
    await deleteMe(google.auth, { reasonCode: 'no_races', confirmed: true });
    const jobs = await ctx.db.select().from(socialUnlinkJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.provider).toBe('apple');
    expect(ctx.app.cipher!.decrypt(jobs[0]!.revokeTokenEnc!)).toBe('apple-refresh-a1');
    expect(
      (await ctx.db.select().from(accountDeletionStats)).map((s) => s.reasonCode).sort(),
    ).toEqual(['no_races', null].sort());
  });

  it('확인 체크 없으면 400, 사유가 기타가 아닌데 직접 입력하면 400', async () => {
    const { auth, userId } = await fullUser('kakao', 'k2', '확인러너');
    let res = await deleteMe(auth, { reasonCode: null, confirmed: false });
    expect(res.statusCode).toBe(400);
    res = await deleteMe(auth, { reasonCode: 'privacy', reasonText: '이유', confirmed: true });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'reasonText', code: 'not_allowed' }]);
    expect(await countBy(users, users.id, userId)).toBe(1);
  });

  it('필수 약관 재동의 전에도 탈퇴할 수 있다 (게이트 예외)', async () => {
    const { auth } = await fullUser('kakao', 'k3', '게이트러너');
    await seedTerms(ctx, new Date(Date.now() - 60_000));
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me/records', headers: auth })).statusCode,
    ).toBe(403);
    expect((await deleteMe(auth, { reasonCode: null, confirmed: true })).statusCode).toBe(204);
  });
});
