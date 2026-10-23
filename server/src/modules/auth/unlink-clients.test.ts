import { exportPKCS8, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { appleRevokeCall, kakaoUnlinkCall } from './unlink-clients.js';

/** 가짜 fetch: 실제 provider를 호출하지 않는다. 마지막 요청을 기록한다 */
function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return Object.assign(fn, { calls });
}
const failingFetch = () => Promise.reject(Object.assign(new Error('boom'), { name: 'TypeError' }));

describe('카카오 연결 끊기 응답 분류', () => {
  it('200 → done, 요청은 어드민 키 + 회원번호', async () => {
    const f = fakeFetch(200, { id: 123 });
    expect(await kakaoUnlinkCall('admin-key', f)('123')).toEqual({ kind: 'done' });
    expect(f.calls[0]!.url).toBe('https://kapi.kakao.com/v1/user/unlink');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'KakaoAK admin-key',
    );
    expect((f.calls[0]!.init.body as URLSearchParams).toString()).toBe(
      'target_id_type=user_id&target_id=123',
    );
  });

  it('-101(이미 연결 없음) → done, 5xx·429·네트워크·키 문제 → transient, 그 밖의 4xx → permanent', async () => {
    const run = (status: number, body: unknown) =>
      kakaoUnlinkCall('k', fakeFetch(status, body))('1');
    expect(await run(400, { code: -101 })).toEqual({ kind: 'done', note: 'already_unlinked' });
    expect(await run(503, {})).toEqual({ kind: 'transient', reason: 'kakao_http_503' });
    expect(await run(429, {})).toMatchObject({ kind: 'transient' });
    expect(await run(401, { code: -401 })).toEqual({
      kind: 'transient',
      reason: 'kakao_auth_-401',
    });
    expect(await run(400, { code: -2 })).toEqual({ kind: 'permanent', reason: 'kakao_400_-2' });
    expect(await kakaoUnlinkCall('k', failingFetch)('1')).toEqual({
      kind: 'transient',
      reason: 'network:TypeError',
    });
    expect(await kakaoUnlinkCall(undefined, fakeFetch(200))('1')).toEqual({
      kind: 'transient',
      reason: 'kakao_admin_key_missing',
    });
  });
});

describe('Apple 토큰 revoke 응답 분류', () => {
  let cfg: { clientId: string; teamId: string; keyId: string; privateKey: string };
  beforeAll(async () => {
    // 테스트 안에서만 쓰는 임시 키 (저장·커밋하지 않음)
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    cfg = {
      clientId: 'app.berun.test',
      teamId: 'TEAM',
      keyId: 'KEY',
      privateKey: await exportPKCS8(privateKey),
    };
  });

  it('200 → done, refresh token으로 revoke 요청', async () => {
    const f = fakeFetch(200);
    expect(await appleRevokeCall(cfg, f)('rt-1')).toEqual({ kind: 'done' });
    const body = new URLSearchParams((f.calls[0]!.init.body as URLSearchParams).toString());
    expect(f.calls[0]!.url).toBe('https://appleid.apple.com/auth/revoke');
    expect([body.get('token'), body.get('token_type_hint'), body.get('client_id')]).toEqual([
      'rt-1',
      'refresh_token',
      'app.berun.test',
    ]);
    expect(body.get('client_secret')).toMatch(/^ey/);
  });

  it('invalid_grant → done, 5xx·invalid_client·설정 없음 → transient, 그 밖의 400 → permanent', async () => {
    const run = (status: number, body: unknown) =>
      appleRevokeCall(cfg, fakeFetch(status, body))('rt');
    expect(await run(400, { error: 'invalid_grant' })).toEqual({
      kind: 'done',
      note: 'token_already_invalid',
    });
    expect(await run(500, {})).toEqual({ kind: 'transient', reason: 'apple_http_500' });
    expect(await run(401, { error: 'invalid_client' })).toEqual({
      kind: 'transient',
      reason: 'apple_invalid_client',
    });
    expect(await run(400, { error: 'invalid_request' })).toEqual({
      kind: 'permanent',
      reason: 'apple_400_invalid_request',
    });
    expect(await appleRevokeCall(null, fakeFetch(200))('rt')).toEqual({
      kind: 'transient',
      reason: 'apple_config_missing',
    });
  });
});

describe('로그 가림 (defense in depth)', () => {
  it('토큰·소셜 식별자 필드는 pino 로그에서 [Redacted]', async () => {
    const { default: pino } = await import('pino');
    const { LOG_REDACT } = await import('../../app.js');
    const lines: string[] = [];
    const log = pino({ redact: LOG_REDACT }, { write: (l: string) => void lines.push(l) });
    log.info(
      { job: { providerUid: '4242', revokeTokenEnc: 'abc' }, body: { refreshToken: 'rt-secret' } },
      'x',
    );
    expect(lines.join('')).not.toMatch(/4242|abc|rt-secret/);
    expect(lines.join('')).toContain('[Redacted]');
  });
});
