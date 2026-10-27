import { z } from 'zod';
import type { TokenKeySource } from '../lib/token-key.js';

/** PEM의 줄바꿈을 .env 한 줄(\n)로 쓸 수 있게 한다 */
const pem = z
  .string()
  .transform((v) => v.replace(/\\n/g, '\n').trim())
  .pipe(z.string().startsWith('-----BEGIN'));

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const DatabaseEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export const Env = DatabaseEnv.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** access token(ES256) 검증 공개키. 없으면 인증이 필요한 API는 모두 401 */
  JWT_PUBLIC_KEY: z.preprocess(emptyToUndefined, pem.optional()),
  /** access token(ES256) 발급 개인키. 없으면 로그인·가입·토큰 회전이 500 (운영은 Secrets Manager) */
  JWT_PRIVATE_KEY: z.preprocess(emptyToUndefined, pem.optional()),
  /** Apple refresh token·관리자 TOTP 비밀키 저장 암호화 키 (AES-256-GCM, base64 32바이트). 로컬·테스트 전용 — 운영은 거부 */
  TOKEN_ENC_KEY: z.preprocess(
    emptyToUndefined,
    z
      .base64()
      .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes')
      .optional(),
  ),
  /**
   * 운영: KMS로 암호화된 데이터 키 (`aws kms generate-data-key-without-plaintext`의 CiphertextBlob, base64).
   * 시작할 때 KMS Decrypt로 한 번 푼다 (lib/token-key.ts, tech/07). 암호화 컨텍스트 app=berun, purpose=token-enc
   */
  TOKEN_ENC_KEY_KMS_CIPHERTEXT: z.preprocess(emptyToUndefined, z.base64().optional()),
  /** KMS 키 id·별칭 (선택. 대칭 키 Decrypt는 암호문에 키 정보가 있어 없어도 된다) */
  TOKEN_ENC_KMS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 소셜 로그인 (값이 없으면 그 provider는 비활성 → 로그인 시 500) */
  KAKAO_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 쉼표로 구분한 Google OAuth 클라이언트 id (iOS·Android·웹) */
  GOOGLE_CLIENT_IDS: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Apple: 앱 bundle id(= client_id), 팀 id, Sign in with Apple 키 id·개인키(PEM) */
  APPLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_TEAM_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_PRIVATE_KEY: z.preprocess(emptyToUndefined, pem.optional()),
  /** 카카오 연결 끊기(어드민 키). 없으면 카카오 연결 해제 작업은 일시 실패로 재시도된다 */
  KAKAO_ADMIN_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 연결 해제 워커: true면 provider를 호출하지 않고 성공으로 처리 (운영이 아니면 기본 true) */
  UNLINK_DRY_RUN: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  /** 알림 워커: true면 Expo로 보내지 않고 로그만 (운영이 아니면 기본 true) */
  PUSH_DRY_RUN: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  /** Expo "enhanced security"를 켰을 때만 필요한 access token */
  EXPO_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 워커 1개당 초당 발송 한도. Expo 프로젝트 한도 600/초를 워커 수로 나눈다 */
  EXPO_PUSH_RATE_PER_SEC: z.coerce.number().int().min(1).max(600).default(300),
  /**
   * 개발 전용 로그인 (T-025, tech/03 8장): true면 소셜 토큰 자리에 `dev:{이름}`을 받아 provider 호출 없이 통과시킨다.
   * 소셜 provider 키가 없는 로컬에서 앱을 확인하기 위한 것. 운영(production)에서는 켤 수 없다
   */
  DEV_LOGIN: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
});

export type SocialConfig = {
  kakao: { appId: string } | null;
  google: { clientIds: string[] } | null;
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string } | null;
};

