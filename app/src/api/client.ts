import { ApiError as ApiErrorSchema, TokenPair, type FieldError } from '@berun/shared';
import type { z } from 'zod';

/**
 * API 클라이언트 (tech/06 1~3장).
 * - 공통 헤더(X-App-Version·X-Platform·X-Device-Id), access token 부착
 * - access token 만료(임박) 시 refresh token으로 갱신 (동시에 여러 요청이 와도 갱신은 1번, 회전 재사용 감지 대비)
 * - 401 UNAUTHENTICATED → 갱신 1회 후 재시도, 갱신 실패 → 토큰 삭제 + onAuthLost (PRD 3.4)
 * - 426 UPGRADE_REQUIRED · 403 TERMS_REQUIRED · 503 MAINTENANCE → onGate (강제 업데이트·재동의 화면)
 * - 응답은 공유 Zod 스키마로 검증한다
 */

/** 서버 에러 코드 + 앱 전용 코드 (NETWORK: 서버에 닿지 못함, INVALID_RESPONSE: 응답 스키마 불일치) */
export type ClientErrorCode = string;

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    readonly details: Record<string, unknown> = {},
    readonly fieldErrors: FieldError[] = [],
    readonly requestId: string | null = null,
  ) {
    super(code);
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export type Gate =
  | { kind: 'upgrade' }
  | { kind: 'terms'; kinds: string[] }
  | { kind: 'maintenance'; until: string | null };

export type StoredAccess = { token: string; expiresAt: number };

export type TokenStore = {
  getAccess(): StoredAccess | null;
  getRefreshToken(): Promise<string | null>;
  save(pair: TokenPair): Promise<void>;
  clear(): Promise<void>;
};

export type ClientDeps = {
  /** 예: http://localhost:3000/v1 (웹 개발은 같은 출처 /v1 → Metro 프록시) */
  baseUrl: string;
  fetch: typeof fetch;
  tokens: TokenStore;
  /** 공통 헤더 (앱 버전·플랫폼·기기 id) */
  headers: () => Promise<Record<string, string>>;
  onAuthLost?: (code: string) => void;
  onGate?: (gate: Gate) => void;
  now?: () => number;
};

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export type RequestOptions<S extends z.ZodType | undefined> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** 응답 스키마. 없으면 본문을 읽지 않는다 (204) */
  schema?: S;
  /** user = access token (기본) / none = 인증 없음 / { bearer } = 가입 토큰 등 직접 지정 */
  auth?: 'user' | 'none' | { bearer: string };
  idempotencyKey?: string;
};

/** 만료 30초 전부터는 미리 갱신한다 */
const REFRESH_LEEWAY_MS = 30_000;

/** 배열은 반복 키, 불리언은 'true'/'false', 빈 값은 뺀다 (tech/06 6.4) */
export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value as readonly (string | number)[]) params.append(key, String(v));
    } else {
      params.append(key, String(value as string | number | boolean));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(deps: ClientDeps) {
  const now = deps.now ?? Date.now;
  let refreshing: Promise<boolean> | null = null;

  async function send(
    opts: RequestOptions<z.ZodType | undefined>,
    bearer: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(await deps.headers()),
    };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    try {
      return await deps.fetch(`${deps.baseUrl}${opts.path}${buildQuery(opts.query)}`, {
        method: opts.method ?? 'GET',
        headers,
        body,
      });
    } catch {
      throw new ApiError(0, 'NETWORK');
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // 본문 없음
    }
    const parsed = ApiErrorSchema.safeParse(json);
    if (!parsed.success)
      return new ApiError(res.status, res.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
    const e = parsed.data.error;
    return new ApiError(
      res.status,
      e.code,
      e.details ?? {},
      e.fieldErrors ?? [],
      parsed.data.requestId,
    );
  }

  function notifyGate(err: ApiError) {
    if (err.code === 'UPGRADE_REQUIRED') deps.onGate?.({ kind: 'upgrade' });
    else if (err.code === 'TERMS_REQUIRED') {
      const kinds = Array.isArray(err.details.kinds) ? (err.details.kinds as string[]) : [];
      deps.onGate?.({ kind: 'terms', kinds });
    } else if (err.code === 'MAINTENANCE') {
      const until = typeof err.details.until === 'string' ? err.details.until : null;
      deps.onGate?.({ kind: 'maintenance', until });
    }
  }

  /**
   * refresh token으로 토큰 회전. 성공 true / 인증 실패(토큰 무효·재사용·정지) false → 토큰 삭제·onAuthLost.
   * 네트워크 오류는 토큰을 지우지 않고 그대로 던진다 (오프라인에서 로그아웃되지 않게).
   */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const refreshToken = await deps.tokens.getRefreshToken();
        if (!refreshToken) {
          await deps.tokens.clear();
          deps.onAuthLost?.('REFRESH_INVALID');
          return false;
        }
        const res = await send(
          { method: 'POST', path: '/auth/refresh', body: { refreshToken } },
          null,
        );
        if (!res.ok) {
          const err = await toError(res);
          if (res.status === 401 || res.status === 403) {
            await deps.tokens.clear();
            deps.onAuthLost?.(err.code);
            return false;
          }
          notifyGate(err);
          throw err;
        }
        await deps.tokens.save(TokenPair.parse(await res.json()));
        return true;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function validAccessToken(): Promise<string | null> {
    const access = deps.tokens.getAccess();
    if (access && access.expiresAt - REFRESH_LEEWAY_MS > now()) return access.token;
    const ok = await refresh();
    return ok ? (deps.tokens.getAccess()?.token ?? null) : null;
  }

  async function request<S extends z.ZodType | undefined = undefined>(
    opts: RequestOptions<S>,
  ): Promise<S extends z.ZodType ? z.output<S> : undefined> {
    const auth = opts.auth ?? 'user';
    let bearer: string | null = null;
    if (auth === 'user') {
      bearer = await validAccessToken();
      if (!bearer) throw new ApiError(401, 'UNAUTHENTICATED');
    } else if (auth !== 'none') {
      bearer = auth.bearer;
    }

    let res = await send(opts, bearer);
    if (res.status === 401 && auth === 'user') {
      const err = await toError(res);
      if (err.code !== 'UNAUTHENTICATED') throw err;
      if (!(await refresh())) throw err;
      res = await send(opts, deps.tokens.getAccess()?.token ?? null);
    }
    if (!res.ok) {
      const err = await toError(res);
      notifyGate(err);
      throw err;
    }
    if (!opts.schema || res.status === 204) {
      return undefined as S extends z.ZodType ? z.output<S> : undefined;
    }
    const parsed = opts.schema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(`[api] ${opts.path} 응답 스키마 불일치`, parsed.error.issues.slice(0, 3));
      throw new ApiError(res.status, 'INVALID_RESPONSE');
    }
    return parsed.data as S extends z.ZodType ? z.output<S> : undefined;
  }

  return { request, refresh };
}

export type ApiClient = ReturnType<typeof createApiClient>;
