import type {
  AdminRace,
  AdminRaceEventInput,
  AdminRaceInput,
  AdminRaceSaveRes,
  AdminRole,
  PublishMissing,
} from '@berun/shared';
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  raceEvents,
  raceInterests,
  raceRegistrations,
  races,
  raceSources,
} from '../../db/schema/index.js';
import { AppError, notFound, validationFailed } from '../../lib/errors.js';
import { addDays, kstAt, kstDate, toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { monthDayTime } from '../notifications/render.js';
import { hhmm } from '../notifications/render.js';
import type { RaceChangeKind } from '../notifications/kinds.js';

type RaceRow = typeof races.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;
type SourceRow = typeof raceSources.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** 대회 저장 후 예약표 재계산·N-06 (워커 BullMQ `race-updated` 작업으로 넘긴다) */
export type RaceUpdateSink = {
  raceUpdated(job: {
    raceId: string;
    notify?: RaceChangeKind;
    changeSummary?: string | null;
  }): Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 복제 날짜 이동: +364일(52주) — 같은 요일 (PRD 8.4.4) */
export const CLONE_SHIFT_DAYS = 364;

// ---------- 정규화·자동 채움 ----------

/** 중복 경고 키: 정규화 대회명(공백·기호·연도·회차 제거, 소문자) + 대회일 (PRD 8.4.1) */
export function dedupeKey(name: string, raceDate: string): string {
  const norm = name
    .toLowerCase()
    .replace(/20\d\d/g, '')
    .replace(/제\s*\d+\s*회/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
  return `${norm}|${raceDate}`;
}

/** 슬러그 자동 생성: 한글 대회명은 로마자로 바꾸지 않고 연도 + 짧은 랜덤 (영문 소문자·숫자·-) */
function autoSlug(name: string, raceDate: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/20\d\d/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 7);
  return [ascii || 'race', raceDate.slice(0, 4), rand].join('-');
}

async function uniqueSlug(db: Db | Tx, wanted: string, exceptId?: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? wanted : `${wanted}-${i}`;
    const [hit] = await db
      .select({ id: races.id })
      .from(races)
      .where(and(eq(races.slug, candidate), exceptId ? ne(races.id, exceptId) : undefined));
    if (!hit) return candidate;
  }
}

/** 관리자 입력 시각은 초 단위로 저장한다 (API 응답이 초 단위라 왕복해도 같은 값) */
const dateOrNull = (iso: string | null | undefined) =>
  iso ? new Date(Math.floor(Date.parse(iso) / 1000) * 1000) : null;

/** 오픈 시각 미정이면 그날 00:00 KST로 저장 (tech/06 7.3) */
function normalizeOpensAt(iso: string | null, timeKnown: boolean): Date | null {
  const d = dateOrNull(iso);
  if (!d) return null;
  return timeKnown ? d : kstAt(kstDate(d), '00:00');
}

// ---------- 조회 ----------

async function counts(db: Db | Tx, raceIds: string[]) {
  if (raceIds.length === 0)
    return { interests: new Map<string, number>(), regs: new Map<string, number>() };
  const [i, r] = await Promise.all([
    db
      .select({ raceId: raceInterests.raceId, n: sql<number>`count(*)::int` })
      .from(raceInterests)
      .where(inArray(raceInterests.raceId, raceIds))
      .groupBy(raceInterests.raceId),
    db
      .select({ raceId: raceRegistrations.raceId, n: sql<number>`count(*)::int` })
      .from(raceRegistrations)
      .where(inArray(raceRegistrations.raceId, raceIds))
      .groupBy(raceRegistrations.raceId),
  ]);
  return {
    interests: new Map(i.map((x) => [x.raceId, x.n])),
    regs: new Map(r.map((x) => [x.raceId, x.n])),
  };
}

/** 게시 조건 (PRD 8.4.2). 게시된 대회는 빈 배열 */
export function publishMissing(
  race: RaceRow,
  events: EventRow[],
  sources: SourceRow[],
): PublishMissing[] {
  const missing: PublishMissing[] = [];
  if (!race.officialUrl) missing.push('officialUrl');
  const primary = sources.find((s) => s.isPrimary);
  if (!primary?.fetchedAt) missing.push('primarySourceVerified');
  if (events.length === 0) missing.push('events');
  if (race.raceType !== 'road') missing.push('raceTypeRoad');
  if (!race.lastVerifiedAt) missing.push('lastVerifiedAt');
  return missing;
}

async function venueOf(db: Db | Tx, raceId: string) {
  const [v] = await db.execute<{ lat: number | null; lng: number | null }>(
    sql`SELECT ST_Y(venue_point::geometry) AS lat, ST_X(venue_point::geometry) AS lng FROM races WHERE id = ${raceId}`,
  );
  return v?.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null;
}

export async function loadAdminRace(db: Db | Tx, raceId: string): Promise<AdminRace> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) throw notFound('race');
  const [events, sources, venuePoint, c, regByEvent] = await Promise.all([
    db.select().from(raceEvents).where(eq(raceEvents.raceId, raceId)),
    db.select().from(raceSources).where(eq(raceSources.raceId, raceId)),
    venueOf(db, raceId),
    counts(db, [raceId]),
    db
      .select({ eventId: raceRegistrations.raceEventId, n: sql<number>`count(*)::int` })
      .from(raceRegistrations)
      .where(eq(raceRegistrations.raceId, raceId))
      .groupBy(raceRegistrations.raceEventId),
  ]);
  const regCount = new Map(regByEvent.map((r) => [r.eventId, r.n]));
  return {
    id: race.id,
    name: race.name,
    slug: race.slug,
    organizer: race.organizer,
    regionCode: race.regionCode as AdminRace['regionCode'],
    venueName: race.venueName,
    venueAddress: race.venueAddress,
    venuePoint,
    raceDate: race.raceDate,
    registrationOpensAt: toKstIsoOrNull(race.registrationOpensAt),
    registrationOpensTimeKnown: race.registrationOpensTimeKnown,
    registrationClosesAt: toKstIsoOrNull(race.registrationClosesAt),
    officialUrl: race.officialUrl,
    registrationUrl: race.registrationUrl,
    courseUrl: race.courseUrl,
    raceType: race.raceType,
    registrationMethod: race.registrationMethod as AdminRace['registrationMethod'],
    status: race.status as AdminRace['status'],
    publishStatus: race.publishStatus as AdminRace['publishStatus'],
    lastVerifiedAt: toKstIsoOrNull(race.lastVerifiedAt),
    clonedFrom: race.clonedFrom,
    events: [...events]
      .sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name))
      .map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category as AdminRaceEventInput['category'],
        distanceM: e.distanceM,
        startTime: e.startAt ? hhmm(e.startAt) : null,
        timeLimitMin: e.timeLimitMin,
        feeKrw: e.feeKrw,
        capacity: e.capacity,
        registrationOpensAt: toKstIsoOrNull(e.registrationOpensAt),
        registrationClosesAt: toKstIsoOrNull(e.registrationClosesAt),
        registrationCount: regCount.get(e.id) ?? 0,
      })),
    sources: sources
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((s) => ({
        id: s.id,
        kind: s.sourceKind,
        name: s.sourceName,
        url: s.sourceUrl,
        isPrimary: s.isPrimary,
        verifiedAt: toKstIsoOrNull(s.fetchedAt),
      })),
    interestCount: c.interests.get(raceId) ?? 0,
    registrationCount: c.regs.get(raceId) ?? 0,
    publishMissing: race.publishStatus === 'published' ? [] : publishMissing(race, events, sources),
    createdAt: toKstIso(race.createdAt),
    updatedAt: toKstIso(race.updatedAt),
  };
}