export type Config = {
  env: z.infer<typeof Env>['NODE_ENV'];
  host: string;
  port: number;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  jwtPublicKey: string | undefined;
  jwtPrivateKey: string | undefined;
  /** 저장 암호화 키 출처. 로컬·테스트 env, 운영 kms (lib/token-key.ts) */
  tokenKey: TokenKeySource | null;
  social: SocialConfig;
  push: { dryRun: boolean; expoAccessToken: string | undefined; ratePerSec: number };
  unlink: { dryRun: boolean; kakaoAdminKey: string | undefined };
  /** 개발 전용 로그인 (`dev:{이름}` 토큰). production이면 항상 false — loadConfig가 거부한다 */
  devLogin: boolean;
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * 운영(ECS)은 RDS 비밀(Secrets Manager)의 필드를 DB_USER·DB_PASSWORD로, 주소를 DB_HOST·DB_PORT·DB_NAME으로 받는다.
 * 비밀번호가 든 URL을 평문 환경 변수로 두지 않기 위해서다 (infra app-stack). DATABASE_URL이 있으면 그것을 쓴다.
 * RDS는 rds.force_ssl=1이라 sslmode=require.
 */
function withDatabaseUrl(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.DATABASE_URL) return source;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = source;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return source;
  const auth = `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}`;
  return {
    ...source,
    DATABASE_URL: `postgres://${auth}@${DB_HOST}:${DB_PORT || '5432'}/${encodeURIComponent(DB_NAME)}?sslmode=require`,
  };
}

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(withDatabaseUrl(source));
  if (!result.success) {
    // 값은 출력하지 않는다 (비밀값 노출 방지)
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ConfigError(`환경 변수 검증 실패 — ${fields}`);
  }
  return result.data;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = parse(Env, source);
  if (env.DEV_LOGIN === 'true' && env.NODE_ENV === 'production') {
    throw new ConfigError('환경 변수 검증 실패 — DEV_LOGIN: 운영(production)에서는 켤 수 없다');
  }
  if (env.TOKEN_ENC_KEY && env.TOKEN_ENC_KEY_KMS_CIPHERTEXT) {
    throw new ConfigError(
      '환경 변수 검증 실패 — TOKEN_ENC_KEY와 TOKEN_ENC_KEY_KMS_CIPHERTEXT 중 하나만 쓴다',
    );
  }
  if (env.NODE_ENV === 'production') {
    if (env.TOKEN_ENC_KEY) {
      throw new ConfigError(
        '환경 변수 검증 실패 — TOKEN_ENC_KEY: 운영(production)에서는 평문 키를 쓸 수 없다 (KMS 사용)',
      );
    }
    if (!env.TOKEN_ENC_KEY_KMS_CIPHERTEXT) {
      throw new ConfigError('환경 변수 검증 실패 — TOKEN_ENC_KEY_KMS_CIPHERTEXT: 운영 필수');
    }
  }
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtPublicKey: env.JWT_PUBLIC_KEY,
    jwtPrivateKey: env.JWT_PRIVATE_KEY,
    tokenKey: env.TOKEN_ENC_KEY_KMS_CIPHERTEXT
      ? {
          kind: 'kms',
          ciphertextBase64: env.TOKEN_ENC_KEY_KMS_CIPHERTEXT,
          keyId: env.TOKEN_ENC_KMS_KEY_ID,
        }
      : env.TOKEN_ENC_KEY
        ? { kind: 'env', keyBase64: env.TOKEN_ENC_KEY }
        : null,
    devLogin: env.DEV_LOGIN === 'true',
    unlink: {
      dryRun: env.UNLINK_DRY_RUN ? env.UNLINK_DRY_RUN === 'true' : env.NODE_ENV !== 'production',
      kakaoAdminKey: env.KAKAO_ADMIN_KEY,
    },
    push: {
      dryRun: env.PUSH_DRY_RUN ? env.PUSH_DRY_RUN === 'true' : env.NODE_ENV !== 'production',
      expoAccessToken: env.EXPO_ACCESS_TOKEN,
      ratePerSec: env.EXPO_PUSH_RATE_PER_SEC,
    },
    social: {
      kakao: env.KAKAO_APP_ID ? { appId: env.KAKAO_APP_ID } : null,
      google: env.GOOGLE_CLIENT_IDS
        ? {
            clientIds: env.GOOGLE_CLIENT_IDS.split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : null,
      apple:
        env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
          ? {
              clientId: env.APPLE_CLIENT_ID,
              teamId: env.APPLE_TEAM_ID,
              keyId: env.APPLE_KEY_ID,
              privateKey: env.APPLE_PRIVATE_KEY,
            }
          : null,
    },
  };
}

export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  return parse(DatabaseEnv, source).DATABASE_URL;
}
