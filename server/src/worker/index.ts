/**
 * 워커 프로세스 (tech/03 2장 Worker): 알림 발송 + 소셜 연결 해제. API 서버와 별도로 실행한다:
 *   pnpm --filter @berun/server worker
 */
import { Redis } from 'ioredis';
import pino from 'pino';
import { LOG_REDACT } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import {
  createRateLimiter,
  dryRunPushClient,
  expoPushClient,
} from '../modules/notifications/push.js';
import { loadTokenCipher } from '../lib/token-key.js';
import { dryRunUnlinkClient, httpUnlinkClient } from '../modules/auth/unlink-clients.js';
import { fakeEmailDormancyChannel, pushDormancyChannel } from '../modules/users/dormancy.js';
import { createAccountsQueue, createAccountsWorker, scheduleAccountJobs } from './accounts.js';
import { createNotificationQueue, createNotificationWorker, scheduleTick } from './queue.js';

const config = loadConfig();
const log = pino({ level: config.logLevel, name: 'worker', redact: LOG_REDACT });
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

// 소셜 연결 해제 (UNLINK_DRY_RUN이면 provider를 호출하지 않는다)
const unlinkDeps = {
  db,
  client: config.unlink.dryRun
    ? dryRunUnlinkClient
    : httpUnlinkClient({ kakaoAdminKey: config.unlink.kakaoAdminKey, apple: config.social.apple }),
  cipher: await loadTokenCipher(config.tokenKey),
  clock: () => new Date(),
  log,
  // 휴면 안내: 앱 푸시(알림 워커와 같은 클라이언트) + 이메일 자리(아직 발송 수단 없음)
  dormancyChannels: [
    pushDormancyChannel(db, push, () => new Date()),
    fakeEmailDormancyChannel(log),
  ],
};
if (config.unlink.dryRun) log.warn('UNLINK_DRY_RUN — social unlink calls are skipped');
const accountsQueue = createAccountsQueue(connection);
await scheduleAccountJobs(accountsQueue);
const accountsWorker = createAccountsWorker(unlinkDeps, connection);
accountsWorker.on('completed', (job, result) =>
  log.info({ job: job.name, result }, 'job completed'),
);
accountsWorker.on('failed', (job, err) => log.error({ job: job?.name, err }, 'job failed'));
log.info('notification worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  await Promise.allSettled([worker.close(), accountsWorker.close()]);
  await Promise.allSettled([queue.close(), accountsQueue.close()]);
  await Promise.allSettled([client.end({ timeout: 5 }), connection.quit()]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