export async function dedupeWarnings(
  db: Db | Tx,
  name: string,
  raceDate: string,
  exceptId?: string,
) {
  const rows = await db
    .select({ id: races.id, name: races.name, raceDate: races.raceDate })
    .from(races)
    .where(
      and(
        eq(races.dedupeKey, dedupeKey(name, raceDate)),
        exceptId ? ne(races.id, exceptId) : undefined,
      ),
    );
  return rows;
}

/** GET /races (관리자 목록) — 수백 개 규모라 조건 일부는 메모리에서 거른다 */
export async function listAdminRaces(
  db: Db,
  q: {
    q?: string | undefined;
    publishStatus?: string[] | undefined;
    status?: string[] | undefined;
    region?: string[] | undefined;
    from?: string | undefined;
    to?: string | undefined;
    staleVerified?: boolean | undefined;
    noCoords?: boolean | undefined;
    publishBlocked?: boolean | undefined;
    page: number;
    pageSize: number;
  },
  now = new Date(),
) {
  const rows = await db
    .select({
      race: races,
      hasCoords: sql<boolean>`${races}.venue_point IS NOT NULL`,
    })
    .from(races)
    .where(
      and(
        q.q
          ? sql`position(${q.q.replace(/\s+/g, '').toLowerCase()} in regexp_replace(lower(${races.name}), '\\s', '', 'g')) > 0`
          : undefined,
        q.publishStatus?.length ? inArray(races.publishStatus, q.publishStatus) : undefined,
        q.status?.length ? inArray(races.status, q.status) : undefined,
        q.region?.length ? inArray(races.regionCode, q.region) : undefined,
        q.from ? gte(races.raceDate, q.from) : undefined,
        q.to ? lte(races.raceDate, q.to) : undefined,
      ),
    )
    .orderBy(races.raceDate, races.name, races.id);
  const ids = rows.map((r) => r.race.id);
  const [c, events, sources] = await Promise.all([
    counts(db, ids),
    ids.length ? db.select().from(raceEvents).where(inArray(raceEvents.raceId, ids)) : [],
    ids.length ? db.select().from(raceSources).where(inArray(raceSources.raceId, ids)) : [],
  ]);
  const today = kstDate(now);
  let items = rows.map(({ race, hasCoords }) => ({
    id: race.id,
    name: race.name,
    raceDate: race.raceDate,
    regionCode: race.regionCode as AdminRace['regionCode'],
    status: race.status as AdminRace['status'],
    publishStatus: race.publishStatus as AdminRace['publishStatus'],
    interestCount: c.interests.get(race.id) ?? 0,
    registrationCount: c.regs.get(race.id) ?? 0,
    lastVerifiedAt: toKstIsoOrNull(race.lastVerifiedAt),
    updatedAt: toKstIso(race.updatedAt),
    hasCoords,
    publishMissing:
      race.publishStatus === 'published'
        ? []
        : publishMissing(
            race,
            events.filter((e) => e.raceId === race.id),
            sources.filter((s) => s.raceId === race.id),
          ),
    _stale:
      race.raceDate >= today &&
      (!race.lastVerifiedAt || race.lastVerifiedAt.getTime() < now.getTime() - 30 * DAY_MS),
  }));
  if (q.staleVerified) items = items.filter((i) => i._stale);
  if (q.noCoords) items = items.filter((i) => i.publishStatus === 'published' && !i.hasCoords);
  if (q.publishBlocked)
    items = items.filter((i) => i.publishStatus !== 'published' && i.publishMissing.length > 0);
  const start = (q.page - 1) * q.pageSize;
  return {
    items: items.slice(start, start + q.pageSize).map(({ _stale: _s, ...rest }) => rest),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  };
}

