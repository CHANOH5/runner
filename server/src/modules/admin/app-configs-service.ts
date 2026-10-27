import { APP_CONFIG_VALUES, type AppConfigKey } from '@berun/shared';
import { asc, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { appConfigs } from '../../db/schema/index.js';
import { validationFailed } from '../../lib/errors.js';
import { toKstIso } from '../../lib/time.js';

type Row = typeof appConfigs.$inferSelect;
const toDto = (r: Row) => ({ key: r.key, value: r.value, updatedAt: toKstIso(r.updatedAt) });

/** GET /app-configs (tech/06 7.7) */
export async function listAppConfigs(db: Db) {
  return (await db.select().from(appConfigs).orderBy(asc(appConfigs.key))).map(toDto);
}

/**
 * PUT /app-configs/{key} — 키별 형식(APP_CONFIG_VALUES)으로 검사한 뒤 저장. owner만 (라우트에서 검사).
 * 앱 `GET /app-config`는 CDN 5분, 최소 버전 검사는 서버 30초 캐시라 바로 반영되지 않을 수 있다.
 */
export async function putAppConfig(db: Db, adminId: string, key: AppConfigKey, value: unknown) {
  const parsed = APP_CONFIG_VALUES[key].safeParse(value);
  if (!parsed.success) throw validationFailed([{ path: 'value', code: 'invalid_value' }]);
  // jsonb NOT NULL 컬럼이라 null도 JSON null로 저장한다 (앱 설정에서는 "값 없음"과 같다)
  const stored = parsed.data === null ? sql`'null'::jsonb` : parsed.data;
  const [row] = await db
    .insert(appConfigs)
    .values({ key, value: stored, updatedBy: adminId })
    .onConflictDoUpdate({
      target: appConfigs.key,
      set: { value: stored, updatedBy: adminId, updatedAt: new Date() },
    })
    .returning();
  return toDto(row!);
}
