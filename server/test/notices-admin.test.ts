import {
  AdminNotice,
  AdminNoticePage,
  MARKETING_OPT_OUT_TEXT,
  NoticeAudience,
  NoticeDetail,
} from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminAuditLogs,
  devices,
  notificationSettings,
  notifications,
  users,
} from '../src/db/schema/index.js';
import { runTick, type DeliveryDeps } from '../src/modules/notifications/delivery.js';
import { noticePushBody } from '../src/modules/notifications/notices.js';
import {
  createRateLimiter,
  type PushClient,
  type PushMessage,
  type PushTicket,
} from '../src/modules/notifications/push.js';
import { adminCall, loginAs, type AdminSession } from './admin-fixtures.js';
import { createRace, createUser, errorOf } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

/** 관리자 공지·푸시 (A-008, PRD 8.6, T-030) */

class FakePush implements PushClient {
  messages: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.messages.push(...messages);
    return messages.map((_, i) => ({ status: 'ok' as const, id: `t-${i}` }));
  }
}

let ctx: TestContext;
let push: FakePush;
let owner: AdminSession;
let operator: AdminSession;
let viewer: AdminSession;
let now: Date;

const deps = (): DeliveryDeps => ({
  db: ctx.db,
  push,
  limiter: createRateLimiter(600),
  clock: () => now,
});

/** 내일 KST hh:mm (API 검증은 실제 시각 기준이라 미래여야 한다) */
function tomorrowKst(hhmm: string) {
  const d = new Date(Date.now() + 9 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
  return `${d}T${hhmm}:00+09:00`;
}

const input = (over: object = {}) => ({
  kind: 'notice',
  title: '서비스 점검 안내',
  body: '10월 30일 새벽 2시부터 4시까지 점검합니다. 자세한 내용: https://example.test/x',
  sendPush: true,
  link: { type: 'race_list' },
  scheduledAt: tomorrowKst('10:00'),
  ...over,
});

async function users3() {
  const a = await createUser(ctx, 'A');
  const b = await createUser(ctx, 'B');
  const c = await createUser(ctx, 'C');
  const d = await createUser(ctx, 'D');
  await ctx.db.update(users).set({ status: 'dormant' }).where(eq(users.id, c.id));
  await ctx.db.insert(devices).values([
    { userId: a.id, platform: 'ios', pushToken: 'ExponentPushToken[A]' },
    { userId: d.id, platform: 'android', pushToken: 'ExponentPushToken[D]' },
  ]);
  await ctx.db.insert(notificationSettings).values({ userId: d.id, marketing: true });
  return { a, b, c, d };
}

async function createAndApprove(over: object = {}) {
  const res = await adminCall(ctx, owner, 'POST', '/notices', input(over));
  expect(res.statusCode).toBe(201);
  const created = AdminNotice.parse(res.json());
  const ok = await adminCall(ctx, owner, 'POST', `/notices/${created.id}/approve`);
  expect(ok.statusCode).toBe(200);
  return AdminNotice.parse(ok.json());
}

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  push = new FakePush();
  owner = await loginAs(ctx, 'owner');
  operator = await loginAs(ctx, 'operator');
  viewer = await loginAs(ctx, 'viewer');
  now = new Date(tomorrowKst('10:01'));
});

describe('권한·감사 로그', () => {
  it('viewer는 작성 불가, operator는 작성 가능하지만 승인은 owner만', async () => {
    expect((await adminCall(ctx, viewer, 'POST', '/notices', input())).statusCode).toBe(403);
    const res = await adminCall(ctx, operator, 'POST', '/notices', input());
    expect(res.statusCode).toBe(201);
    const { id } = AdminNotice.parse(res.json());
    const denied = await adminCall(ctx, operator, 'POST', `/notices/${id}/approve`);
    expect([denied.statusCode, errorOf(denied).code]).toEqual([403, 'FORBIDDEN']);
    expect((await adminCall(ctx, owner, 'POST', `/notices/${id}/approve`)).statusCode).toBe(200);
    // viewer는 목록 조회만
    const list = AdminNoticePage.parse((await adminCall(ctx, viewer, 'GET', '/notices')).json());
    expect(list.items[0]).toMatchObject({ id, status: 'approved' });
    const logs = await ctx.db.select().from(adminAuditLogs).where(eq(adminAuditLogs.targetId, id));
    expect(logs.map((l) => l.action).sort()).toEqual([
      'POST /api/admin/v1/notices',
      'POST /api/admin/v1/notices/:id/approve',
    ]);
  });
});

