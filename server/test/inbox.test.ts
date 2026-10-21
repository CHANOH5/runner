import { NotificationPage, UnreadCount } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deletionJobs, notifications, notificationSchedules } from '../src/db/schema/index.js';
import { purgeExpiredNotifications } from '../src/modules/notifications/inbox.js';
import { call, createRace, createUser, DAY, errorOf, fromNow } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
let userId: string;
let raceId: string;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  userId = (await createUser(ctx)).id;
  raceId = (await createRace(ctx)).race.id;
});

let seq = 0;
const BASE = Date.now() - 60_000;
async function addNotification(
  over: Partial<typeof notifications.$inferInsert> & { title?: string } = {},
) {
  const { title = '알림', ...rest } = over;
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      userId,
      raceId,
      kind: 'race_d7',
      status: 'sent',
      // 같은 (사용자, 대회, kind, 시각) 유니크를 피하려고 1ms씩 다르게
      scheduledAt: new Date(BASE - seq++),
      payload: { title, body: '본문', deepLink: `berun://races/${raceId}` },
      ...rest,
    })
    .returning();
  return row!;
}

const list = async (qs = '') =>
  NotificationPage.parse((await call(ctx, userId, 'GET', `/v1/me/notifications${qs}`)).json());
const unread = async () =>
  UnreadCount.parse((await call(ctx, userId, 'GET', '/v1/me/notifications/unread-count')).json())
    .count;

describe('GET /v1/me/notifications (S-011)', () => {
  it('보낸·실패 알림만, 최근 90일, 내 것만, 예약 시각 최신순', async () => {
    const older = await addNotification({ title: '어제', scheduledAt: fromNow(-DAY) });
    const newer = await addNotification({ title: '방금' });
    await addNotification({ title: '푸시 실패', status: 'failed', scheduledAt: fromNow(-2 * DAY) });
    await addNotification({ title: '예약', status: 'scheduled' });
    await addNotification({ title: '취소', status: 'cancelled' });
    await addNotification({
      title: '오래됨',
      createdAt: fromNow(-91 * DAY),
      scheduledAt: fromNow(-91 * DAY),
    });
    const other = await createUser(ctx);
    await addNotification({ title: '남의 것', userId: other.id });

    const page = await list();
    expect(page.items.map((n) => n.title)).toEqual(['방금', '어제', '푸시 실패']);
    expect(page.items[0]).toMatchObject({
      id: newer.id,
      kind: 'race_d7',
      body: '본문',
      deepLink: `berun://races/${raceId}`,
      readAt: null,
    });
    expect(page.items[0]!.createdAt).toMatch(/\+09:00$/);
    expect(older.id).toBeTruthy();
  });

  it('커서 페이지네이션 (20개 기본, limit)', async () => {
    for (let i = 0; i < 5; i++)
      await addNotification({ title: `n${i}`, scheduledAt: fromNow(-i * 1000) });
    const p1 = await list('?limit=2');
    const p2 = await list(`?limit=2&cursor=${p1.nextCursor}`);
    const p3 = await list(`?limit=2&cursor=${p2.nextCursor}`);
    expect([...p1.items, ...p2.items, ...p3.items].map((n) => n.title)).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
      'n4',
    ]);
    expect(p3.nextCursor).toBeNull();
  });

  it('안 읽은 개수, 읽음 처리(ids / all), 남의 알림은 읽음 처리되지 않음', async () => {
    const a = await addNotification();
    await addNotification();
    await addNotification({ status: 'scheduled' }); // 셈에서 제외
    const other = await createUser(ctx);
    const theirs = await addNotification({ userId: other.id });
    expect(await unread()).toBe(2);

    let res = await call(ctx, userId, 'POST', '/v1/me/notifications/read', {
      ids: [a.id, theirs.id],
    });
    expect(res.statusCode).toBe(204);
    expect(await unread()).toBe(1);
    expect((await list()).items.find((n) => n.id === a.id)?.readAt).toMatch(/\+09:00$/);

    res = await call(ctx, userId, 'POST', '/v1/me/notifications/read', { all: true });
    expect(await unread()).toBe(0);
    const otherCount = UnreadCount.parse(
      (await call(ctx, other.id, 'GET', '/v1/me/notifications/unread-count')).json(),
    ).count;
    expect(otherCount).toBe(1);
  });

  it('잘못된 읽음 요청은 400', async () => {
    const res = await call(ctx, userId, 'POST', '/v1/me/notifications/read', { all: false });
    expect([res.statusCode, errorOf(res).code]).toEqual([400, 'VALIDATION_FAILED']);
  });
});

describe('90일 파기 배치 (P-RET-01)', () => {
  it('생성 90일 지난 알림과 끝난 예약 행을 지우고 deletion_jobs에 남긴다', async () => {
    await addNotification({ createdAt: fromNow(-91 * DAY) });
    await addNotification({ createdAt: fromNow(-89 * DAY) });
    await ctx.db.insert(notificationSchedules).values([
      { raceId, kind: 'race_d7', scheduledAt: fromNow(-100 * DAY), status: 'done' },
      { raceId, kind: 'race_d1', scheduledAt: fromNow(-100 * DAY), status: 'pending' },
      { raceId, kind: 'reg_open_d1', scheduledAt: fromNow(-10 * DAY), status: 'cancelled' },
    ]);

    expect(await purgeExpiredNotifications(ctx.db)).toEqual({ notifications: 1, schedules: 1 });
    expect(await ctx.db.$count(notifications)).toBe(1);
    expect(await ctx.db.$count(notificationSchedules)).toBe(2);
    const jobs = await ctx.db.select().from(deletionJobs);
    expect(jobs.map((j) => [j.jobName, j.deletedCount]).sort()).toEqual([
      ['notification_schedules_90d', 1],
      ['notifications_90d', 1],
    ]);

    // 지울 것이 없어도 실행 기록은 남긴다
    await purgeExpiredNotifications(ctx.db);
    expect(await ctx.db.$count(deletionJobs)).toBe(4);
  });
});
