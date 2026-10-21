/**
 * 알림 워커 프로세스 (tech/03 2장 Worker). API 서버와 별도로 실행한다:
 *   pnpm --filter @berun/server worker
 */
import { Redis } from 'ioredis';
import pino from 'pino';
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import {
  createRateLimiter,
  dryRunPushClient,
  expoPushClient,
} from '../modules/notifications/push.js';
import { createNotificationQueue, createNotificationWorker, scheduleTick } from './queue.js';

const config = loadConfig();
const log = pino({ level: config.logLevel, name: 'notification-worker' });
const { db, client } = createDb(config.databaseUrl, { max: 4 });
// BullMQ는 maxRetriesPerRequest = null 연결이 필요하다
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const push = config.push.dryRun
  ? dryRunPushClient(log)
  : expoPushClient({ accessToken: config.push.expoAccessToken });
if (config.push.dryRun) log.warn('PUSH_DRY_RUN — pushes are logged, not sent');

const deps = {
  db,
  push,
  limiter: createRateLimiter(config.push.ratePerSec),
  clock: () => new Date(),
};
const queue = createNotificationQueue(connection);
await scheduleTick(queue);
const worker = createNotificationWorker(deps, connection);
worker.on('completed', (job, result) => log.info({ job: job.name, result }, 'job completed'));
worker.on('failed', (job, err) => log.error({ job: job?.name, err }, 'job failed'));
log.info('notification worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await worker.close();
  await queue.close();
  await Promise.allSettled([client.end({ timeout: 5 }), connection.quit()]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
