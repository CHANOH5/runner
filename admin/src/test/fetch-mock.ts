import { vi } from 'vitest';

export type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };
type Reply = { status?: number; body?: unknown };
type Handler = (call: Call) => Reply | undefined;

/** fetch를 경로별 응답으로 바꾸고 호출 기록을 돌려준다 */
export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? 'GET',
        path: url.replace('/api/admin/v1', ''),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, body: apiError('NOT_FOUND') };
      return Promise.resolve(
        new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
          status: reply.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}

export const apiError = (code: string, extra: Record<string, unknown> = {}) => ({
  error: { code, message: code, ...extra },
  requestId: 'req-test',
});
