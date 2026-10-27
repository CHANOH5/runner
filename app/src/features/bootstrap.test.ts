import type { AppConfig, Me } from '@berun/shared';
import { ApiError } from '../api/client';
import { decideBoot, needsUpgrade, type BootDeps } from './bootstrap';

const cfg = (over: Partial<AppConfig> = {}): AppConfig => ({
  minNativeVersion: { ios: '1.0.0', android: '1.0.0' },
  maintenance: { active: false, until: null },
  supportEmail: null,
  privacyPolicyUrl: null,
  ...over,
});
const me = (pendingTerms: Me['pendingTerms'] = []) => ({ pendingTerms }) as Me;

const deps = (over: Partial<BootDeps> = {}): BootDeps => ({
  platform: 'ios',
  appVersion: '1.0.0',
  appConfig: () => Promise.resolve(cfg()),
  hasRefreshToken: () => Promise.resolve(true),
  refresh: () => Promise.resolve(true),
  me: () => Promise.resolve(me()),
  ...over,
});

describe('S-001 스플래시 판단 (PRD 6.1)', () => {
  it('최소 버전 미만 → 강제 업데이트 (웹은 검사하지 않음)', async () => {
    const appConfig = () =>
      Promise.resolve(cfg({ minNativeVersion: { ios: '1.2.0', android: '1.0.0' } }));
    expect(await decideBoot(deps({ appConfig }))).toEqual({ to: 'upgrade' });
    expect(await decideBoot(deps({ appConfig, platform: 'android' }))).toEqual({ to: 'home' });
    expect(
      needsUpgrade(cfg({ minNativeVersion: { ios: '9.0.0', android: '9.0.0' } }), 'web', '1.0.0'),
    ).toBe(false);
  });

  it('점검 중 → 점검 화면', async () => {
    const until = '2026-10-23T12:00:00+09:00';
    expect(
      await decideBoot(
        deps({ appConfig: () => Promise.resolve(cfg({ maintenance: { active: true, until } })) }),
      ),
    ).toEqual({
      to: 'maintenance',
      until,
    });
  });

  it('refresh token 없음·재발급 실패 → 로그인', async () => {
    expect(await decideBoot(deps({ hasRefreshToken: () => Promise.resolve(false) }))).toEqual({
      to: 'login',
    });
    expect(await decideBoot(deps({ refresh: () => Promise.resolve(false) }))).toEqual({
      to: 'login',
    });
  });

  it('필수 약관 새 버전 미동의 → 재동의', async () => {
    const pending = [
      { id: 'x', kind: 'service', version: 'v2', contentUrl: 'https://x.test', summary: null },
    ];
    expect(await decideBoot(deps({ me: () => Promise.resolve(me(pending)) }))).toEqual({
      to: 'reconsent',
    });
  });

  it('그 외 → 홈, 네트워크 오류 → 다시 시도 안내', async () => {
    expect(await decideBoot(deps())).toEqual({ to: 'home' });
    expect(
      await decideBoot(deps({ appConfig: () => Promise.reject(new ApiError(0, 'NETWORK')) })),
    ).toEqual({
      to: 'error',
      message: '인터넷 연결을 확인해주세요',
    });
  });
});
