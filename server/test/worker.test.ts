import { QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devices, races, socialUnlinkJobs } from '../src/db/schema/index.js';
import { createRateLimiter, type PushMessage } from '../src/modules/notifications/push.js';
import { recalculateSchedules } from '../src/modules/notifications/schedule.js';
import {
  createNotificationQueue,
  createNotificationWorker,
  enqueueRaceUpdated,
  NOTIFICATION_QUEUE,
} from '../src/worker/queue.js';
import {
  ACCOUNTS_QUEUE,
  createAccountsQueue,
  createAccountsWorker,
} from '../src/worker/accounts.js';
import { TEST_REDIS_URL } from './env.js';
import { addInterest, createRace, createUser } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';
import { eq } from 'drizzle-orm';

const kst = (s: string) => new Date(`${s}+09:00`);

/** BullMQ 큐·워커를 실제 Redis(테스트 DB 1번)에서 돌려 작업 연결을 확인한다 */
describe('BullMQ 알림 워커', () => {
  let ctx: TestContext;
  let connection: Redis;
  const prefix = `berun-test-${uuidv7()}`;
  const sent: PushMessage[] = [];
  let now = kst('2026-10-21T12:00:00');

  beforeAll(async () => {
    ctx = await createTestContext();
    connection = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
  });
  afterAll(async () => {
    await ctx.close();
    await connection.quit();
  });
  beforeEach(() => truncateAll(ctx.db));

  it('race-updated 작업: 예약표 재계산 + N-06 즉시 발송, tick 작업: 대상 확정·발송', async () => {
    const user = await createUser(ctx, 'worker');
    await ctx.db.insert(devices).values({ userId: user.id, platform: 'ios', pushToken: 'tok-w' });
    const { race } = await createRace(ctx, {
      name: '워커 마라톤',
      raceDate: '2027-03-15',
      registrationOpensAt: kst('2026-11-01T10:00:00'),
    });
    await addInterest(ctx, user.id, race.id);
    await recalculateSchedules(ctx.db, race.id, now);

    const deps = {
      db: ctx.db,
      push: {
        send: (msgs: PushMessage[]) => {
          sent.push(...msgs);
          return Promise.resolve(msgs.map((_, i) => ({ status: 'ok' as const, id: `w${i}` })));
        },
      },
      limiter: createRateLimiter(600),
      clock: () => now,
    };
    const queue = createNotificationQueue(connection, prefix);
    const events = new QueueEvents(NOTIFICATION_QUEUE, { connection, prefix });
    const worker = createNotificationWorker(deps, connection, prefix);
    await events.waitUntilReady();
    try {
      // tick: N-01 확정(18:30) → 발송(19:00)
      now = kst('2026-10-31T18:30:00');
      await (await queue.add('tick', {})).waitUntilFinished(events, 10_000);
      now = kst('2026-10-31T19:00:00');
      const tick: unknown = await (await queue.add('tick', {})).waitUntilFinished(events, 10_000);
      expect(tick).toMatchObject({ sent: { sent: 1 } });
      expect(sent.map((m) => m.title)).toEqual(['내일 워커 마라톤 접수가 시작돼요']);

      // race-updated: 연기 → N-06 즉시
      await ctx.db.update(races).set({ status: 'postponed' }).where(eq(races.id, race.id));
      const job = await enqueueRaceUpdated(queue, { raceId: race.id, notify: 'race_postponed' });
      const result: unknown = await job.waitUntilFinished(events, 10_000);
      expect(result).toMatchObject({ updated: { notified: 1 }, sent: { sent: 1 } });
      expect(sent.at(-1)?.title).toBe('워커 마라톤 대회가 연기됐어요');
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

describe('BullMQ 계정 작업 큐 (소셜 연결 해제)', () => {
  it('unlink 작업이 실행 시각이 된 해제 작업을 처리한다', async () => {
    const ctx2 = await createTestContext();
    const connection = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = `berun-test-${uuidv7()}`;
    await truncateAll(ctx2.db);
    await ctx2.db
      .insert(socialUnlinkJobs)
      .values({ provider: 'kakao', providerUid: '77', nextAttemptAt: new Date() });
    const called: string[] = [];
    const deps = {
      db: ctx2.db,
      client: {
        kakaoUnlink: (uid: string) => {
          called.push(uid);
          return Promise.resolve({ kind: 'done' as const });
        },
        appleRevoke: () => Promise.resolve({ kind: 'done' as const }),
      },
      cipher: ctx2.app.cipher,
      clock: () => new Date(),
      log: { info: () => {}, warn: () => {} },
    };
    const queue = createAccountsQueue(connection, prefix);
    const events = new QueueEvents(ACCOUNTS_QUEUE, { connection, prefix });
    const worker = createAccountsWorker(deps, connection, prefix);
    await events.waitUntilReady();
    try {
      const result: unknown = await (
        await queue.add('unlink', {})
      ).waitUntilFinished(events, 10_000);
      expect(result).toEqual({ done: 1, skippedResignup: 0, retried: 0, failed: 0 });
      expect(called).toEqual(['77']);
      const retention: unknown = await (
        await queue.add('unlink-retention', {})
      ).waitUntilFinished(events, 10_000);
      expect(retention).toEqual({ expired: 0 });
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
      await ctx2.close();
    }
  });
});
