import type {
  DistanceCategory,
  HomeDeadlines,
  HomeNextRace,
  HomeRecommended,
  RegionCode,
} from '@berun/shared';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  raceEvents,
  raceRegistrations,
  races,
  runRecords,
  userProfiles,
} from '../../db/schema/index.js';
import { ENTRY_ALERT_AUDIENCE } from '../../lib/entry-alert-audience.js';
import { effectiveWindow, eventClosesAt } from '../../lib/registration-window.js';
import { addDays, kstDate, toKstIso } from '../../lib/time.js';
import { loadRaceContext, registrationBriefFor, toRaceSummary } from '../races/summary.js';

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

/**
 * GET /home/next-race — 대회일 ≥ 오늘인 참가 예정(접수 못 함 제외) 중 가장 빠른 것 (PRD v1.9 6.7 ②).
 * 같은 날이면 출발 시각 → 대회명 순. 숨김·초안 대회는 제외. 접수 상태 배지는 registration.entryStatus.
 */
export async function homeNextRace(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<HomeNextRace> {
  const today = kstDate(now);
  const rows = await db
    .select({ race: races, event: raceEvents })
    .from(raceRegistrations)
    .innerJoin(races, eq(races.id, raceRegistrations.raceId))
    .innerJoin(raceEvents, eq(raceEvents.id, raceRegistrations.raceEventId))
    .where(
      and(
        eq(raceRegistrations.userId, userId),
        gte(races.raceDate, today),
        eq(races.publishStatus, 'published'),
        // 접수 못 함은 카드·"외 n개"에서 뺀다 (PRD v1.9 6.7 ②). S-061 참가 예정 탭에는 그대로 보인다
        ne(raceRegistrations.entryStatus, 'missed'),
      ),
    )
    .orderBy(asc(races.raceDate), sql`${raceEvents.startAt} NULLS LAST`, asc(races.name));
  const hasAnyRecord = (await db.$count(runRecords, eq(runRecords.userId, userId))) > 0;
  const first = rows[0];
  if (!first) return { next: null, moreCount: 0, hasAnyRecord };

  const ctx = await loadRaceContext(db, [first.race.id], userId);
  return {
    next: {
      race: toRaceSummary(first.race, ctx, now),
      registration: registrationBriefFor(first.race, ctx)!,
      eventCategory: first.event.category as DistanceCategory,
    },
    moreCount: rows.length - 1,
    hasAnyRecord,
  };
}

const RECOMMEND_DAYS = 90;
const RECOMMEND_MAX = 10;
const RECOMMEND_MIN_LOCAL = 3;
const RECOMMENDABLE = new Set(['upcoming', 'open', 'unscheduled']);

/**
 * GET /home/recommended (PRD 6.7 ④, tech/06 6.5): 게시 대회 중
 * 1) 내 지역, 대회일 오늘~90일 2) 접수 예정·접수 중·접수 일정 미정 3) 관심·참가 예정 제외 4) 대회일 순 10개
 * 5) 3개 미만이면 전국 대회에서 같은 조건으로 관심 수 많은 순 보충 (중복 없음, 합계 10개)
 */
export async function homeRecommended(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<HomeRecommended> {
  const today = kstDate(now);
  const [profile] = await db
    .select({ regionCode: userProfiles.regionCode })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  const regionCode = (profile?.regionCode as RegionCode | null | undefined) ?? null;

  const mine = sql`${races.id} NOT IN (SELECT race_id FROM race_interests WHERE user_id = ${userId})
    AND ${races.id} NOT IN (SELECT race_id FROM race_registrations WHERE user_id = ${userId})`;
  const candidates = await db
    .select({
      race: races,
      interestCount: sql<number>`(SELECT count(*)::int FROM race_interests i WHERE i.race_id = ${races.id})`,
    })
    .from(races)
    .where(
      and(
        eq(races.publishStatus, 'published'),
        gte(races.raceDate, today),
        lte(races.raceDate, addDays(today, RECOMMEND_DAYS)),
        mine,
      ),
    );
  const ctx = await loadRaceContext(
    db,
    candidates.map((c) => c.race.id),
    userId,
  );
  const eligible = candidates
    .map((c) => ({ ...c, summary: toRaceSummary(c.race, ctx, now) }))
    .filter((c) => RECOMMENDABLE.has(c.summary.registrationState));

  const byDate = (a: (typeof eligible)[number], b: (typeof eligible)[number]) =>
    a.race.raceDate.localeCompare(b.race.raceDate) || a.race.name.localeCompare(b.race.name);
  const local = regionCode
    ? eligible
        .filter((c) => c.race.regionCode === regionCode)
        .sort(byDate)
        .slice(0, RECOMMEND_MAX)
    : [];
  let filledNationwide = false;
  const items = [...local];
  if (local.length < RECOMMEND_MIN_LOCAL) {
    const taken = new Set(local.map((c) => c.race.id));
    const fill = eligible
      .filter((c) => !taken.has(c.race.id))
      .sort((a, b) => b.interestCount - a.interestCount || byDate(a, b))
      .slice(0, RECOMMEND_MAX - local.length);
    filledNationwide = fill.length > 0;
    items.push(...fill);
  }
  return { regionCode, items: items.map((c) => c.summary), filledNationwide };
}