// ---------- 저장 ----------

function eventValues(raceDate: string, e: AdminRaceEventInput) {
  return {
    name: e.name,
    category: e.category,
    distanceM: e.distanceM,
    startAt: e.startTime ? kstAt(raceDate, e.startTime) : null,
    timeLimitMin: e.timeLimitMin,
    feeKrw: e.feeKrw,
    capacity: e.capacity,
    registrationOpensAt: dateOrNull(e.registrationOpensAt),
    registrationClosesAt: dateOrNull(e.registrationClosesAt),
  };
}

function raceValues(input: AdminRaceInput) {
  return {
    name: input.name,
    organizer: input.organizer,
    regionCode: input.regionCode,
    venueName: input.venueName,
    venueAddress: input.venueAddress,
    raceDate: input.raceDate,
    registrationOpensAt: normalizeOpensAt(
      input.registrationOpensAt,
      input.registrationOpensTimeKnown,
    ),
    registrationOpensTimeKnown: input.registrationOpensTimeKnown,
    registrationClosesAt: dateOrNull(input.registrationClosesAt),
    officialUrl: input.officialUrl,
    registrationUrl: input.registrationUrl,
    courseUrl: input.courseUrl,
    raceType: input.raceType,
    registrationMethod: input.registrationMethod,
    status: input.status,
    dedupeKey: dedupeKey(input.name, input.raceDate),
  };
}

