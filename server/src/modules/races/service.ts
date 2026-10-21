import type { FeeBucket, RaceDetail, RaceListQuery, RaceSummary } from '@berun/shared';
import { and, eq, gte, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { raceEvents, races, raceSources } from '../../db/schema/index.js';
import { compareKeys, paginate } from '../../lib/cursor.js';
import { AppError, notFound } from '../../lib/errors.js';
import { kstDate, toKstIso } from '../../lib/time.js';
import {
  loadRaceContext,
  registrationBriefFor,
  sortEvents,
  toRaceEvent,
  toRaceSummary,
  type RaceRow,
} from './summary.js';

/** 참가비 구간 — 경계값은 낮은 구간에 포함 (PRD 4.6) */
const FEE_RANGES: Record<FeeBucket, [number, number | null]> = {
  le30k: [0, 30000],
  '30k_50k': [30001, 50000],
  '50k_100k': [50001, 100000],
  gt100k: [100001, null],
};

/** 공백 제거·소문자 (검색 정규화) */
const normalize = (col: SQL | typeof races.name) =>
  sql`regexp_replace(lower(coalesce(${col}, '')), '\\s', '', 'g')`;

function buildWhere(q: RaceListQuery, today: string): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(races.publishStatus, 'published')];

  if (q.date) conds.push(eq(races.raceDate, q.date));
  if (q.from) conds.push(gte(races.raceDate, q.from));
  if (q.to) conds.push(lte(races.raceDate, q.to));
  // 기본은 오늘 이후. 검색(q)은 지난 대회도 포함 (PRD 4.6)
  if (!q.q && !q.includeEnded) conds.push(gte(races.raceDate, today));
  if (q.hideCancelled) conds.push(ne(races.status, 'cancelled'));
  if (q.region?.length) conds.push(inArray(races.regionCode, q.region));

  if (q.q) {
    const needle = q.q.replace(/\s+/g, '').toLowerCase();
    conds.push(
      or(
        sql`position(${needle} in ${normalize(races.name)}) > 0`,
        sql`position(${needle} in ${normalize(sql`${races.venueName}`)}) > 0`,
        sql`position(${needle} in ${normalize(sql`${races.organizer}`)}) > 0`,
      ),
    );
  }
  if (q.category?.length) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${raceEvents} WHERE ${raceEvents.raceId} = ${races.id} AND ${inArray(raceEvents.category, q.category)})`,
    );
  }
  if (q.fee?.length) {
    const ranges = q.fee.map((b) => {
      const [min, max] = FEE_RANGES[b];
      return max === null
        ? sql`${raceEvents.feeKrw} >= ${min}`
        : sql`${raceEvents.feeKrw} BETWEEN ${min} AND ${max}`;
    });
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${raceEvents} WHERE ${raceEvents.raceId} = ${races.id} AND (${sql.join(ranges, sql` OR `)}))`,
    );
  }
  return and(...conds);
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * GET /races (tech/06 6.4). SQL로 기본 조건을 거른 뒤, 접수 상태(계산값) 필터·정렬·커서는 메모리에서 한다.
 * 유효 접수 기간 계산을 한 함수(registration-window.ts)로 유지하기 위해서다. 게시 대회 수백 개 규모 기준.
 */
export async function listRaces(
  db: Db,
  userId: string,
  q: RaceListQuery,
  now = new Date(),
): Promise<{ items: RaceSummary[]; nextCursor: string | null }> {
  const today = kstDate(now);
  const rows = await db.select().from(races).where(buildWhere(q, today));
  const ctx = await loadRaceContext(
    db,
    rows.map((r) => r.id),
    userId,
  );

  let items = rows.map((r) => toRaceSummary(r, ctx, now));
  if (q.registrationState?.length) {
    const wanted = new Set<string>(q.registrationState);
    items = items.filter((s) => wanted.has(s.registrationState));
  }

  // 기본: 대회일 → 대회명 → id. 검색: 예정 대회 전부 → 지난 대회(최근 순)
  const keyOf = (s: RaceSummary) => {
    const past = q.q && s.registrationState === 'ended' ? 1 : 0;
    const day = dayNumber(s.raceDate);
    return [past, past ? -day : day, s.name, s.id];
  };
  items.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  return paginate(items, keyOf, q.cursor, q.limit);
}

/** 앱 API에서 대회를 찾는다: 없음·초안 404, 숨김 410 (tech/06 6.4) */
export async function findVisibleRace(db: Db, raceId: string): Promise<RaceRow> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race || race.publishStatus === 'draft') throw notFound('race');
  if (race.publishStatus === 'hidden') throw new AppError('RACE_UNAVAILABLE', 'race is hidden');
  return race;
}

/** GET /races/{raceId} */
export async function getRaceDetail(
  db: Db,
  userId: string,
  raceId: string,
  now = new Date(),
): Promise<RaceDetail> {
  const race = await findVisibleRace(db, raceId);
  const [ctx, [venue], [source]] = await Promise.all([
    loadRaceContext(db, [race.id], userId),
    // 공간 컬럼은 Drizzle 스키마 밖 (raw SQL)
    db.execute<{ lat: number | null; lng: number | null }>(
      sql`SELECT ST_Y(venue_point::geometry) AS lat, ST_X(venue_point::geometry) AS lng FROM races WHERE id = ${race.id}`,
    ),
    db
      .select({ name: raceSources.sourceName, url: raceSources.sourceUrl })
      .from(raceSources)
      .where(and(eq(raceSources.raceId, race.id), eq(raceSources.isPrimary, true))),
  ]);
  const events = sortEvents(ctx.eventsByRace.get(race.id) ?? []);
  const starts = events.flatMap((e) => (e.startAt ? [e.startAt] : []));
  const summary = toRaceSummary(race, ctx, now);

  return {
    ...summary,
    organizer: race.organizer,
    venue: {
      name: race.venueName,
      address: race.venueAddress,
      lat: venue?.lat ?? null,
      lng: venue?.lng ?? null,
    },
    earliestStartAt: starts.length ? toKstIso(new Date(Math.min(...starts.map((d) => +d)))) : null,
    officialUrl: race.officialUrl,
    registrationUrl: race.registrationUrl,
    courseUrl: race.courseUrl,
    events: events.map(toRaceEvent),
    // 대표 출처가 없으면(데이터 오류) 공식 홈페이지 링크로 대신한다
    source: source ?? { name: '공식 홈페이지', url: race.officialUrl },
    // 게시된 대회는 DB CHECK로 항상 있음. 숨김→재게시 등 예외에 대비해 수정 시각으로 대신
    lastVerifiedAt: toKstIso(race.lastVerifiedAt ?? race.updatedAt),
    my: { interested: summary.my.interested, registration: registrationBriefFor(race, ctx) },
  };
}
