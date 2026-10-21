import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  handleRaceUpdated,
  runTick,
  sendDue,
  type DeliveryDeps,
} from '../modules/notifications/delivery.js';
import { purgeExpiredNotifications } from '../modules/notifications/inbox.js';
import type { RaceChangeKind } from '../modules/notifications/kinds.js';

/**
 * 알림 큐 (BullMQ, tech/02·03 7장).
 * - tick: 1분마다 대상 확정(발송 30분 전) + 발송. N-02(오픈 −10분)도 1분 안에 나간다
 * - race-updated: 관리자 대회 저장 → 예약표 재계산 + N-06 즉시 발송
 * - retention: 매일 04:00 KST 알림 90일 파기 (deletion_jobs 기록)
 * 여러 워커가 돌아도 DB 행 잠금(SKIP LOCKED)과 임대로 한 번만 처리한다.
 */
export const NOTIFICATION_QUEUE = 'notifications';
export const QUEUE_PREFIX = 'berun';
export const TICK_EVERY_MS = 60 * 1000;

export type RaceUpdatedJob = {
  raceId: string;
  notify?: RaceChangeKind;
  changeSummary?: string | null;
};

export function createNotificationQueue(connection: ConnectionOptions, prefix = QUEUE_PREFIX) {
  return new Queue(NOTIFICATION_QUEUE, { connection, prefix });
}

/** 1분 반복 작업 등록 (여러 번 불러도 하나) */
export async function scheduleTick(queue: Queue) {
  await queue.upsertJobScheduler('notifications-tick', { every: TICK_EVERY_MS }, { name: 'tick' });
  // 파기 배치: 매일 04:00 KST (tech/04 5장)
  await queue.upsertJobScheduler(
    'notifications-retention',
    { pattern: '0 4 * * *', tz: 'Asia/Seoul' },
    { name: 'retention' },
  );
}

/** 관리자 API가 대회를 저장한 뒤 부른다 */
export function enqueueRaceUpdated(queue: Queue, job: RaceUpdatedJob) {
  return queue.add('race-updated', job, { removeOnComplete: 1000, removeOnFail: 5000 });
}

export async function processJob(deps: DeliveryDeps, job: Pick<Job, 'name' | 'data'>) {
  switch (job.name) {
    case 'tick':
      return runTick(deps);
    case 'race-updated': {
      const data = job.data as RaceUpdatedJob;
      const updated = await handleRaceUpdated(deps, data.raceId, data);
      const sent = data.notify ? await sendDue(deps) : null;
      return { updated, sent };
    }
    case 'retention':
      return purgeExpiredNotifications(deps.db, deps.clock());
    default:
      throw new Error(`unknown job ${job.name}`);
  }
}

export function createNotificationWorker(
  deps: DeliveryDeps,
  connection: ConnectionOptions,
  prefix = QUEUE_PREFIX,
) {
  return new Worker(NOTIFICATION_QUEUE, (job) => processJob(deps, job), {
    connection,
    prefix,
    concurrency: 1,
  });
}
