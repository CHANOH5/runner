import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';

const config = loadConfig();
const { db, client } = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
await redis.connect();

const app = await buildApp({ config, db, redis });

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } finally {
    await Promise.allSettled([client.end({ timeout: 5 }), redis.quit()]);
    process.exit(0);
  }
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
