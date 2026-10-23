import { ApiError as ApiErrorSchema, type FieldError } from '@berun/shared';
import type { z } from 'zod';

/**
 * 관리자 API 호출 (tech/06 7장). 같은 출처(/api/admin/v1, Next.js rewrites)라 세션 쿠키가 자동으로 붙는다.
 * 상태 변경 요청에는 로그인·세션 확인 때 받은 CSRF 토큰을 X-CSRF-Token으로 보낸다.
 */
export const API_BASE = '/api/admin/v1';

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | undefined,
    readonly fieldErrors: FieldError[] | undefined,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(
  method: Method,
  path: string,
  opts: { body?: unknown; schema?: z.ZodType<T>; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'network error', undefined, undefined);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiError(res.status, e.code, e.message, e.details, e.fieldErrors);
    }
    throw new ApiError(
      res.status,
      res.status >= 500 ? 'INTERNAL' : 'UNKNOWN',
      'unexpected error',
      undefined,
      undefined,
    );
  }
  return opts.schema ? opts.schema.parse(json) : (json as T);
}

/** 쿼리스트링 (배열은 반복 키) */
export function qs(
  params: Record<string, string | number | boolean | string[] | undefined | null>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
