import { z } from 'zod';

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
  /** Apple refresh token 등 저장 암호화 키 (AES-256-GCM, base64 32바이트). 운영은 KMS로 교체 예정 */
  TOKEN_ENC_KEY: z.preprocess(
    emptyToUndefined,
    z
      .base64()
      .refine((v) => Buffer.from(v, 'base64').length === 32, '32 bytes')
      .optional(),
  ),
  /** 소셜 로그인 (값이 없으면 그 provider는 비활성 → 로그인 시 500) */
  KAKAO_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  /** 쉼표로 구분한 Google OAuth 클라이언트 id (iOS·Android·웹) */
  GOOGLE_CLIENT_IDS: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Apple: 앱 bundle id(= client_id), 팀 id, Sign in with Apple 키 id·개인키(PEM) */
  APPLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_TEAM_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  APPLE_PRIVATE_KEY: z.preprocess(emptyToUndefined, pem.optional()),
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
  tokenEncKey: string | undefined;
  social: SocialConfig;
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // 값은 출력하지 않는다 (비밀값 노출 방지)
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ConfigError(`환경 변수 검증 실패 — ${fields}`);
  }
  return result.data;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = parse(Env, source);
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtPublicKey: env.JWT_PUBLIC_KEY,
    jwtPrivateKey: env.JWT_PRIVATE_KEY,
    tokenEncKey: env.TOKEN_ENC_KEY,
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
