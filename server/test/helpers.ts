import { sql } from 'drizzle-orm';
import { exportSPKI, generateKeyPair, type CryptoKey } from 'jose';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { buildApp, type App } from '../src/app.js';
import type { Config } from '../src/config/env.js';
import { createDb, type Db } from '../src/db/client.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env.js';

export type TestContext = {
  app: App;
  db: Db;
  privateKey: CryptoKey;
  tokenFor: (userId: string) => Promise<string>;
  close: () => Promise<void>;
};

export async function createTestContext(
  overrides: { redisUrl?: string } = {},
): Promise<TestContext> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const config: Config = {
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    databaseUrl: TEST_DATABASE_URL,
    redisUrl: overrides.redisUrl ?? TEST_REDIS_URL,
    jwtPublicKey: await exportSPKI(publicKey),
  };
  const { db, client } = createDb(config.databaseUrl, { max: 2 });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  await redis.connect().catch(() => {});
  const app = await buildApp({ config, db, redis, logger: false });
  await app.ready();

  return {
    app,
    db,
    privateKey,
    tokenFor: (userId) => signAccessToken(privateKey, { userId, sessionId: uuidv7() }),
    close: async () => {
      await app.close();
      await client.end();
      redis.disconnect();
    },
  };
}

/** Phase 1 테이블 전부 비우기 (테스트 간 격리) */
export async function truncateAll(db: Db) {
  await db.execute(sql`
    DO $$ DECLARE t text;
    BEGIN
      FOR t IN SELECT tablename FROM pg_tables
               WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
      LOOP EXECUTE format('TRUNCATE TABLE %I CASCADE', t); END LOOP;
    END $$;
  `);
}
