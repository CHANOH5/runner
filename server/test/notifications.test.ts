import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  devices,
  notifications,
  notificationSchedules,
  notificationSettings,
  raceRegistrations,
  races,
  users,
} from '../src/db/schema/index.js';
import {
  handleRaceUpdated,
  materializeDue,
  runTick,
  sendDue,
  type DeliveryDeps,
  type NotificationPayload,
} from '../src/modules/notifications/delivery.js';
import {
  createRateLimiter,
  PushTransportError,
  type PushClient,
  type PushMessage,
  type PushTicket,
} from '../src/modules/notifications/push.js';
import { recalculateSchedules } from '../src/modules/notifications/schedule.js';
import { addInterest, addRegistration, createRace, createUser } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

const kst = (s: string) => new Date(`${s}+09:00`);

/** 가짜 Expo: 받은 메시지를 기록하고, 응답은 테스트가 바꾼다 */
class FakePush implements PushClient {
  calls: PushMessage[][] = [];
  respond: (msgs: PushMessage[]) => PushTicket[] = (msgs) =>
    msgs.map((_, i) => ({ status: 'ok', id: `t${this.calls.length}-${i}` }));
  // respond가 던지면 거부된 Promise가 된다
  async send(messages: PushMessage[]) {
    this.calls.push(messages);
    return this.respond(messages);
  }
  get messages() {
    return this.calls.flat();
  }
}

let ctx: TestContext;
let push: FakePush;
let now: Date;
const deps = (): DeliveryDeps => ({
  db: ctx.db,
  push,
  limiter: createRateLimiter(600),
  clock: () => now,
});

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  push = new FakePush();
  now = kst('2026-10-21T12:00:00');
});

/**
 * 대회 1개 + 사용자 8명 (tech/03 7장 대상 표 검증용)
 * A 관심만 / B 참가 예정 접수 전(하프) / C 접수 완료 / D 접수 못 함 / E 관심 + 접수 완료
 * F 관심만이지만 휴면 / G 관심만이지만 접수 알림 OFF / H 접수 전(풀 — 종목 마감이 따로 있음)
 */
async function world() {
  const { race, events } = await createRace(ctx, {
    name: '2027 서울마라톤',
    raceDate: '2027-03-15',
    registrationOpensAt: kst('2026-11-01T10:00:00'),
    registrationClosesAt: kst('2026-11-15T23:59:00'),
    events: [
      { name: '하프', category: 'half', distanceM: 21097, startAt: kst('2027-03-15T08:00:00') },
      {
        name: '풀',
        category: 'full',
        distanceM: 42195,
        registrationClosesAt: kst('2026-11-10T18:00:00'),
      },
    ],
  });
  const [half, full] = events as [(typeof events)[0], (typeof events)[0]];
  const u: Record<string, string> = {};
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const user = await createUser(ctx, `user${name}`);
    u[name] = user.id;
    await ctx.db.insert(devices).values({
      userId: user.id,
      platform: 'ios',
      pushToken: `ExponentPushToken[${name}]`,
    });
  }
  for (const n of ['A', 'E', 'F', 'G']) await addInterest(ctx, u[n]!, race.id);
  await addRegistration(ctx, u.B!, race.id, half.id, {
    goalTimeSec: 7080,
    goalPaceSecPerKm: 336,
    goalSource: 'manual',
  });
  await addRegistration(ctx, u.C!, race.id, half.id, { entryStatus: 'registered' });
  await addRegistration(ctx, u.D!, race.id, half.id, { entryStatus: 'missed' });
  await addRegistration(ctx, u.E!, race.id, half.id, { entryStatus: 'registered' });
  await addRegistration(ctx, u.H!, race.id, full.id);
  await ctx.db.update(users).set({ status: 'dormant' }).where(eq(users.id, u.F!));
  await ctx.db.insert(notificationSettings).values({ userId: u.G!, registrationAlerts: false });
  await recalculateSchedules(ctx.db, race.id, now);
  const name = Object.fromEntries(Object.entries(u).map(([k, v]) => [v, k]));
  return { race, half, full, u, name };
}

async function scheduleRows(raceId: string) {
  return ctx.db
    .select()
    .from(notificationSchedules)
    .where(eq(notificationSchedules.raceId, raceId))
    .orderBy(notificationSchedules.scheduledAt);
}

async function notificationRows(kind?: string) {
  const rows = await ctx.db.select().from(notifications);
  return rows.filter((r) => !kind || r.kind === kind);
}

/** 그 시각으로 시계를 옮겨 대상 확정 + 발송 */
async function at(time: string) {
  now = kst(time);
  return runTick(deps());
}