describe('입력 검증 (P-NOTI-02)', () => {
  it('마케팅 예약이 야간이면 400 night_not_allowed, 과거 예약은 past, 없는 대회 링크는 not_found', async () => {
    const night = await adminCall(
      ctx,
      owner,
      'POST',
      '/notices',
      input({ kind: 'marketing', scheduledAt: tomorrowKst('21:00') }),
    );
    expect(errorOf(night).fieldErrors).toEqual([
      { path: 'scheduledAt', code: 'night_not_allowed' },
    ]);
    const okMarketing = await adminCall(
      ctx,
      owner,
      'POST',
      '/notices',
      input({ kind: 'marketing', scheduledAt: tomorrowKst('20:59') }),
    );
    expect(okMarketing.statusCode).toBe(201);
    // 공지는 야간 예약 가능 (서비스 공지)
    expect(
      (
        await adminCall(
          ctx,
          owner,
          'POST',
          '/notices',
          input({ scheduledAt: tomorrowKst('23:00') }),
        )
      ).statusCode,
    ).toBe(201);
    const past = await adminCall(
      ctx,
      owner,
      'POST',
      '/notices',
      input({ scheduledAt: '2020-01-01T10:00:00+09:00' }),
    );
    expect(errorOf(past).fieldErrors).toEqual([{ path: 'scheduledAt', code: 'past' }]);
    const badRace = await adminCall(
      ctx,
      owner,
      'POST',
      '/notices',
      input({ link: { type: 'race', raceId: '0199f000-0000-7000-8000-00000000ffff' } }),
    );
    expect(errorOf(badRace).fieldErrors).toEqual([{ path: 'link.raceId', code: 'not_found' }]);
    const long = await adminCall(ctx, owner, 'POST', '/notices', input({ title: '가'.repeat(31) }));
    expect(long.statusCode).toBe(400);
  });
});

describe('게시·발송 (기존 발송 경로 재사용)', () => {
  it('공지: 활성 사용자 전체에 앱 내 알림, 토큰 있는 사용자에게 푸시, 휴면 제외, 통계', async () => {
    const { a, b, c, d } = await users3();
    const n = await createAndApprove();

    // 예약 시각 전에는 게시하지 않는다
    now = new Date(tomorrowKst('09:59'));
    await runTick(deps());
    expect(await ctx.db.select().from(notifications)).toHaveLength(0);

    now = new Date(tomorrowKst('10:01'));
    const tick = await runTick(deps());
    expect(tick.notices).toEqual({ notices: 1, created: 3 });
    const rows = await ctx.db.select().from(notifications);
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, b.id, d.id].sort());
    expect(rows.some((r) => r.userId === c.id)).toBe(false);
    expect(push.messages.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[A]',
      'ExponentPushToken[D]',
    ]);
    expect(push.messages[0]).toMatchObject({
      title: '서비스 점검 안내',
      data: { deepLink: `berun://notices/${n.id}` },
    });
    expect([...push.messages[0]!.body].length).toBeLessThanOrEqual(60);

    // 앱: 공지 상세 + 알림 목록
    const userToken = await ctx.tokenFor(b.id);
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/notices/${n.id}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(NoticeDetail.parse(detail.json())).toMatchObject({
      title: '서비스 점검 안내',
      link: { type: 'race_list' },
    });

    const list = AdminNoticePage.parse((await adminCall(ctx, owner, 'GET', '/notices')).json());
    expect(list.items[0]).toMatchObject({
      status: 'sent',
      stats: { recipients: 3, pushed: 2, inAppOnly: 1, failed: 0, pending: 0, opened: 0 },
    });
    expect(list.items[0]!.publishedAt).not.toBeNull();
  });

  it('마케팅: 동의자만, "(광고) " 제목, 본문 끝 수신 거부 안내 (60자 안)', async () => {
    const { d } = await users3();
    const n = await createAndApprove({
      kind: 'marketing',
      body: '가'.repeat(100),
      scheduledAt: tomorrowKst('10:00'),
    });
    expect(n.displayTitle).toBe('(광고) 서비스 점검 안내');
    await runTick(deps());
    const rows = await ctx.db.select().from(notifications);
    expect(rows.map((r) => r.userId)).toEqual([d.id]);
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]!.title).toBe('(광고) 서비스 점검 안내');
    expect(push.messages[0]!.body.endsWith(MARKETING_OPT_OUT_TEXT)).toBe(true);
    expect([...push.messages[0]!.body].length).toBe(60);
  });

  it('마케팅인데 워커가 야간에 돌면 게시하지 않고 기다린다', async () => {
    await users3();
    await createAndApprove({ kind: 'marketing', scheduledAt: tomorrowKst('20:50') });
    now = new Date(tomorrowKst('21:10'));
    expect((await runTick(deps())).notices.notices).toBe(0);
    expect(push.messages).toHaveLength(0);
  });

  it('푸시 없음이면 앱 내 알림만', async () => {
    await users3();
    await createAndApprove({ sendPush: false });
    await runTick(deps());
    const rows = await ctx.db.select().from(notifications);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'sent' && r.sentAt === null)).toBe(true);
    expect(push.messages).toHaveLength(0);
  });

  it('즉시 공지(예약 없음)는 승인 후 다음 tick에 게시', async () => {
    await users3();
    await createAndApprove({ scheduledAt: null });
    now = new Date();
    expect((await runTick(deps())).notices.notices).toBe(1);
  });

  it('대상 수 (확인 모달)', async () => {
    await users3();
    const res = await adminCall(ctx, owner, 'POST', '/notices', input({ kind: 'marketing' }));
    const { id } = AdminNotice.parse(res.json());
    const aud = NoticeAudience.parse(
      (await adminCall(ctx, owner, 'GET', `/notices/${id}/audience`)).json(),
    );
    expect(aud).toEqual({ recipients: 1, pushable: 1 });
  });
});

