import { Me } from '@berun/shared';
import {
  ApiError,
  buildQuery,
  createApiClient,
  type Gate,
  type StoredAccess,
  type TokenStore,
} from './client';

type Call = { url: string; init: RequestInit };

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const apiError = (status: number, code: string, details?: object) =>
  json(status, { error: { code, message: code, ...(details && { details }) }, requestId: 'req-1' });

const pair = (n: number, expiresInMs = 15 * 60_000) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
});

function memoryTokens(initial: { access?: StoredAccess | null; refresh?: string | null } = {}) {
  let access = initial.access ?? null;
  let refresh = initial.refresh ?? null;
  const store: TokenStore & { refreshValue: () => string | null } = {
    getAccess: () => access,
    getRefreshToken: () => Promise.resolve(refresh),
    save: (p) => {
      access = { token: p.accessToken, expiresAt: new Date(p.accessTokenExpiresAt).getTime() };
      refresh = p.refreshToken;
      return Promise.resolve();
    },
    clear: () => {
      access = null;
      refresh = null;
      return Promise.resolve();
    },
    refreshValue: () => refresh,
  };
  return store;
}

function setup(
  handler: (call: Call) => Response | Promise<Response>,
  tokens = memoryTokens({
    access: { token: 'access-0', expiresAt: Date.now() + 600_000 },
    refresh: 'refresh-0',
  }),
) {
  const calls: Call[] = [];
  const onAuthLost = jest.fn();
  const gates: Gate[] = [];
  const client = createApiClient({
    baseUrl: 'http://api.test/v1',
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch,
    tokens,
    headers: () =>
      Promise.resolve({ 'x-app-version': '1.0.0', 'x-platform': 'ios', 'x-device-id': 'dev-1' }),
    onAuthLost,
    onGate: (g) => gates.push(g),
  });
  return { client, calls, onAuthLost, gates, tokens };
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const ME = {
  id: '0199f000-0000-7000-8000-000000000001',
  nickname: '러너',
  nicknameChangeAvailableAt: null,
  birthYear: 1990,
  regionCode: 'seoul',
  gender: null,
  runningSince: null,
  provider: 'kakao',
  pendingTerms: [],
  counts: { interested: 0, upcoming: 0, past: 0 },
};

describe('buildQuery', () => {
  it('배열은 반복 키, 불리언은 문자열, 빈 값은 뺀다', () => {
    expect(
      buildQuery({ region: ['seoul', 'busan'], includeEnded: true, q: undefined, cursor: null }),
    ).toBe('?region=seoul&region=busan&includeEnded=true');
    expect(buildQuery({})).toBe('');
  });
});

describe('createApiClient', () => {
  it('공통 헤더와 access token을 붙이고 응답을 공유 스키마로 검증한다', async () => {
    const { client, calls } = setup(() => json(200, ME));
    const me = await client.request({ path: '/me', schema: Me });
    expect(me.nickname).toBe('러너');
    expect(calls[0]!.url).toBe('http://api.test/v1/me');
    expect(header(calls[0]!, 'authorization')).toBe('Bearer access-0');
    expect(header(calls[0]!, 'x-device-id')).toBe('dev-1');
  });

  it('401 UNAUTHENTICATED → refresh 1회 후 새 토큰으로 재시도', async () => {
    const { client, calls, tokens } = setup(({ url, init }) => {
      if (url.endsWith('/auth/refresh')) return json(200, pair(1));
      const auth = (init.headers as Record<string, string>).authorization;
      return auth === 'Bearer access-1' ? json(200, ME) : apiError(401, 'UNAUTHENTICATED');
    });
    await client.request({ path: '/me', schema: Me });
    expect(calls.map((c) => c.url.replace('http://api.test/v1', ''))).toEqual([
      '/me',
      '/auth/refresh',
      '/me',
    ]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ refreshToken: 'refresh-0' });
    expect(tokens.refreshValue()).toBe('refresh-1');
  });

  it('동시에 여러 요청이 만료돼도 refresh는 한 번만 (회전 재사용 감지 방지)', async () => {
    const tokens = memoryTokens({
      access: { token: 'old', expiresAt: Date.now() - 1 },
      refresh: 'refresh-0',
    });
    const { client, calls } = setup(
      ({ url }) => (url.endsWith('/auth/refresh') ? json(200, pair(1)) : json(200, ME)),
      tokens,
    );
    await Promise.all([1, 2, 3].map(() => client.request({ path: '/me', schema: Me })));
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(
      calls
        .filter((c) => c.url.endsWith('/me'))
        .every((c) => header(c, 'authorization') === 'Bearer access-1'),
    ).toBe(true);
  });

  it('만료 30초 전이면 요청 전에 미리 갱신한다', async () => {
    const tokens = memoryTokens({
      access: { token: 'soon', expiresAt: Date.now() + 10_000 },
      refresh: 'refresh-0',
    });
    const { client, calls } = setup(
      ({ url }) => (url.endsWith('/auth/refresh') ? json(200, pair(1)) : json(200, ME)),
      tokens,
    );
    await client.request({ path: '/me', schema: Me });
    expect(calls[0]!.url).toMatch(/auth\/refresh$/);
  });

  it('refresh 실패(재사용 감지 등) → 토큰 삭제 + onAuthLost, 원래 401을 던진다', async () => {
    const { client, onAuthLost, tokens } = setup(({ url }) =>
      url.endsWith('/auth/refresh')
        ? apiError(401, 'REFRESH_REUSED')
        : apiError(401, 'UNAUTHENTICATED'),
    );
    await expect(client.request({ path: '/me', schema: Me })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(onAuthLost).toHaveBeenCalledWith('REFRESH_REUSED');
    expect(tokens.refreshValue()).toBeNull();
  });

  it('refresh 중 네트워크 오류는 토큰을 지우지 않는다 (오프라인 로그아웃 방지)', async () => {
    const tokens = memoryTokens({ access: null, refresh: 'refresh-0' });
    const { client, onAuthLost } = setup(() => {
      throw new TypeError('Network request failed');
    }, tokens);
    await expect(client.request({ path: '/me', schema: Me })).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(tokens.refreshValue()).toBe('refresh-0');
  });

  it('426·403 TERMS_REQUIRED·503은 게이트를 알린다', async () => {
    const responses = [
      apiError(426, 'UPGRADE_REQUIRED', { minVersion: '1.1.0' }),
      apiError(403, 'TERMS_REQUIRED', { kinds: ['service'] }),
      apiError(503, 'MAINTENANCE', { until: '2026-10-23T12:00:00+09:00' }),
    ];
    const { client, gates } = setup(() => responses.shift()!);
    for (let i = 0; i < 3; i++)
      await expect(client.request({ path: '/me' })).rejects.toBeInstanceOf(ApiError);
    expect(gates).toEqual([
      { kind: 'upgrade' },
      { kind: 'terms', kinds: ['service'] },
      { kind: 'maintenance', until: '2026-10-23T12:00:00+09:00' },
    ]);
  });

  it('에러 본문의 code·details·fieldErrors를 그대로 넘긴다', async () => {
    const { client } = setup(() =>
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          fieldErrors: [{ path: 'goalTimeSec', code: 'required' }],
        },
        requestId: 'r-9',
      }),
    );
    const err = (await client
      .request({ method: 'POST', path: '/x', body: {} })
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'r-9' });
    expect(err.fieldErrors).toEqual([{ path: 'goalTimeSec', code: 'required' }]);
  });

  it('응답이 스키마와 다르면 INVALID_RESPONSE', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = setup(() => json(200, { nickname: 1 }));
    await expect(client.request({ path: '/me', schema: Me })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    warn.mockRestore();
  });

  it('가입 토큰 등 직접 지정한 bearer는 갱신하지 않는다, 멱등 키 헤더', async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));
    await client.request({
      method: 'POST',
      path: '/auth/signup/abort',
      auth: { bearer: 'signup-1' },
      idempotencyKey: 'k-1',
    });
    expect(header(calls[0]!, 'authorization')).toBe('Bearer signup-1');
    expect(header(calls[0]!, 'idempotency-key')).toBe('k-1');
    expect(calls).toHaveLength(1);
  });
});