describe('예약표 계산·재계산', () => {
  it('대회 저장 → N-01~N-05 + 종목 마감 행, 다시 계산해도 그대로', async () => {
    const { race, full } = await world();
    const rows = await scheduleRows(race.id);
    expect(rows.map((r) => [r.kind, r.raceEventId, r.scheduledAt])).toEqual([
      ['reg_open_d1', null, kst('2026-10-31T19:00:00')],
      ['reg_open_soon', null, kst('2026-11-01T09:50:00')],
      ['reg_close_d1', full.id, kst('2026-11-09T19:00:00')],
      ['reg_close_d1', null, kst('2026-11-14T19:00:00')],
      ['race_d7', null, kst('2027-03-08T12:00:00')],
      ['race_d1', null, kst('2027-03-14T19:00:00')],
    ]);
    expect(await recalculateSchedules(ctx.db, race.id, now)).toEqual({ upserted: 0, cancelled: 0 });
  });

  it('오픈 시각이 바뀌면 확정된 미발송 알림을 취소하고 새 시각으로', async () => {
    const { race } = await world();
    now = kst('2026-10-31T18:40:00');
    await materializeDue(deps());
    expect((await notificationRows('reg_open_d1')).every((n) => n.status === 'scheduled')).toBe(
      true,
    );

    await ctx.db
      .update(races)
      .set({ registrationOpensAt: kst('2026-11-03T10:00:00') })
      .where(eq(races.id, race.id));
    await recalculateSchedules(ctx.db, race.id, now);
    expect((await notificationRows('reg_open_d1')).every((n) => n.status === 'cancelled')).toBe(
      true,
    );
    const n01 = (await scheduleRows(race.id)).find((r) => r.kind === 'reg_open_d1')!;
    expect([n01.status, n01.scheduledAt]).toEqual(['pending', kst('2026-11-02T19:00:00')]);
  });
});

describe('대상 확정 (발송 30분 전, tech/03 7장 대상 표)', () => {
  it('30분 전이 되기 전에는 확정하지 않는다', async () => {
    await world();
    now = kst('2026-10-31T18:29:59');
    expect((await materializeDue(deps())).created).toBe(0);
    now = kst('2026-10-31T18:30:00');
    expect((await materializeDue(deps())).created).toBeGreaterThan(0);
  });

  it('N-01: 관심만 ∪ 접수 전 — 접수 완료·못 함·휴면·접수 알림 OFF 제외', async () => {
    const { name } = await world();
    now = kst('2026-10-31T18:30:00');
    await materializeDue(deps());
    expect((await notificationRows('reg_open_d1')).map((n) => name[n.userId]).sort()).toEqual([
      'A',
      'B',
      'H',
    ]);
  });

  it('N-03: 대회 단위 행은 관심만 + 종목 마감 없는 접수 전, 종목 행은 그 종목 접수 전만', async () => {
    const { name, full } = await world();
    now = kst('2026-11-14T18:30:00');
    await materializeDue(deps());
    const rows = await notificationRows('reg_close_d1');
    const byEvent = (id: string | null) =>
      rows
        .filter((r) => (r.payload as NotificationPayload).raceEventId === id)
        .map((r) => name[r.userId])
        .sort();
    expect(byEvent(null)).toEqual(['A', 'B']);
    expect(byEvent(full.id)).toEqual(['H']);
  });

  it('N-04·N-05: 참가 예정 중 접수 못 함 제외 (관심만 제외)', async () => {
    const { name } = await world();
    now = kst('2027-03-08T11:30:00');
    await materializeDue(deps());
    expect((await notificationRows('race_d7')).map((n) => name[n.userId]).sort()).toEqual([
      'B',
      'C',
      'E',
      'H',
    ]);
  });
});

