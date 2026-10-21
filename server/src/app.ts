import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import type { Config } from './config/env.js';
import type { Db } from './db/client.js';
import adminRoutes from './modules/admin/index.js';
import authRoutes from './modules/auth/index.js';
import healthRoutes from './modules/health/index.js';
import notificationRoutes from './modules/notifications/index.js';
import predictionRoutes from './modules/predictions/index.js';
import raceRoutes from './modules/races/index.js';
import recordRoutes from './modules/records/index.js';
import registrationRoutes from './modules/registrations/index.js';
import userRoutes from './modules/users/index.js';
import { authPlugin } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    redis: Redis;
  }
}

export type AppDeps = {
  config: Config;
  db: Db;
  redis: Redis;
  /** 테스트에서 로그를 끄거나 바꿀 때 */
  logger?: FastifyServerOptions['logger'];
};

/** 요청 본문 최대 64KB (tech/06 1장) */
const BODY_LIMIT = 64 * 1024;

function defaultLogger(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // 토큰·쿠키는 로그에 남기지 않는다. 위치 좌표·이메일도 로그에 쓰지 않는다 (P-PRI-08 취지)
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-device-id"]'],
    ...(config.env === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  };
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? defaultLogger(deps.config),
    bodyLimit: BODY_LIMIT,
    requestIdHeader: 'x-request-id',
    genReqId: () => uuidv7(),
  });

  app.decorate('config', deps.config);
  app.decorate('db', deps.db);
  app.decorate('redis', deps.redis);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(authPlugin, { publicKeyPem: deps.config.jwtPublicKey });

  await app.register(healthRoutes);

  // 앱 API (tech/06 6장)
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(userRoutes);
      await v1.register(raceRoutes);
      await v1.register(registrationRoutes);
      await v1.register(recordRoutes);
      await v1.register(predictionRoutes);
      await v1.register(notificationRoutes);
    },
    { prefix: '/v1' },
  );

  // 관리자 API (tech/06 7장)
  await app.register(adminRoutes, { prefix: '/api/admin/v1' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
