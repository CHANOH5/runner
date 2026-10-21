import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { exportPKCS8, exportSPKI, generateKeyPair, type CryptoKey } from 'jose';
import { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { buildApp, type App } from '../src/app.js';
import type { Config } from '../src/config/env.js';
import { createDb, type Db } from '../src/db/client.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';
import {
  socialTokenInvalid,
  type SocialVerifier,
  type SocialVerifiers,
} from '../src/modules/auth/verifiers.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env.js';

export type TestContext = {
  app: App;
  db: Db;
  redis: Redis;
  privateKey: CryptoKey;
  tokenFor: (userId: string) => Promise<string>;
  close: () => Promise<void>;
};

/**
 * 가짜 소셜 verifier. 토큰 형식: "{uid}" 또는 "{uid}|{email}". "bad"는 검증 실패.
 * Apple은 authorizationCode를 교환한 것처럼 `apple-refresh-{uid}`를 돌려준다.
 */
export function fakeVerifiers(): SocialVerifiers {
  const make = (provider: 'kakao' | 'apple' | 'google'): SocialVerifier => ({
    verify(req) {
      const token =
        req.provider === 'kakao'
          ? req.accessToken
          : req.provider === 'apple'
            ? req.identityToken
            : req.idToken;
      if (req.provider !== provider || token === 'bad') return Promise.reject(socialTokenInvalid());
      const [uid, email] = token.split('|');
      return Promise.resolve({
        provider,
        providerUid: uid!,
        email: email ?? null,
        ...(provider === 'apple' && { appleRefreshToken: `apple-refresh-${uid}` }),
      });
    },
  });
  return { kakao: make('kakao'), apple: make('apple'), google: make('google') };
}

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
    jwtPrivateKey: await exportPKCS8(privateKey),
    tokenEncKey: randomBytes(32).toString('base64'),
    social: { kakao: null, google: null, apple: null },
    push: { dryRun: true, expoAccessToken: undefined, ratePerSec: 600 },
  };
  const { db, client } = createDb(config.databaseUrl, { max: 4 });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  await redis.connect().catch(() => {});
  const app = await buildApp({
    config,
    db,
    redis,
    logger: false,
    verifiers: fakeVerifiers(),
    configCacheMs: 0,
  });
  await app.ready();

  return {
    app,
    db,
    redis,
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