describe('발송', () => {
  it('정각 발송: 메시지·문구·딥링크, sent_at = 넘긴 시각 (D-018), 예약 행 done', async () => {
    const { race, u } = await world();
    await at('2026-10-31T18:30:00'); // 확정만
    expect(push.calls).toHaveLength(0);
    const res = await at('2026-10-31T19:00:00');
    expect(res.sent.sent).toBe(3);
    expect(push.messages.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[A]',
      'ExponentPushToken[B]',
      'ExponentPushToken[H]',
    ]);
    const msg = push.messages.find((m) => m.to === 'ExponentPushToken[A]')!;
    expect(msg).toMatchObject({
      title: '내일 2027 서울마라톤 접수가 시작돼요',
      body: '11월 1일 10:00 오픈이에요. 인기 대회는 빨리 마감돼요.',
      data: { deepLink: `berun://races/${race.id}` },
    });
    const [rowA] = (await notificationRows('reg_open_d1')).filter((n) => n.userId === u.A);
    expect(rowA).toMatchObject({ status: 'sent', sentAt: kst('2026-10-31T19:00:00') });
    expect(rowA!.payload).toMatchObject({ title: msg.title, body: msg.body });
    expect((await scheduleRows(race.id)).find((r) => r.kind === 'reg_open_d1')!.status).toBe(
      'done',
    );
  });

  it('N-02는 오픈 −10분에 나간다 (09:50:00~10:00:00 구간)', async () => {
    await world();
    await at('2026-10-31T19:00:00'); // N-01 처리
    push.calls = [];
    await at('2026-11-01T09:20:00');
    await at('2026-11-01T09:49:59');
    expect(push.calls).toHaveLength(0);
    await at('2026-11-01T09:50:00');
    expect(push.messages[0]).toMatchObject({ title: '2027 서울마라톤 접수 10분 전이에요' });
  });

  it('발송 직전 재확인: 확정 뒤 접수 완료로 바꾸거나 알림을 끄면 취소', async () => {
    const { u } = await world();
    await at('2026-11-14T18:30:00');
    await ctx.db
      .update(raceRegistrations)
      .set({ entryStatus: 'registered' })
      .where(eq(raceRegistrations.userId, u.B!));
    await ctx.db.insert(notificationSettings).values({ userId: u.A!, registrationAlerts: false });
    const res = await at('2026-11-14T19:00:00');
    expect(res.sent).toMatchObject({ sent: 0, cancelled: 2 });
    expect(push.calls).toHaveLength(0);
  });

  it('시각 조건: 이미 접수가 열렸으면 N-01 취소', async () => {
    const { race } = await world();
    await at('2026-10-31T18:30:00');
    await ctx.db
      .update(races)
      .set({ registrationOpensAt: kst('2026-10-31T09:00:00') })
      .where(eq(races.id, race.id));
    const res = await at('2026-10-31T19:00:00');
    expect(res.sent.cancelled).toBe(3);
  });

  it('N-04 변형: 접수 전인데 접수가 마감됐으면 상태를 바꾸라는 본문 + S-022', async () => {
    const { race, u } = await world();
    await at('2027-03-08T11:30:00');
    await at('2027-03-08T12:00:00');
    const toB = push.messages.find((m) => m.to === 'ExponentPushToken[B]')!;
    expect(toB).toMatchObject({
      title: '2027 서울마라톤까지 일주일 남았어요',
      body: '아직 접수 전으로 되어 있어요. 접수했다면 접수 상태를 바꿔주세요.',
      data: { deepLink: `berun://races/${race.id}` },
    });
    const toC = push.messages.find((m) => m.to === 'ExponentPushToken[C]')!;
    expect(toC.body).toBe('목표 기록을 정하고 페이스 전략을 받아보세요.');
    expect(u.C).toBeTruthy();
  });

  it('묶음: 같은 사용자·종류·예약 시각 2건 → 푸시 1건, 앱 내 알림은 2건 모두 sent', async () => {
    const user = await createUser(ctx, 'bundle');
    await ctx.db
      .insert(devices)
      .values({ userId: user.id, platform: 'ios', pushToken: 'tok-bundle' });
    for (const name of ['가 마라톤', '나 하프']) {
      const { race } = await createRace(ctx, {
        name,
        raceDate: '2027-03-15',
        registrationOpensAt: kst('2026-11-01T10:00:00'),
      });
      await addInterest(ctx, user.id, race.id);
      await recalculateSchedules(ctx.db, race.id, now);
    }
    await at('2026-10-31T18:30:00');
    await at('2026-10-31T19:00:00');
    expect(push.messages).toHaveLength(1);
    expect(push.messages[0]).toMatchObject({
      title: '내일 접수가 시작되는 관심 대회 2개',
      body: '가 마라톤, 나 하프',
      data: { deepLink: 'berun://notifications' },
    });
    expect(push.messages[0]!.data.notificationIds).toHaveLength(2);
    const rows = await notificationRows('reg_open_d1');
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(rows.map((r) => (r.payload as NotificationPayload).title).sort()).toEqual([
      '내일 가 마라톤 접수가 시작돼요',
      '내일 나 하프 접수가 시작돼요',
    ]);
  });

  it('무효 토큰(DeviceNotRegistered) → 토큰 삭제, 재시도 없이 failed', async () => {
    const { u } = await world();
    push.respond = (msgs) =>
      msgs.map((m) =>
        m.to === 'ExponentPushToken[A]'
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 'x' },
      );
    await at('2026-10-31T18:30:00');
    const res = await at('2026-10-31T19:00:00');
    expect(res.sent).toMatchObject({ sent: 2, failed: 1 });
    const [dev] = await ctx.db.select().from(devices).where(eq(devices.userId, u.A!));
    expect(dev!.pushToken).toBeNull();
  });

  it('전송 실패: 1분 간격 3회 재시도 후 failed (앱 내 알림은 남는다)', async () => {
    const { u } = await world();
    push.respond = () => {
      throw new PushTransportError('expo responded 503');
    };
    await at('2026-10-31T18:30:00');
    expect((await at('2026-10-31T19:00:00')).sent.retried).toBe(3);
    expect((await at('2026-10-31T19:00:30')).sent.retried).toBe(0); // 1분 전에는 다시 안 함
    expect((await at('2026-10-31T19:01:00')).sent.retried).toBe(3);
    expect((await at('2026-10-31T19:02:00')).sent.retried).toBe(3);
    const last = await at('2026-10-31T19:03:00');
    expect(last.sent.failed).toBe(3);
    expect(push.calls).toHaveLength(4);
    const [rowA] = (await notificationRows('reg_open_d1')).filter((n) => n.userId === u.A);
    expect(rowA).toMatchObject({
      status: 'failed',
      attemptCount: 4,
      lastError: 'expo responded 503',
    });
    expect((rowA!.payload as NotificationPayload).title).toBe(
      '내일 2027 서울마라톤 접수가 시작돼요',
    );
  });

  it('푸시 토큰이 없으면 앱 내 알림만 (sent, sent_at 없음)', async () => {
    const { u } = await world();
    await ctx.db.update(devices).set({ pushToken: null }).where(eq(devices.userId, u.A!));
    await at('2026-10-31T18:30:00');
    const res = await at('2026-10-31T19:00:00');
    expect(res.sent.noDevice).toBe(1);
    const [rowA] = (await notificationRows('reg_open_d1')).filter((n) => n.userId === u.A);
    expect(rowA).toMatchObject({ status: 'sent', sentAt: null, lastError: 'no_device' });
  });
});

