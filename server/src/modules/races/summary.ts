import {
  PREDICTION_MAX_DISTANCE_M,
  PREDICTION_MIN_DISTANCE_M,
  type DistanceCategory,
  type EntryStatus,
  type RaceEvent,
  type RaceStatus,
  type RaceSummary,
  type RegionCode,
  type RegistrationBrief,
  type RegistrationMethod,
} from '@berun/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { races } from '../../db/schema/index.js';
import { raceEvents, raceInterests, raceRegistrations } from '../../db/schema/index.js';
import { effectiveWindow, registrationState } from '../../lib/registration-window.js';
import { daysBetween, kstDate, toKstIso, toKstIsoOrNull } from '../../lib/time.js';

export type RaceRow = typeof races.$inferSelect;
export type EventRow = typeof raceEvents.$inferSelect;
export type RegistrationRow = typeof raceRegistrations.$inferSelect;

const CATEGORY_ORDER: DistanceCategory[] = ['5k', '10k', 'half', 'full', 'other'];

/** 분류 순서 → 거리 순 (tech/06 RaceDetail.events) */
export function sortEvents<T extends { category: string; distanceM: number }>(events: T[]): T[] {
  return [...events].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as DistanceCategory) -
        CATEGORY_ORDER.indexOf(b.category as DistanceCategory) || a.distanceM - b.distanceM,
  );
}

export const isPredictionSupported = (distanceM: number) =>
  distanceM >= PREDICTION_MIN_DISTANCE_M && distanceM <= PREDICTION_MAX_DISTANCE_M;

export function toRaceEvent(e: EventRow): RaceEvent {
  return {
    id: e.id,
    name: e.name,
    category: e.category as DistanceCategory,
    distanceM: e.distanceM,
    startAt: toKstIsoOrNull(e.startAt),
    timeLimitMin: e.timeLimitMin,
    feeKrw: e.feeKrw,
    capacity: e.capacity,
    registrationOpensAt: toKstIsoOrNull(e.registrationOpensAt),
    registrationClosesAt: toKstIsoOrNull(e.registrationClosesAt),
  };
}

export function toRegistrationBrief(reg: RegistrationRow, event: EventRow): RegistrationBrief {
  return {
    id: reg.id,
    raceEventId: reg.raceEventId,
    eventName: event.name,
    eventDistanceM: event.distanceM,
    predictionSupported: isPredictionSupported(event.distanceM),
    goalTimeSec: reg.goalTimeSec,
    goalPaceSecPerKm: reg.goalPaceSecPerKm,
    entryStatus: reg.entryStatus as EntryStatus,
    entryStatusUpdatedAt: toKstIsoOrNull(reg.entryStatusUpdatedAt),
  };
}

/** 대회 여러 개의 종목과 사용자의 관심·참가 예정을 한 번에 읽는다 */
export async function loadRaceContext(db: Db, raceIds: string[], userId: string) {
  if (raceIds.length === 0) {
    return {
      eventsByRace: new Map<string, EventRow[]>(),
      interested: new Set<string>(),
      registrations: new Map<string, RegistrationRow>(),
    };
  }
  const [events, interests, regs] = await Promise.all([
    db.select().from(raceEvents).where(inArray(raceEvents.raceId, raceIds)),
    db
      .select({ raceId: raceInterests.raceId })
      .from(raceInterests)
      .where(and(eq(raceInterests.userId, userId), inArray(raceInterests.raceId, raceIds))),
    db
      .select()
      .from(raceRegistrations)
      .where(and(eq(raceRegistrations.userId, userId), inArray(raceRegistrations.raceId, raceIds))),
  ]);
  const eventsByRace = new Map<string, EventRow[]>();
  for (const e of events) eventsByRace.set(e.raceId, [...(eventsByRace.get(e.raceId) ?? []), e]);
  return {
    eventsByRace,
    interested: new Set(interests.map((i) => i.raceId)),
    registrations: new Map(regs.map((r) => [r.raceId, r])),
  };
}

export type RaceContext = Awaited<ReturnType<typeof loadRaceContext>>;

export function toRaceSummary(race: RaceRow, ctx: RaceContext, now: Date): RaceSummary {
  const events = ctx.eventsByRace.get(race.id) ?? [];
  const window = effectiveWindow(race, events);
  const dDay = daysBetween(kstDate(now), race.raceDate);
  return {
    id: race.id,
    name: race.name,
    raceDate: race.raceDate,
    regionCode: race.regionCode as RegionCode,
    categories: CATEGORY_ORDER.filter((c) => events.some((e) => e.category === c)),
    status: race.status as RaceStatus,
    registrationState: registrationState(race, window, now),
    registrationOpensAt: window.opensAt ? toKstIso(window.opensAt) : null,
    registrationOpensTimeKnown: race.registrationOpensTimeKnown,
    registrationClosesAt: window.closesAt ? toKstIso(window.closesAt) : null,
    registrationMethod: race.registrationMethod as RegistrationMethod,
    dDay: dDay >= 0 ? dDay : null,
    my: { interested: ctx.interested.has(race.id), registered: ctx.registrations.has(race.id) },
  };
}

/** 참가 예정이 있으면 그 종목 행과 함께 요약을 만든다 */
export function registrationBriefFor(race: RaceRow, ctx: RaceContext): RegistrationBrief | null {
  const reg = ctx.registrations.get(race.id);
  if (!reg) return null;
  const event = ctx.eventsByRace.get(race.id)?.find((e) => e.id === reg.raceEventId);
  return event ? toRegistrationBrief(reg, event) : null;
}
