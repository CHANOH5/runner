import { SocialLoginRes } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authIdentities, deletionJobs, socialUnlinkJobs, users } from '../src/db/schema/index.js';
import type { UnlinkClient, UnlinkOutcome } from '../src/modules/auth/unlink-clients.js';
import {
  backoffMs,
  maskId,
  processUnlinkJobs,
  purgeStaleUnlinkJobs,
  type UnlinkDeps,
} from '../src/modules/auth/unlink-worker.js';
import { createUser, seedTerms } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** 가짜 provider: 호출을 기록하고, 결과는 테스트가 정한다 */
class FakeUnlink implements UnlinkClient {
  calls: { provider: string; value: string }[] = [];
  next: UnlinkOutcome | (() => never) = { kind: 'done' };
  private answer(provider: string, value: string) {
    this.calls.push({ provider, value });
    const n = this.next;
    return typeof n === 'function'
      ? Promise.reject(new Error(`exploded with ${value}`))
      : Promise.resolve(n);
  }
  kakaoUnlink(uid: string) {
    return this.answer('kakao', uid);
  }
  appleRevoke(token: string) {
    return this.answer('apple', token);
  }
}

let ctx: TestContext;
let client: FakeUnlink;
let now: Date;
let logs: string[];
const deps = (): UnlinkDeps => ({
  db: ctx.db,
  client,
  cipher: ctx.app.cipher,
  clock: () => now,
  log: {
    info: (o, m) => logs.push(JSON.stringify({ ...o, m })),
    warn: (o, m) => logs.push(JSON.stringify({ ...o, m })),
  },
});

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  client = new FakeUnlink();
  now = new Date('2026-10-23T03:00:00Z');
  logs = [];
});

async function job(over: Partial<typeof socialUnlinkJobs.$inferInsert> = {}) {
  const [row] = await ctx.db
    .insert(socialUnlinkJobs)
    .values({
      provider: 'kakao',
      providerUid: '4242424242',
      origin: 'account_deleted',
      nextAttemptAt: now,
      ...over,
    })
    .returning();
  return row!;
}
const rows = () => ctx.db.select().from(socialUnlinkJobs);
const run = () => processUnlinkJobs(deps());

describe('소셜 연결 해제 워커', () => {
  it('성공: 카카오는 회원번호로, Apple은 복호화한 refresh token으로 호출 → 작업 행 삭제', async () => {
    await job();
    await job({
      provider: 'apple',
      providerUid: 'apple-sub-1',
      revokeTokenEnc: ctx.app.cipher!.encrypt('apple-refresh-xyz'),
    });
    expect(await run()).toEqual({ done: 2, skippedResignup: 0, retried: 0, failed: 0 });
    expect(client.calls.sort((a, b) => a.provider.localeCompare(b.provider))).toEqual([
      { provider: 'apple', value: 'apple-refresh-xyz' },
      { provider: 'kakao', value: '4242424242' },
    ]);
    expect(await rows()).toEqual([]);
  });

  it('아직 실행 시각 전인 작업(가입 세션 만료 대기)은 건드리지 않는다', async () => {
    await job({ origin: 'signup', nextAttemptAt: new Date(now.getTime() + 31 * MIN) });
    expect(await run()).toEqual({ done: 0, skippedResignup: 0, retried: 0, failed: 0 });
    expect(client.calls).toEqual([]);
  });

  it('재가입 확인: 같은 provider 계정이 다시 가입했으면 해제하지 않고 작업만 지운다', async () => {
    const user = await createUser(ctx);
    await ctx.db
      .insert(authIdentities)
      .values({ userId: user.id, provider: 'kakao', providerUid: '4242424242' });
    await job({ origin: 'signup' });
    // 다른 provider의 같은 값은 상관없다
    await job({
      provider: 'apple',
      providerUid: '4242424242',
      revokeTokenEnc: ctx.app.cipher!.encrypt('t'),
    });
    expect(await run()).toMatchObject({ skippedResignup: 1, done: 1 });
    expect(client.calls.map((c) => c.provider)).toEqual(['apple']);
    expect(await rows()).toEqual([]);
  });

  it('일시 실패: 지수 백오프(1→2→4분…최대 60분), 첫 시도부터 24시간이 지나면 최종 실패 + 식별자 삭제', async () => {
    await job();
    client.next = { kind: 'transient', reason: 'kakao_http_503' };
    expect((await run()).retried).toBe(1);
    let [r] = await rows();
    expect(r).toMatchObject({ attempts: 1, status: 'pending', lastError: 'kakao_http_503' });
    expect(r!.nextAttemptAt.getTime() - now.getTime()).toBe(1 * MIN);
    expect(r!.firstAttemptAt).toEqual(now);

    now = new Date(now.getTime() + 30 * 1000); // 1분 전이면 다시 하지 않는다
    expect((await run()).retried).toBe(0);
    now = new Date(r!.nextAttemptAt.getTime());
    await run();
    [r] = await rows();
    expect(r!.nextAttemptAt.getTime() - now.getTime()).toBe(2 * MIN);
    expect([1, 2, 3, 6, 7, 20].map(backoffMs)).toEqual([
      MIN,
      2 * MIN,
      4 * MIN,
      32 * MIN,
      HOUR,
      HOUR,
    ]);

    now = new Date(r!.firstAttemptAt!.getTime() + 24 * HOUR);
    await ctx.db.update(socialUnlinkJobs).set({ nextAttemptAt: now });
    expect((await run()).failed).toBe(1);
    [r] = await rows();
    expect(r).toMatchObject({
      status: 'failed',
      providerUid: null,
      revokeTokenEnc: null,
      attempts: 3,
      lastError: 'retry_window_exceeded:kakao_http_503',
      finishedAt: now,
    });
  });

  it('영구 실패: 바로 최종 실패 + 식별자·토큰 삭제, Apple 토큰 없음도 영구 실패', async () => {
    await job();
    await job({ provider: 'apple', providerUid: 'apple-sub-2', revokeTokenEnc: null });
    client.next = { kind: 'permanent', reason: 'kakao_400_-2' };
    expect((await run()).failed).toBe(2);
    const all = await rows();
    expect(all.map((r) => [r.provider, r.status, r.providerUid, r.lastError]).sort()).toEqual([
      ['apple', 'failed', null, 'no_revoke_token'],
      ['kakao', 'failed', null, 'kakao_400_-2'],
    ]);
  });

  it('클라이언트 예외는 일시 실패로, 예외 메시지(요청 값 포함 가능)는 남기지 않는다', async () => {
    await job();
    client.next = () => {
      throw new Error();
    };
    await run();
    const [r] = await rows();
    expect(r).toMatchObject({ status: 'pending', lastError: 'client_error' });
  });

  it('로그에는 식별자 해시 앞 8자리만, 토큰은 어떤 형태로도 없다', async () => {
    await job();
    await job({
      provider: 'apple',
      providerUid: 'apple-sub-3',
      revokeTokenEnc: ctx.app.cipher!.encrypt('secret-refresh'),
    });
    client.next = { kind: 'transient', reason: 'kakao_http_503' };
    await run();
    const text = logs.join('\n');
    expect(text).not.toContain('4242424242');
    expect(text).not.toContain('apple-sub-3');
    expect(text).not.toContain('secret-refresh');
    expect(text).toContain(maskId('4242424242'));
  });
});