describe('늦게 돈 경우 (워커 중단 뒤)', () => {
  it('오픈 당일이 된 N-01("내일 시작")은 보내지 않고, 오픈 전 N-02는 보낸다', async () => {
    await world();
    const res = await at('2026-11-01T09:55:00');
    expect(res.sent.cancelled).toBe(3);
    expect(push.messages.map((m) => m.title)).toEqual(
      Array(3).fill('2027 서울마라톤 접수 10분 전이에요'),
    );
  });
});

describe('대회 변경 (N-06)', () => {
  it('취소: N-01~N-05 예약·확정 알림 모두 취소, 관심 ∪ 참가 예정에게 즉시 (설정 무관, 휴면 제외)', async () => {
    const { race, name } = await world();
    await at('2026-10-31T18:30:00'); // N-01 확정 상태
    await ctx.db.update(races).set({ status: 'cancelled' }).where(eq(races.id, race.id));

    const updated = await handleRaceUpdated(deps(), race.id, { notify: 'race_cancelled' });
    expect(updated).toMatchObject({ cancelled: 6, notified: 7 });
    expect((await scheduleRows(race.id)).every((r) => r.status === 'cancelled')).toBe(true);
    expect((await notificationRows('reg_open_d1')).every((n) => n.status === 'cancelled')).toBe(
      true,
    );

    const res = await sendDue(deps());
    expect(res.sent).toBe(7);
    const rows = await notificationRows('race_cancelled');
    expect(rows.map((r) => name[r.userId]).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'G', 'H']);
    expect(push.messages[0]!.title).toBe('2027 서울마라톤이 취소됐어요');
  });

  it('일정 변경: 요약 문구 포함, 예약표 재계산', async () => {
    const { race } = await world();
    await ctx.db.update(races).set({ raceDate: '2027-03-22' }).where(eq(races.id, race.id));
    await handleRaceUpdated(deps(), race.id, {
      notify: 'race_schedule_changed',
      changeSummary: '대회일: 3월 22일',
    });
    await sendDue(deps());
    expect(push.messages[0]!.body).toBe(
      '대회일: 3월 22일. 공식 홈페이지에서 한 번 더 확인해주세요.',
    );
    const d7 = (await scheduleRows(race.id)).find((r) => r.kind === 'race_d7')!;
    expect(d7.scheduledAt).toEqual(kst('2027-03-15T12:00:00'));
  });
});

describe('알림 목록 기록', () => {
  it('보낸 알림은 사용자별·대회별로 notifications에 남는다 (S-011)', async () => {
    const { u, race } = await world();
    await at('2026-10-31T18:30:00');
    await at('2026-10-31T19:00:00');
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, u.B!), eq(notifications.raceId, race.id)));
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as NotificationPayload;
    expect(payload.title).toBe('내일 2027 서울마라톤 접수가 시작돼요');
    expect(payload.body).toBe('11월 1일 10:00 오픈이에요. 인기 대회는 빨리 마감돼요.');
    expect(payload.deepLink).toBe(`berun://races/${race.id}`);
  });
});