async function setVenue(tx: Tx, raceId: string, p: AdminRaceInput['venuePoint']) {
  await tx.execute(
    p
      ? sql`UPDATE races SET venue_point = ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography WHERE id = ${raceId}`
      : sql`UPDATE races SET venue_point = NULL WHERE id = ${raceId}`,
  );
}

/**
 * 출처: 공식 URL에서 대표 출처를 자동으로 만든다 (PRD 8.4.2). 대표 출처 확인 일시는
 * 새로 만들 때 = 지금, 수정 = [확인 완료] 체크 시 지금 (아니면 유지), 복제 = 비움(cloneRace).
 * 그 밖의 출처는 입력값으로 바꾼다.
 */
async function syncSources(
  tx: Tx,
  raceId: string,
  input: Pick<AdminRaceInput, 'officialUrl' | 'extraSources' | 'discoverySources'>,
  now: Date,
  verifyNow: boolean,
) {
  const [primary] = await tx
    .select()
    .from(raceSources)
    .where(and(eq(raceSources.raceId, raceId), eq(raceSources.isPrimary, true)));
  if (input.officialUrl) {
    if (primary) {
      await tx
        .update(raceSources)
        .set({ sourceUrl: input.officialUrl, ...(verifyNow && { fetchedAt: now }) })
        .where(eq(raceSources.id, primary.id));
    } else {
      await tx.insert(raceSources).values({
        raceId,
        sourceKind: 'official',
        sourceName: '공식 홈페이지',
        sourceUrl: input.officialUrl,
        isPrimary: true,
        fetchedAt: now,
      });
    }
  } else if (primary) {
    await tx.delete(raceSources).where(eq(raceSources.id, primary.id));
  }
  await tx
    .delete(raceSources)
    .where(and(eq(raceSources.raceId, raceId), eq(raceSources.isPrimary, false)));
  const rest = [
    ...input.extraSources.map((s) => ({
      raceId,
      sourceKind: s.kind,
      sourceName: s.name,
      sourceUrl: s.url,
      fetchedAt: dateOrNull(s.verifiedAt),
    })),
    // 내부 발견 경로 — 앱 응답에는 대표 출처만 나간다 (P-RACE-07)
    ...input.discoverySources.map((s) => ({
      raceId,
      sourceKind: s.kind,
      sourceName: s.name,
      sourceUrl: s.url,
    })),
  ];
  if (rest.length) await tx.insert(raceSources).values(rest);
}

function assertRaceDateAllowed(raceDate: string, role: AdminRole, now: Date) {
  // 신규 등록은 오늘 이후만, 과거 대회 등록은 owner만 (PRD 8.4.2)
  if (raceDate < kstDate(now) && role !== 'owner') {
    throw validationFailed([{ path: 'raceDate', code: 'out_of_range' }]);
  }
}