describe('가입 중단·탈퇴 경로 연결', () => {
  it('가입 중단(abort) → 즉시 실행 작업 → 워커가 해제, 탈퇴 → 해제', async () => {
    const terms = await seedTerms(ctx);
    // 가입 중단
    const social = SocialLoginRes.parse(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/social',
          payload: { provider: 'kakao', accessToken: 'k-abort' },
        })
      ).json(),
    );
    if (social.result !== 'signup_required') throw new Error('expected signup');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/signup/abort',
      headers: { authorization: `Bearer ${social.signupToken}` },
    });
    now = new Date(); // 실제 시각 기준으로 넣은 작업
    expect((await rows()).map((r) => r.origin)).toEqual(['signup']);
    expect((await run()).done).toBe(1);

    // 탈퇴
    const s2 = SocialLoginRes.parse(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/social',
          payload: { provider: 'kakao', accessToken: 'k-leave' },
        })
      ).json(),
    );
    if (s2.result !== 'signup_required') throw new Error('expected signup');
    const signup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: { authorization: `Bearer ${s2.signupToken}` },
      payload: {
        agreedTermIds: [terms.service.id, terms.privacy.id],
        profile: {
          nickname: '떠나는러너',
          birthYear: 1990,
          regionCode: 'seoul',
          gender: null,
          runningSince: null,
        },
      },
    });
    const { tokens } = signup.json<{ tokens: { accessToken: string } }>();
    await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { reasonCode: null, confirmed: true },
    });
    now = new Date();
    expect((await rows()).map((r) => r.origin)).toEqual(['account_deleted']);
    expect((await run()).done).toBe(1);
    expect(client.calls).toEqual([
      { provider: 'kakao', value: 'k-abort' },
      { provider: 'kakao', value: 'k-leave' },
    ]);
    expect(await ctx.db.$count(users)).toBe(0);
  });
});

describe('7일 정리 배치 (P-RET-01)', () => {
  it('7일 지난 미완료 작업은 식별자·토큰을 지우고 실패로, deletion_jobs 기록 (0건이어도)', async () => {
    const old = await job({
      createdAt: new Date(now.getTime() - 8 * 24 * HOUR),
      lastError: 'kakao_http_503',
    });
    const fresh = await job({
      providerUid: '1111',
      createdAt: new Date(now.getTime() - 6 * 24 * HOUR),
    });
    expect(await purgeStaleUnlinkJobs(ctx.db, now)).toEqual({ expired: 1 });
    const [o] = await ctx.db.select().from(socialUnlinkJobs).where(eq(socialUnlinkJobs.id, old.id));
    expect(o).toMatchObject({
      status: 'failed',
      providerUid: null,
      revokeTokenEnc: null,
      lastError: 'expired_7d:kakao_http_503',
    });
    const [f] = await ctx.db
      .select()
      .from(socialUnlinkJobs)
      .where(eq(socialUnlinkJobs.id, fresh.id));
    expect(f).toMatchObject({ status: 'pending', providerUid: '1111' });

    await purgeStaleUnlinkJobs(ctx.db, now);
    const logs = await ctx.db.select().from(deletionJobs);
    expect(logs.map((l) => [l.jobName, l.deletedCount])).toEqual([
      ['social_unlink_identifiers_7d', 1],
      ['social_unlink_identifiers_7d', 0],
    ]);
  });
});
