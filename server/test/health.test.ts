import { ApiError, HealthResponse } from '@berun/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

describe('GET /health', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('DB·Redis가 살아 있으면 200 ok', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({
      status: 'ok',
      checks: { db: 'ok', redis: 'ok' },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('요청 X-Request-Id를 그대로 돌려준다', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-from-client' },
    });
    expect(res.headers['x-request-id']).toBe('req-from-client');
  });

  it('없는 경로는 404 NOT_FOUND 에러 형식', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('GET /health — Redis 장애', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    // 아무것도 듣지 않는 포트
    ctx = await createTestContext({ redisUrl: 'redis://127.0.0.1:1' });
  });
  afterAll(() => ctx.close());

  it('의존성 하나라도 실패하면 503', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { db: 'ok', redis: 'error' } });
  });
});
