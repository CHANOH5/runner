/** 게시된 예정 대회 전체의 알림 예약표를 다시 계산한다 (시드 후·운영 점검용). 사용: pnpm --filter @berun/server notifications:recalc */
import { and, eq, gte } from 'drizzle-orm';
import { loadDatabaseUrl } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { races } from '../src/db/schema/index.js';
import { kstDate } from '../src/lib/time.js';
import { recalculateSchedules } from '../src/modules/notifications/schedule.js';

const { db, client } = createDb(loadDatabaseUrl(), { max: 1 });
try {
  const now = new Date();
  const rows = await db
    .select({ id: races.id })
    .from(races)
    .where(and(eq(races.publishStatus, 'published'), gte(races.raceDate, kstDate(now))));
  for (const r of rows) {
    const res = await recalculateSchedules(db, r.id, now);
    console.warn(r.id, res);
  }
} finally {
  await client.end();
}
