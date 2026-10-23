import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  processUnlinkJobs,
  purgeStaleUnlinkJobs,
  type UnlinkDeps,
} from '../modules/auth/unlink-worker.js';
import { runDormancyBatch, type DormancyNoticeChannel } from '../modules/users/dormancy.js';
import { QUEUE_PREFIX } from './queue.js';

/**
 * 계정 작업 큐 (BullMQ). 알림 큐와 같은 워커 프로세스에서 돈다.
 * - unlink: 1분마다 실행 시각이 된 소셜 연결 해제 작업 처리
 * - unlink-retention: 매일 04:20 KST, 7일 지난 작업의 식별자·토큰 정리 + 최종 실패 기록 1년 파기 (deletion_jobs)
 * - dormancy: 매일 10:00 KST, 휴면 30일 전 안내·휴면 전환 (P-RET-03). 안내 푸시가 새벽에 가지 않게 오전에 돈다
 */
export type AccountsDeps = UnlinkDeps & { dormancyChannels: DormancyNoticeChannel[] };
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
  await queue.upsertJobScheduler(
    'accounts-dormancy',
    { pattern: '0 10 * * *', tz: 'Asia/Seoul' },
    { name: 'dormancy' },
  );
}

export async function processAccountJob(deps: AccountsDeps, job: Pick<Job, 'name'>) {
  switch (job.name) {
    case 'unlink':
      return processUnlinkJobs(deps);
    case 'unlink-retention':
      return purgeStaleUnlinkJobs(deps.db, deps.clock());
    case 'dormancy':
      return runDormancyBatch({
        db: deps.db,
        channels: deps.dormancyChannels,
        clock: deps.clock,
        log: deps.log,
      });
    default:
      throw new Error(`unknown job ${job.name}`);
  }
}

export function createAccountsWorker(
  deps: AccountsDeps,
  connection: ConnectionOptions,
  prefix = QUEUE_PREFIX,
) {
  return new Worker(ACCOUNTS_QUEUE, (job) => processAccountJob(deps, job), {
    connection,
    prefix,
    concurrency: 1,
  });
}
