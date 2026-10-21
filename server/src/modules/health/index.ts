import { HealthResponse } from '@berun/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const CHECK_TIMEOUT_MS = 1000;

async function check(fn: () => Promise<unknown>): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([fn(), timeout]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** 로드밸런서·배포 헬스 체크. 인증 없음, /v1 밖 */
export default async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: { response: { 200: HealthResponse, 503: HealthResponse } },
      logLevel: 'warn',
    },
    async (_request, reply) => {
      const [db, redis] = await Promise.all([
        check(() => app.db.execute(sql`select 1`)),
        check(() => app.redis.ping()),
      ]);
      const status = db === 'ok' && redis === 'ok' ? 'ok' : 'error';
      return reply
        .status(status === 'ok' ? 200 : 503)
        .header('cache-control', 'no-store')
        .send({ status, checks: { db, redis } });
    },
  );
}
