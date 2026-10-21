import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { appConfigs } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';

/** "1.2.10" < "1.10.0" 같은 숫자 비교. 형식이 다르면 null */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+(\.\d+){0,2}$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export type MinVersions = { ios: string; android: string };

/** app_configs의 최소 네이티브 버전 (짧게 캐시) */
export function minVersionLoader(app: FastifyInstance, ttlMs: number) {
  let cached: { at: number; value: MinVersions } | null = null;
  return async (): Promise<MinVersions> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const rows = await app.db
      .select()
      .from(appConfigs)
      .where(inArray(appConfigs.key, ['min_native_version_ios', 'min_native_version_android']));
    const get = (k: string) => {
      const v = rows.find((r) => r.key === k)?.value;
      return typeof v === 'string' ? v : '0.0.0';
    };
    const value = {
      ios: get('min_native_version_ios'),
      android: get('min_native_version_android'),
    };
    cached = { at: Date.now(), value };
    return value;
  };
}

/** 최소 앱 버전 미만이면 426 UPGRADE_REQUIRED (tech/06 6.1 이중 방어). 헤더가 없으면(앱 외 클라이언트) 통과 */
const EXEMPT = ['/health', '/v1/app-config', '/api/admin/'];

export function registerAppVersionCheck(app: FastifyInstance, ttlMs: number) {
  const load = minVersionLoader(app, ttlMs);
  app.addHook('onRequest', async (request) => {
    if (EXEMPT.some((p) => request.url.startsWith(p))) return;
    const version = request.headers['x-app-version'];
    const platform = request.headers['x-platform'];
    if (typeof version !== 'string' || (platform !== 'ios' && platform !== 'android')) return;
    const min = (await load())[platform];
    const cmp = compareVersions(version, min);
    if (cmp !== null && cmp < 0) {
      throw new AppError('UPGRADE_REQUIRED', 'app version is below the minimum', {
        details: { minVersion: min },
      });
    }
  });
}