describe('수정·내리기·테스트 발송', () => {
  it('승인된 공지를 고치면 다시 draft, 게시된 공지는 수정 불가', async () => {
    await users3();
    const n = await createAndApprove();
    const edited = AdminNotice.parse(
      (
        await adminCall(ctx, operator, 'PUT', `/notices/${n.id}`, input({ title: '바뀐 제목' }))
      ).json(),
    );
    expect(edited).toMatchObject({ status: 'draft', title: '바뀐 제목', approvedBy: null });
    await adminCall(ctx, owner, 'POST', `/notices/${n.id}/approve`);
    await runTick(deps());
    const locked = await adminCall(ctx, owner, 'PUT', `/notices/${n.id}`, input());
    expect(locked.statusCode).toBe(409);
  });

  it('내리기: 앱 상세 410, 아직 보내지 않은 푸시는 취소 (앱 내 알림 행은 남음)', async () => {
    const { b } = await users3();
    const n = await createAndApprove();
    // 푸시가 나가기 전에 게시만 된 상태를 만든다: 발송 실패로 재시도 대기
    push.send = async (msgs) => msgs.map(() => ({ status: 'error', message: 'x' }));
    await runTick(deps());
    const res = await adminCall(ctx, operator, 'POST', `/notices/${n.id}/withdraw`);
    expect(AdminNotice.parse(res.json()).status).toBe('withdrawn');
    const rows = await ctx.db.select().from(notifications);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(2);
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/notices/${n.id}`,
      headers: { authorization: `Bearer ${await ctx.tokenFor(b.id)}` },
    });
    expect([detail.statusCode, errorOf(detail).code]).toEqual([410, 'NOTICE_WITHDRAWN']);
  });

  it('승인 대기 중 내리면 게시하지 않는다', async () => {
    await users3();
    const n = await createAndApprove();
    await adminCall(ctx, owner, 'POST', `/notices/${n.id}/withdraw`);
    expect((await runTick(deps())).notices.notices).toBe(0);
  });

  it('테스트 발송: 지정 사용자 1명에게 "[테스트]" 제목으로 바로, 통계에는 넣지 않음', async () => {
    const { a } = await users3();
    const res = await adminCall(ctx, owner, 'POST', '/notices', input({ scheduledAt: null }));
    const { id } = AdminNotice.parse(res.json());
    const t = await adminCall(ctx, operator, 'POST', `/notices/${id}/test`, { userId: a.id });
    expect(t.statusCode).toBe(200);
    now = new Date();
    await runTick(deps());
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({
      to: 'ExponentPushToken[A]',
      title: '[테스트] 서비스 점검 안내',
    });
    const list = AdminNoticePage.parse((await adminCall(ctx, owner, 'GET', '/notices')).json());
    expect(list.items[0]!.stats.recipients).toBe(0);
    const missing = await adminCall(ctx, owner, 'POST', `/notices/${id}/test`, {
      userId: '0199f000-0000-7000-8000-00000000ffff',
    });
    expect(errorOf(missing).fieldErrors).toEqual([{ path: 'userId', code: 'not_found' }]);
  });
});

describe('푸시 본문', () => {
  it('공지 앞 60자, 마케팅은 수신 거부 안내 포함 60자', () => {
    expect([...noticePushBody({ kind: 'notice', body: '가'.repeat(80) })].length).toBe(60);
    expect(noticePushBody({ kind: 'notice', body: '짧은\n본문' })).toBe('짧은 본문');
    const m = noticePushBody({ kind: 'marketing', body: '혜택' });
    expect(m).toBe(`혜택 ${MARKETING_OPT_OUT_TEXT}`);
  });

  it('대회 링크는 게시된 대회만', async () => {
    const { race } = await createRace(ctx);
    const res = await adminCall(
      ctx,
      owner,
      'POST',
      '/notices',
      input({ link: { type: 'race', raceId: race.id } }),
    );
    expect(AdminNotice.parse(res.json())).toMatchObject({
      link: { type: 'race', raceId: race.id },
      linkRaceName: race.name,
    });
  });
});