/** POST /races — 초안 생성 (PRD 8.4.1). 신규 작성은 최종 확인일·대표 출처 확인 일시 = 지금 */
export async function createDraft(
  db: Db,
  input: AdminRaceInput,
  role: AdminRole,
  now = new Date(),
) {
  assertRaceDateAllowed(input.raceDate, role, now);
  const raceId = await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.slug ?? autoSlug(input.name, input.raceDate));
    const [race] = await tx
      .insert(races)
      .values({ ...raceValues(input), slug, publishStatus: 'draft', lastVerifiedAt: now })
      .returning({ id: races.id });
    await setVenue(tx, race!.id, input.venuePoint);
    if (input.events.length) {
      await tx
        .insert(raceEvents)
        .values(input.events.map((e) => ({ raceId: race!.id, ...eventValues(input.raceDate, e) })));
    }
    await syncSources(tx, race!.id, input, now, true);
    return race!.id;
  });
  return {
    race: await loadAdminRace(db, raceId),
    dedupeWarnings: await dedupeWarnings(db, input.name, input.raceDate, raceId),
  };
}

/** 대회일·출발 시각·접수 기간 중 바뀐 것 → N-06c 요약 (본문 길이 때문에 최대 2개) */
function scheduleChanges(
  before: RaceRow,
  beforeEvents: EventRow[],
  after: RaceRow,
  afterEvents: EventRow[],
) {
  const items: string[] = [];
  // 초 단위 비교 (기존 행은 밀리초가 있을 수 있음)
  const sec = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 1000) : null);
  const same = (a: Date | null, b: Date | null) => sec(a) === sec(b);
  if (before.raceDate !== after.raceDate) {
    const [, m, d] = after.raceDate.split('-').map(Number);
    items.push(`대회일: ${m}월 ${d}일`);
  }
  const startChanged = afterEvents.some((e) => {
    const old = beforeEvents.find((b) => b.id === e.id);
    return old && !same(old.startAt, e.startAt) && before.raceDate === after.raceDate;
  });
  if (startChanged) {
    const first = afterEvents
      .flatMap((e) => (e.startAt ? [e.startAt] : []))
      .sort((a, b) => +a - +b)[0];
    items.push(first ? `출발 시각: ${hhmm(first)}` : '출발 시각');
  }
  if (!same(before.registrationOpensAt, after.registrationOpensAt)) {
    items.push(
      after.registrationOpensAt
        ? `접수 오픈: ${monthDayTime(after.registrationOpensAt)}`
        : '접수 오픈',
    );
  }
  if (!same(before.registrationClosesAt, after.registrationClosesAt)) {
    items.push(
      after.registrationClosesAt
        ? `접수 마감: ${monthDayTime(after.registrationClosesAt)}`
        : '접수 마감',
    );
  }
  const eventPeriodChanged = afterEvents.some((e) => {
    const old = beforeEvents.find((b) => b.id === e.id);
    return (
      old &&
      (!same(old.registrationOpensAt, e.registrationOpensAt) ||
        !same(old.registrationClosesAt, e.registrationClosesAt))
    );
  });
  if (eventPeriodChanged && items.length === 0) items.push('종목별 접수 기간');
  return items;
}

