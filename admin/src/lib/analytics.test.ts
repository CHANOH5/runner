import { describe, expect, it, vi } from 'vitest';
import { createAdminAnalytics, sanitizeProps } from './analytics';

describe('관리자 분석 (D-017, P-PRI-08)', () => {
  it('키가 없거나 로그인 전이면 보내지 않는다', () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}')));
    const off = createAdminAnalytics({ apiKey: undefined, host: 'https://p.test', fetch });
    off.identify('a1');
    off.track('admin_logged_in', { role: 'owner' });
    const on = createAdminAnalytics({ apiKey: 'k', host: 'https://p.test', fetch });
    on.track('admin_logged_in', { role: 'owner' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('관리자 id만 식별자로, 이메일·이름 등은 걸러낸다', () => {
    const fetchMock = vi.fn((_u: string, _i: RequestInit) => Promise.resolve(new Response('{}')));
    const a = createAdminAnalytics({
      apiKey: 'k',
      host: 'https://p.test/',
      fetch: fetchMock as unknown as typeof fetch,
    });
    a.identify('a1');
    a.track('admin_notice_test_sent', {
      notice_id: 'n1',
      email: 'owner@example.com',
      adminName: '홍길동',
      memo: 'owner@example.com',
    } as never);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://p.test/capture/');
    const body = JSON.parse(init.body as string) as { distinct_id: string; properties: object };
    expect(body.distinct_id).toBe('admin:a1');
    expect(body.properties).toEqual({ notice_id: 'n1', $lib: 'berun-admin' });
  });

  it('sanitizeProps: 비밀값·좌표 키도 뺀다', () => {
    expect(sanitizeProps({ totp: '123456', csrfToken: 'x', venue_lat: 1, kind: 'notice' })).toEqual(
      {
        kind: 'notice',
      },
    );
  });
});
