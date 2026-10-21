import type { HomeDeadlines } from '@berun/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { races } from '../../db/schema/index.js';
import { ENTRY_ALERT_AUDIENCE } from '../../lib/entry-alert-audience.js';
import { effectiveWindow, eventClosesAt } from '../../lib/registration-window.js';
import { toKstIso } from '../../lib/time.js';
import { loadRaceContext, toRaceSummary } from '../races/summary.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPENS_WITHIN_MS = 7 * DAY_MS;
const CLOSES_WITHIN_MS = 3 * DAY_MS;
const MAX_ITEMS = 5;

/**
 * GET /home/deadlines — 접수 임박 (PRD v1.5 6.7 ③, tech/06 6.5).
 * 대상: 관심만 ∪ 참가 예정 `not_registered` (접수 알림 N-01~N-03과 같은 조건, ENTRY_ALERT_AUDIENCE).
 * 행: 7일 안 오픈 / 3일 안 마감. 마감 시각은 참가 예정자면 고른 종목 마감 → 없으면 유효 마감 (N-03과 같음).
 */
export async function homeDeadlines(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<HomeDeadlines> {
  const audience = await db.execute<{ race_id: string; race_event_id: string | null }>(sql`
    SELECT coalesce(i.race_id, r.race_id) AS race_id, r.race_event_id
    FROM (SELECT * FROM race_interests WHERE user_id = ${userId}) i
    FULL JOIN (SELECT * FROM race_registrations WHERE user_id = ${userId}) r
      ON r.race_id = i.race_id
    WHERE ${ENTRY_ALERT_AUDIENCE}
  `);
  if (audience.length === 0) return { items: [] };
  const chosenEvent = new Map(audience.map((a) => [a.race_id, a.race_event_id]));

  const rows = await db
    .select()
    .from(races)
    .where(and(inArray(races.id, [...chosenEvent.keys()]), eq(races.publishStatus, 'published')));
  const ctx = await loadRaceContext(
    db,
    rows.map((r) => r.id),
    userId,
  );

  const items: HomeDeadlines['items'] = [];
  for (const race of rows) {
    const summary = toRaceSummary(race, ctx, now);
    if (summary.registrationState === 'cancelled' || summary.registrationState === 'ended')
      continue;
    const events = ctx.eventsByRace.get(race.id) ?? [];
    const window = effectiveWindow(race, events);

    if (
      summary.registrationState === 'upcoming' &&
      window.opensAt &&
      window.opensAt.getTime() - now.getTime() <= OPENS_WITHIN_MS
    ) {
      items.push({
        race: summary,
        type: 'opens',
        at: toKstIso(window.opensAt),
        timeKnown: race.registrationOpensTimeKnown,
      });
    }

    const eventId = chosenEvent.get(race.id);
    const event = eventId ? events.find((e) => e.id === eventId) : undefined;
    const closesAt = event ? eventClosesAt(event, window) : window.closesAt;
    const opened = window.opensAt === null || window.opensAt <= now;
    if (
      closesAt &&
      opened &&
      closesAt > now &&
      closesAt.getTime() - now.getTime() <= CLOSES_WITHIN_MS
    ) {
      items.push({ race: summary, type: 'closes', at: toKstIso(closesAt), timeKnown: true });
    }
  }

  items.sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.race.name.localeCompare(b.race.name),
  );
  return { items: items.slice(0, MAX_ITEMS) };
}
