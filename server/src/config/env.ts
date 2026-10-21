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
});

export type Config = {
  env: z.infer<typeof Env>['NODE_ENV'];
  host: string;
  port: number;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  jwtPublicKey: string | undefined;
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
  };
}

export function loadDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  return parse(DatabaseEnv, source).DATABASE_URL;
}
