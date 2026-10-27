import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { loadTokenCipher } from './lib/token-key.js';
import { createNotificationQueue, enqueueRaceUpdated } from './worker/queue.js';

const config = loadConfig();
// 운영은 KMS로 데이터 키를 한 번 푼다 (실패하면 시작하지 않는다)
const cipher = await loadTokenCipher(config.tokenKey);
const { db, client } = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
await redis.connect();

// 관리자 대회 저장 → 알림 워커 큐 (BullMQ는 maxRetriesPerRequest = null 연결이 필요)
const queueConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const notificationQueue = createNotificationQueue(queueConnection);
const app = await buildApp({
  config,
  db,
  redis,
  cipher,
  raceUpdates: {
    raceUpdated: async (job) => {
      await enqueueRaceUpdated(notificationQueue, job);
    },
  },
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } finally {
    await notificationQueue.close();
    await Promise.allSettled([client.end({ timeout: 5 }), redis.quit(), queueConnection.quit()]);
    process.exit(0);
  }
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
