import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authIdentities, devices, notifications, users } from '../src/db/schema/index.js';
import type { PushMessage } from '../src/modules/notifications/push.js';
import {
  dormancyNoticeText,
  fakeEmailDormancyChannel,
  pushDormancyChannel,
  runDormancyBatch,
  type DormancyNotice,
  type DormancyNoticeChannel,
} from '../src/modules/users/dormancy.js';
import { createUser } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-06-01T01:00:00Z'); // 10:00 KST

let ctx: TestContext;
let now: Date;
let sent: DormancyNotice[];
let logs: string[];
/** 기록용 채널 (실제 발송 없음) */
const recorder: DormancyNoticeChannel = {
  name: 'test',
  send: (n) => {
    sent.push(n);
    return Promise.resolve('sent');
  },
};
const run = (channels: DormancyNoticeChannel[] = [recorder]) =>
  runDormancyBatch({
    db: ctx.db,
    channels,
    clock: () => now,
    log: { info: (o, m) => logs.push(JSON.stringify({ ...o, m })) },
  });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  now = NOW;
  sent = [];
  logs = [];
});

/** 마지막 접속이 n일 전인 사용자 */
async function userInactiveFor(days: number, over: Partial<typeof users.$inferInsert> = {}) {
  const u = await createUser(ctx);
  await ctx.db
    .update(users)
    .set({ lastLoginAt: new Date(NOW.getTime() - days * DAY), ...over })
    .where(eq(users.id, u.id));
  return u.id;
}
const statusOf = async (id: string) =>
  (await ctx.db.select().from(users).where(eq(users.id, id)))[0]!;

describe('휴면 30일 전 안내 (P-RET-03)', () => {
  it('미접속 334일은 안내 없음, 335일(휴면 30일 전)부터 안내, 한 번만', async () => {
    const early = await userInactiveFor(334);
    const due = await userInactiveFor(335);
    expect(await run()).toMatchObject({ noticed: 1, dormant: 0 });
    expect(sent.map((n) => n.userId)).toEqual([due]);
    // 휴면 예정일 = 마지막 접속 + 365일 (KST 날짜)
    expect(sent[0]!.dormantOn).toBe('2027-07-01');
    expect((await statusOf(due)).dormancyNotifiedAt).toEqual(NOW);
    expect((await statusOf(early)).dormancyNotifiedAt).toBeNull();

    now = new Date(NOW.getTime() + DAY);
    expect((await run()).noticed).toBe(1); // early가 335일이 됨
    expect(sent.map((n) => n.userId)).toEqual([due, early]);
  });

  it('휴면·정지 계정은 대상 아님, last_login_at이 없으면 가입 시각 기준', async () => {
    await userInactiveFor(400, { status: 'suspended' });
    await userInactiveFor(400, { status: 'dormant' });
    const u = await createUser(ctx);
    await ctx.db
      .update(users)
      .set({ lastLoginAt: null, createdAt: new Date(NOW.getTime() - 340 * DAY) })
      .where(eq(users.id, u.id));
    expect(await run()).toMatchObject({ noticed: 1, dormant: 0 });
    expect(sent.map((n) => n.userId)).toEqual([u.id]);
  });
});

describe('휴면 전환', () => {
  it('미접속 364일은 아직, 365일이 되면 dormant (안내 30일 전 완료)', async () => {
    const notified = new Date(NOW.getTime() - 30 * DAY);
    const a = await userInactiveFor(364, { dormancyNotifiedAt: notified });
    const b = await userInactiveFor(365, { dormancyNotifiedAt: notified });
    expect(await run()).toMatchObject({ dormant: 1, noticed: 0 });
    expect([(await statusOf(a)).status, (await statusOf(b)).status]).toEqual(['active', 'dormant']);
  });

  it('안내한 지 29일이면 365일이 지나도 아직, 30일이 되면 전환 — 안내 없이 휴면으로 만들지 않는다', async () => {
    const u = await userInactiveFor(380, {
      dormancyNotifiedAt: new Date(NOW.getTime() - 29 * DAY),
    });
    expect((await run()).dormant).toBe(0);
    now = new Date(NOW.getTime() + DAY);
    expect((await run()).dormant).toBe(1);
    expect((await statusOf(u)).status).toBe('dormant');
  });

  it('안내가 늦은 경우(배치 첫 실행): 지금 안내하고 휴면은 30일 뒤', async () => {
    const u = await userInactiveFor(500);
    expect(await run()).toMatchObject({ noticed: 1, dormant: 0 });
    expect(sent[0]!.dormantOn).toBe('2027-07-01'); // 지금 + 30일
    now = new Date(NOW.getTime() + 29 * DAY);
    expect((await run()).dormant).toBe(0);
    now = new Date(NOW.getTime() + 30 * DAY);
    expect((await run()).dormant).toBe(1);
    expect((await statusOf(u)).status).toBe('dormant');
  });
});

