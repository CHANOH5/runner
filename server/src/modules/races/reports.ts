import { REPORT_LIMIT_PER_RACE, REPORT_LIMIT_TOTAL, type ReportField } from '@berun/shared';
import { and, eq, gte } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import { raceReports } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { kstAt, kstDate } from '../../lib/time.js';
import { findVisibleRace } from './service.js';

/**
 * POST /races/{id}/reports — 대회 정보 오류 제보 (F-016, tech/06 6.9). 지난·취소 대회도 가능.
 * 한도: KST 하루 같은 대회 3건, 전체 10건 → 429 REPORT_LIMIT_DAILY (details.scope).
 * 처리는 관리자 제보 화면(A-004) → N-07.
 */
export async function createReport(
  db: Db,
  userId: string,
  raceId: string,
  req: { field: z.infer<typeof ReportField>; message: string },
  now = new Date(),
) {
  await findVisibleRace(db, raceId);
  const dayStart = kstAt(kstDate(now), '00:00');
  const mine = and(eq(raceReports.userId, userId), gte(raceReports.createdAt, dayStart));
  const [sameRace, total] = await Promise.all([
    db.$count(raceReports, and(mine, eq(raceReports.raceId, raceId))),
    db.$count(raceReports, mine),
  ]);
  if (sameRace >= REPORT_LIMIT_PER_RACE || total >= REPORT_LIMIT_TOTAL) {
    throw new AppError('REPORT_LIMIT_DAILY', 'daily report limit reached', {
      details: {
        scope: sameRace >= REPORT_LIMIT_PER_RACE ? 'race' : 'total',
        limit: sameRace >= REPORT_LIMIT_PER_RACE ? REPORT_LIMIT_PER_RACE : REPORT_LIMIT_TOTAL,
      },
    });
  }
  const [row] = await db
    .insert(raceReports)
    .values({ raceId, userId, field: req.field, message: req.message })
    .returning({ id: raceReports.id });
  return { id: row!.id };
}