async function affectedUsers(db: Db | Tx, raceId: string) {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT user_id FROM race_interests WHERE race_id = ${raceId}
      UNION SELECT user_id FROM race_registrations WHERE race_id = ${raceId}
    ) u`);
  return row?.n ?? 0;
}

/**
 * PUT /races/{id} — 전체 저장 (tech/06 7.3). If-Match = updatedAt (다르면 409 CONFLICT_STALE).
 * 게시된 대회면 저장 뒤 예약표 재계산(항상) + 상태 취소 → N-06a, 연기 → N-06b,
 * 대회일·출발 시각·접수 기간 변경 + notifyChange → N-06c.
 */
export async function saveRace(
  db: Db,
  sink: RaceUpdateSink,
  raceId: string,
  input: AdminRaceInput,
  ifMatch: string | undefined,
  now = new Date(),
): Promise<AdminRaceSaveRes> {
  if (!ifMatch) throw validationFailed([{ path: 'if-match', code: 'required' }]);
  const [before] = await db.select().from(races).where(eq(races.id, raceId));
  if (!before) throw notFound('race');
  // 응답 시각은 초 단위(+09:00)라 초 단위로 비교한다
  const sec = (ms: number) => Math.floor(ms / 1000);
  if (
    Number.isNaN(Date.parse(ifMatch)) ||
    sec(Date.parse(ifMatch)) !== sec(before.updatedAt.getTime())
  ) {
    throw new AppError('CONFLICT_STALE', 'race was modified', {
      details: { updatedAt: toKstIso(before.updatedAt) },
    });
  }
  const beforeEvents = await db.select().from(raceEvents).where(eq(raceEvents.raceId, raceId));

  // 종목 표: id 있는 행은 수정, 없는 행은 추가, 빠진 행은 삭제 (참가 예정이 있는 종목은 삭제 불가)
  const keepIds = new Set(input.events.flatMap((e) => (e.id ? [e.id] : [])));
  const fieldErrors = input.events.flatMap((e, i) =>
    e.id && !beforeEvents.some((b) => b.id === e.id)
      ? [{ path: `events[${i}].id`, code: 'invalid_value' }]
      : [],
  );
  if (fieldErrors.length) throw validationFailed(fieldErrors);
  const removed = beforeEvents.filter((b) => !keepIds.has(b.id)).map((b) => b.id);
  if (removed.length) {
    const used = await db
      .select({ id: raceRegistrations.raceEventId })
      .from(raceRegistrations)
      .where(inArray(raceRegistrations.raceEventId, removed))
      .limit(1);
    if (used.length) {
      throw new AppError('VALIDATION_FAILED', 'event has planned users', {
        fieldErrors: [{ path: 'events', code: 'event_in_use' }],
        details: { eventIds: removed },
      });
    }
  }
  if (before.publishStatus === 'published' && input.raceType !== 'road') {
    throw validationFailed([{ path: 'raceType', code: 'publish_requires_road' }]);
  }

  await db.transaction(async (tx) => {
    const slug = input.slug ? await uniqueSlug(tx, input.slug, raceId) : before.slug;
    await tx
      .update(races)
      .set({
        ...raceValues(input),
        slug,
        ...(input.markVerifiedNow && { lastVerifiedAt: now }),
        updatedAt: now,
      })
      .where(eq(races.id, raceId));
    await setVenue(tx, raceId, input.venuePoint);
    if (removed.length) await tx.delete(raceEvents).where(inArray(raceEvents.id, removed));
    for (const e of input.events) {
      if (e.id) {
        await tx
          .update(raceEvents)
          .set(eventValues(input.raceDate, e))
          .where(eq(raceEvents.id, e.id));
      } else {
        await tx.insert(raceEvents).values({ raceId, ...eventValues(input.raceDate, e) });
      }
    }
    await syncSources(tx, raceId, input, now, input.markVerifiedNow);
  });

  const [after] = await db.select().from(races).where(eq(races.id, raceId));
  const afterEvents = await db.select().from(raceEvents).where(eq(raceEvents.raceId, raceId));

  let notice: RaceChangeKind | null = null;
  let changeSummary: string | null = null;
  const published = after!.publishStatus === 'published';
  if (published) {
    if (before.status !== 'cancelled' && after!.status === 'cancelled') notice = 'race_cancelled';
    else if (before.status !== 'postponed' && after!.status === 'postponed')
      notice = 'race_postponed';
    else if (input.notifyChange && after!.status !== 'cancelled') {
      const changes = scheduleChanges(before, beforeEvents, after!, afterEvents);
      if (changes.length) {
        notice = 'race_schedule_changed';
        changeSummary = changes.slice(0, 2).join(', ');
      }
    }
    await sink.raceUpdated({ raceId, ...(notice && { notify: notice }), changeSummary });
  }

  return {
    race: await loadAdminRace(db, raceId),
    dedupeWarnings: await dedupeWarnings(db, after!.name, after!.raceDate, raceId),
    sideEffects: {
      notificationsRescheduled: published,
      sentChangeNotice: notice,
      affectedUsers: notice ? await affectedUsers(db, raceId) : 0,
    },
  };
}

/** POST /races/{id}/publish — 게시 조건 검사 후 게시, 예약표 생성 */
export async function publishRace(db: Db, sink: RaceUpdateSink, raceId: string) {
  const race = await loadAdminRace(db, raceId);
  if (race.publishMissing.length) {
    throw new AppError('PUBLISH_REQUIREMENTS_UNMET', 'publish requirements unmet', {
      details: { missing: race.publishMissing },
    });
  }
  await db
    .update(races)
    .set({ publishStatus: 'published', updatedAt: new Date() })
    .where(eq(races.id, raceId));
  await sink.raceUpdated({ raceId });
  return loadAdminRace(db, raceId);
}

async function assertNoUsers(db: Db, raceId: string) {
  const c = await counts(db, [raceId]);
  const interestCount = c.interests.get(raceId) ?? 0;
  const registrationCount = c.regs.get(raceId) ?? 0;
  if (interestCount + registrationCount > 0) {
    throw new AppError('RACE_IN_USE', 'race has interested or planned users', {
      details: { interestCount, registrationCount },
    });
  }
}

/** POST /races/{id}/unpublish — 게시 → 초안 (관심·참가 예정 0일 때만) */
export async function unpublishRace(db: Db, sink: RaceUpdateSink, raceId: string) {
  await loadAdminRace(db, raceId);
  await assertNoUsers(db, raceId);
  await db
    .update(races)
    .set({ publishStatus: 'draft', updatedAt: new Date() })
    .where(eq(races.id, raceId));
  await sink.raceUpdated({ raceId });
  return loadAdminRace(db, raceId);
}

/** POST /races/{id}/hide — 숨김 (주최 측 요청 등). 메모는 감사 로그에 */
export async function hideRace(db: Db, sink: RaceUpdateSink, raceId: string) {
  await loadAdminRace(db, raceId);
  await db
    .update(races)
    .set({ publishStatus: 'hidden', updatedAt: new Date() })
    .where(eq(races.id, raceId));
  await sink.raceUpdated({ raceId });
  return loadAdminRace(db, raceId);
}

/** DELETE /races/{id} — owner, 관심·참가 예정 0일 때만 (그 외는 취소 상태로, P-RACE-06) */
export async function deleteRace(db: Db, raceId: string) {
  await loadAdminRace(db, raceId);
  await assertNoUsers(db, raceId);
  await db.delete(races).where(eq(races.id, raceId));
}

/**
 * POST /races/{id}/clone (PRD 8.4.4): 모든 필드를 복사한 새 초안.
 * 날짜 +364일(원본 대회일이 지났을 때 기본), 대회명 첫 20xx → 새 연도, 첫 제N회 → N+1.
 * 복사하지 않음: 상태(예정), 게시(초안), 최종 확인일·출처 확인 일시(비움), 관심·참가 예정, 제보.
 */
export async function cloneRace(
  db: Db,
  raceId: string,
  shiftDates: boolean | undefined,
  now = new Date(),
) {
  const [src] = await db.select().from(races).where(eq(races.id, raceId));
  if (!src) throw notFound('race');
  const events = await db.select().from(raceEvents).where(eq(raceEvents.raceId, raceId));
  const [primary] = await db
    .select()
    .from(raceSources)
    .where(and(eq(raceSources.raceId, raceId), eq(raceSources.isPrimary, true)));
  const venue = await venueOf(db, raceId);

  const shift = shiftDates ?? src.raceDate < kstDate(now);
  const move = (d: Date | null) =>
    d && shift ? new Date(d.getTime() + CLONE_SHIFT_DAYS * DAY_MS) : d;
  const raceDate = shift ? addDays(src.raceDate, CLONE_SHIFT_DAYS) : src.raceDate;
  const shiftedFields: string[] = [];
  if (shift) {
    shiftedFields.push('raceDate');
    if (src.registrationOpensAt) shiftedFields.push('registrationOpensAt');
    if (src.registrationClosesAt) shiftedFields.push('registrationClosesAt');
    events.forEach((e, i) => {
      if (e.startAt) shiftedFields.push(`events[${i}].startTime`);
      if (e.registrationOpensAt) shiftedFields.push(`events[${i}].registrationOpensAt`);
      if (e.registrationClosesAt) shiftedFields.push(`events[${i}].registrationClosesAt`);
    });
  }
  let name = src.name;
  const yearMatch = /20\d\d/.exec(name);
  const renamedYear = Boolean(yearMatch) && yearMatch![0] !== raceDate.slice(0, 4);
  if (yearMatch) name = name.replace(/20\d\d/, raceDate.slice(0, 4));
  const edition = /제\s*(\d+)\s*회/.exec(name);
  if (edition) name = name.replace(/제\s*(\d+)\s*회/, `제${Number(edition[1]) + 1}회`);

  const newId = await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, autoSlug(name, raceDate));
    const [race] = await tx
      .insert(races)
      .values({
        name,
        slug,
        organizer: src.organizer,
        regionCode: src.regionCode,
        venueName: src.venueName,
        venueAddress: src.venueAddress,
        raceDate,
        timezone: src.timezone,
        registrationOpensAt: move(src.registrationOpensAt),
        registrationOpensTimeKnown: src.registrationOpensTimeKnown,
        registrationClosesAt: move(src.registrationClosesAt),
        courseUrl: src.courseUrl,
        status: 'scheduled',
        publishStatus: 'draft',
        raceType: src.raceType,
        registrationMethod: src.registrationMethod,
        dedupeKey: dedupeKey(name, raceDate),
        officialUrl: src.officialUrl,
        registrationUrl: src.registrationUrl,
        lastVerifiedAt: null,
        clonedFrom: src.id,
      })
      .returning({ id: races.id });
    await setVenue(tx, race!.id, venue);
    if (events.length) {
      await tx.insert(raceEvents).values(
        events.map((e) => ({
          raceId: race!.id,
          name: e.name,
          category: e.category,
          distanceM: e.distanceM,
          startAt: move(e.startAt),
          timeLimitMin: e.timeLimitMin,
          feeKrw: e.feeKrw,
          capacity: e.capacity,
          registrationOpensAt: move(e.registrationOpensAt),
          registrationClosesAt: move(e.registrationClosesAt),
        })),
      );
    }
    if (primary) {
      await tx.insert(raceSources).values({
        raceId: race!.id,
        sourceKind: primary.sourceKind,
        sourceName: primary.sourceName,
        sourceUrl: primary.sourceUrl,
        isPrimary: true,
        fetchedAt: null,
      });
    }
    return race!.id;
  });
  return {
    race: await loadAdminRace(db, newId),
    shiftedFields,
    renamed: { year: renamedYear, edition: Boolean(edition) },
  };
}

export async function impact(db: Db, raceId: string) {
  await loadAdminRace(db, raceId);
  const c = await counts(db, [raceId]);
  return {
    interestCount: c.interests.get(raceId) ?? 0,
    registrationCount: c.regs.get(raceId) ?? 0,
  };
}
