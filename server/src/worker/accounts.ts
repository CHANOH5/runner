import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  processUnlinkJobs,
  purgeStaleUnlinkJobs,
  type UnlinkDeps,
} from '../modules/auth/unlink-worker.js';
import { QUEUE_PREFIX } from './queue.js';

/**
 * 계정 작업 큐 (BullMQ). 알림 큐와 같은 워커 프로세스에서 돈다.
 * - unlink: 1분마다 실행 시각이 된 소셜 연결 해제 작업 처리
 * - unlink-retention: 매일 04:20 KST, 7일 지난 작업의 식별자·토큰 정리 (deletion_jobs 기록)
 */
export const ACCOUNTS_QUEUE = 'accounts';

export function createAccountsQueue(connection: ConnectionOptions, prefix = QUEUE_PREFIX) {
  return new Queue(ACCOUNTS_QUEUE, { connection, prefix });
}

export async function scheduleAccountJobs(queue: Queue) {
  await queue.upsertJobScheduler('accounts-unlink', { every: 60 * 1000 }, { name: 'unlink' });
  await queue.upsertJobScheduler(
    'accounts-unlink-retention',
    { pattern: '20 4 * * *', tz: 'Asia/Seoul' },
    { name: 'unlink-retention' },
  );
}

export async function processAccountJob(deps: UnlinkDeps, job: Pick<Job, 'name'>) {
  switch (job.name) {
    case 'unlink':
      return processUnlinkJobs(deps);
    case 'unlink-retention':
      return purgeStaleUnlinkJobs(deps.db, deps.clock());
    default:
      throw new Error(`unknown job ${job.name}`);
  }
}

export function createAccountsWorker(
  deps: UnlinkDeps,
  connection: ConnectionOptions,
  prefix = QUEUE_PREFIX,
) {
  return new Worker(ACCOUNTS_QUEUE, (job) => processAccountJob(deps, job), {
    connection,
    prefix,
    concurrency: 1,
  });
}
