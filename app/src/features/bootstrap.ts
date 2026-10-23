import type { AppConfig, Me } from '@berun/shared';
import { ApiError } from '../api/client';
import { compareVersions } from '../lib/device';

/**
 * S-001 스플래시 판단 (PRD 6.1, tech/06 10장): app-config → refresh → GET /me(pendingTerms)
 */
export type BootTarget =
  | { to: 'upgrade' }
  | { to: 'maintenance'; until: string | null }
  | { to: 'login' }
  | { to: 'reconsent' }
  | { to: 'home' }
  | { to: 'error'; message: string };

export type BootDeps = {
  platform: 'ios' | 'android' | 'web';
  appVersion: string;
  appConfig: () => Promise<AppConfig>;
  hasRefreshToken: () => Promise<boolean>;
  /** 성공 true, 인증 실패 false (네트워크 오류는 throw) */
  refresh: () => Promise<boolean>;
  me: () => Promise<Me>;
};

const isNetwork = (e: unknown) => e instanceof ApiError && e.code === 'NETWORK';

/** 최소 지원 버전 미만인가 (웹은 네이티브 버전이 없어 검사하지 않는다) */
export function needsUpgrade(cfg: AppConfig, platform: BootDeps['platform'], version: string) {
  if (platform === 'web') return false;
  const cmp = compareVersions(version, cfg.minNativeVersion[platform]);
  return cmp !== null && cmp < 0;
}

export async function decideBoot(deps: BootDeps): Promise<BootTarget> {
  try {
    // 1. 최소 지원 버전·점검
    const cfg = await deps.appConfig();
    if (needsUpgrade(cfg, deps.platform, deps.appVersion)) return { to: 'upgrade' };
    if (cfg.maintenance.active) return { to: 'maintenance', until: cfg.maintenance.until };
    // 2. refresh token 없음 → 로그인
    if (!(await deps.hasRefreshToken())) return { to: 'login' };
    // 3. 토큰 재발급 실패 → 로그인
    if (!(await deps.refresh())) return { to: 'login' };
    // 4. 필수 약관 새 버전 미동의 → 재동의
    const me = await deps.me();
    if (me.pendingTerms.length > 0) return { to: 'reconsent' };
    return { to: 'home' };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UPGRADE_REQUIRED') return { to: 'upgrade' };
    if (e instanceof ApiError && e.code === 'TERMS_REQUIRED') return { to: 'reconsent' };
    if (e instanceof ApiError && (e.code === 'UNAUTHENTICATED' || e.status === 401)) {
      return { to: 'login' };
    }
    return {
      to: 'error',
      message: isNetwork(e) ? '인터넷 연결을 확인해주세요' : '잠시 문제가 생겼어요',
    };
  }
}