describe('접속하면 초기화', () => {
  it('소셜 로그인: 안내 기록을 지우고 last_login_at 갱신 → 휴면되지 않음', async () => {
    const id = await userInactiveFor(340, {
      dormancyNotifiedAt: new Date(NOW.getTime() - 5 * DAY),
    });
    await ctx.db
      .insert(authIdentities)
      .values({ userId: id, provider: 'kakao', providerUid: 'k-back' });
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/social',
      payload: { provider: 'kakao', accessToken: 'k-back' },
    });
    const u = await statusOf(id);
    expect(u.dormancyNotifiedAt).toBeNull();
    expect(Date.now() - u.lastLoginAt!.getTime()).toBeLessThan(60_000);
  });

  it('토큰 회전(앱 열기)도 접속으로 본다, 휴면 계정의 refresh는 거절(소셜 로그인으로)', async () => {
    const id = await userInactiveFor(340, {
      dormancyNotifiedAt: new Date(NOW.getTime() - 5 * DAY),
    });
    const pair = await ctx.app.tokens.createSession(ctx.db, id, { deviceId: null, platform: null });
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: pair.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const u = await statusOf(id);
    expect(u.dormancyNotifiedAt).toBeNull();
    expect(Date.now() - u.lastLoginAt!.getTime()).toBeLessThan(60_000);

    await ctx.db.update(users).set({ status: 'dormant' }).where(eq(users.id, id));
    const r2 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: r1.json<{ refreshToken: string }>().refreshToken },
    });
    expect([r2.statusCode, r2.json<{ error: { code: string } }>().error.code]).toEqual([
      401,
      'REFRESH_INVALID',
    ]);
  });
});

describe('안내 채널', () => {
  it('앱 푸시: 앱 내 알림 행 + 기기로 발송 (설정 무관), 이메일은 자리만(skipped), 로그에 이메일 없음', async () => {
    const id = await userInactiveFor(335, { email: 'runner@example.com' });
    await ctx.db.insert(devices).values({ userId: id, platform: 'ios', pushToken: 'tok-dorm' });
    const pushed: PushMessage[] = [];
    const push = {
      send: (m: PushMessage[]) => {
        pushed.push(...m);
        return Promise.resolve(m.map(() => ({ status: 'ok' as const, id: 't' })));
      },
    };
    const log = { info: (o: object, m: string) => logs.push(JSON.stringify({ ...o, m })) };
    const res = await run([
      pushDormancyChannel(ctx.db, push, () => now),
      fakeEmailDormancyChannel(log),
    ]);
    expect(res.channels).toEqual({
      push: { sent: 1, skipped: 0, failed: 0 },
      email: { sent: 0, skipped: 1, failed: 0 },
    });
    const text = dormancyNoticeText('2027-07-01');
    expect(pushed).toEqual([
      expect.objectContaining({ to: 'tok-dorm', title: text.title, body: text.body }),
    ]);
    expect([...text.title].length).toBeLessThanOrEqual(30);
    expect([...text.body].length).toBeLessThanOrEqual(60);
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.userId, id));
    expect(n).toMatchObject({ kind: 'dormancy_notice', status: 'sent', sentAt: now });
    expect(logs.join('\n')).not.toContain('runner@example.com');

    // 앱 알림 목록에도 보인다
    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/notifications',
      headers: { authorization: `Bearer ${await ctx.tokenFor(id)}` },
    });
    expect(inbox.json<{ items: { kind: string }[] }>().items.map((i) => i.kind)).toEqual([
      'dormancy_notice',
    ]);
  });

  it('기기가 없으면 앱 내 알림만 남고 skipped', async () => {
    const id = await userInactiveFor(335);
    const res = await run([
      pushDormancyChannel(ctx.db, { send: () => Promise.resolve([]) }, () => now),
    ]);
    expect(res.channels.push).toEqual({ sent: 0, skipped: 1, failed: 0 });
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.userId, id));
    expect(n).toMatchObject({ status: 'sent', lastError: 'no_device', sentAt: null });
  });
});
