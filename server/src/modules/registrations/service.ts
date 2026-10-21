import {
  GOAL_PACE_MAX_SEC_PER_KM,
  GOAL_PACE_MIN_SEC_PER_KM,
  REGISTRATION_LIMIT,
  type CreateRegistrationReq,
  type EntryStatus,
  type GoalSource,
  type MyRaceItem,
  type Registration,
  type UpdateRegistrationReq,
} from '@berun/shared';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  predictions,
  raceEvents,
  raceInterests,
  raceRegistrations,
  races,
} from '../../db/schema/index.js';
import { compareKeys, paginate } from '../../lib/cursor.js';
import { AppError, notFound, validationFailed } from '../../lib/errors.js';
import { effectiveWindow, registrationState } from '../../lib/registration-window.js';
import { kstDate, toKstIso, toKstIsoOrNull } from '../../lib/time.js';
import { createPrediction } from '../predictions/service.js';
import { findVisibleRace } from '../races/service.js';
import {
  isPredictionSupported,
  loadRaceContext,
  registrationBriefFor,
  toRaceSummary,
  type EventRow,
  type RaceRow,
  type RegistrationRow,
} from '../races/summary.js';

const goalPace = (goalTimeSec: number, distanceM: number) =>
  Math.round(goalTimeSec / (distanceM / 1000));

/** 목표 페이스 2'50"~15'00"/km (PRD 4.10). 제한 시간 초과는 경고만 */
function checkGoal(goalTimeSec: number, event: EventRow) {
  const pace = goalTimeSec / (event.distanceM / 1000);
  if (pace < GOAL_PACE_MIN_SEC_PER_KM || pace > GOAL_PACE_MAX_SEC_PER_KM) {
    throw new AppError('GOAL_OUT_OF_RANGE', 'goal pace is out of range', {
      details: { minSecPerKm: GOAL_PACE_MIN_SEC_PER_KM, maxSecPerKm: GOAL_PACE_MAX_SEC_PER_KM },
    });
  }
}

const overTimeLimit = (goalTimeSec: number | null, event: EventRow) =>
  goalTimeSec !== null && event.timeLimitMin !== null && goalTimeSec > event.timeLimitMin * 60;

/** 지난 대회(대회일 < 오늘 KST)는 추가·수정·해제 불가. 대회 당일까지 변경 가능 (PRD v1.5 4.10.1) */
function assertNotFinished(race: RaceRow, now: Date) {
  if (race.raceDate < kstDate(now)) throw new AppError('RACE_FINISHED', 'race is over');
}

async function latestPredictionId(db: Db, registrationId: string) {
  const [p] = await db
    .select({ id: predictions.id })
    .from(predictions)
    .where(eq(predictions.raceRegistrationId, registrationId))
    .orderBy(desc(predictions.createdAt), desc(predictions.id))
    .limit(1);
  return p?.id ?? null;
}

function toRegistration(
  reg: RegistrationRow,
  event: EventRow,
  extra: { predictionId: string | null; interestAutoEnabled: boolean; notice: boolean },
): Registration {
  return {
    id: reg.id,
    raceId: reg.raceId,
    raceEventId: reg.raceEventId,
    eventName: event.name,
    eventDistanceM: event.distanceM,
    goalTimeSec: reg.goalTimeSec,
    goalPaceSecPerKm: reg.goalPaceSecPerKm,
    goalSource: reg.goalSource as GoalSource,
    entryStatus: reg.entryStatus as EntryStatus,
    entryStatusUpdatedAt: toKstIsoOrNull(reg.entryStatusUpdatedAt),
    predictionId: extra.predictionId,
    predictionSupported: isPredictionSupported(event.distanceM),
    interestAutoEnabled: extra.interestAutoEnabled,
    showOfficialRegistrationNotice: extra.notice,
    warnings: overTimeLimit(reg.goalTimeSec, event) ? ['GOAL_OVER_TIME_LIMIT'] : [],
    createdAt: toKstIso(reg.createdAt),
  };
}

function isUniqueViolation(err: unknown, constraint: string) {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    (e as { code?: string })?.code === '23505' &&
    (e as { constraint_name?: string })?.constraint_name === constraint
  );
}

/** 목표가 있으면 추가 시점 예측을 계산·저장해 연결 (PRD 4.10 ⑥). 기록 없음·미지원 거리면 null */
async function predictForRegistration(db: Db, userId: string, registrationId: string, now: Date) {
  try {
    const p = await createPrediction(
      db,
      userId,
      { target: { type: 'registration', registrationId }, recordIds: null },
      { save: true, now },
    );
    return p.id;
  } catch (err) {
    if (
      err instanceof AppError &&
      (err.code === 'NO_ELIGIBLE_RECORDS' || err.code === 'TARGET_DISTANCE_UNSUPPORTED')
    ) {
      return null;
    }
    throw err;
  }
}

/** POST /races/{raceId}/registration (tech/06 6.8) */
export async function createRegistration(
  db: Db,
  userId: string,
  raceId: string,
  req: CreateRegistrationReq,
  now = new Date(),
): Promise<Registration> {
  const race = await findVisibleRace(db, raceId);
  if (race.status === 'cancelled') throw new AppError('RACE_CANCELLED', 'race is cancelled');
  assertNotFinished(race, now);

  const events = await db.select().from(raceEvents).where(eq(raceEvents.raceId, race.id));
  const event = events.find((e) => e.id === req.raceEventId);
  if (!event) throw validationFailed([{ path: 'raceEventId', code: 'invalid_value' }]);

  const [existing] = await db
    .select({ id: raceRegistrations.id })
    .from(raceRegistrations)
    .where(and(eq(raceRegistrations.userId, userId), eq(raceRegistrations.raceId, race.id)));
  if (existing) {
    throw new AppError('ALREADY_PLANNED', 'race already planned', {
      details: { registrationId: existing.id },
    });
  }

  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(raceRegistrations)
    .innerJoin(races, eq(races.id, raceRegistrations.raceId))
    .where(and(eq(raceRegistrations.userId, userId), gte(races.raceDate, kstDate(now))));
  if (n >= REGISTRATION_LIMIT) {
    throw new AppError('LIMIT_EXCEEDED', 'too many planned races', {
      details: { resource: 'registrations', limit: REGISTRATION_LIMIT },
    });
  }

  const goalTimeSec = req.goalSource === 'none' ? null : (req.goalTimeSec ?? null);
  if (goalTimeSec !== null) checkGoal(goalTimeSec, event);

  // 접수 상태 기본값: 유효 접수 기간이 마감이면 접수 완료, 그 외 접수 전 (PRD 4.10 3-1)
  const state = registrationState(race, effectiveWindow(race, events), now);
  const entryStatus = req.entryStatus ?? (state === 'closed' ? 'registered' : 'not_registered');

  let reg: RegistrationRow;
  let interestAutoEnabled: boolean;
  try {
    ({ reg, interestAutoEnabled } = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(raceRegistrations)
        .values({
          userId,
          raceId: race.id,
          raceEventId: event.id,
          goalTimeSec,
          goalPaceSecPerKm: goalTimeSec === null ? null : goalPace(goalTimeSec, event.distanceM),
          goalSource: req.goalSource,
          entryStatus,
          // 앱이 값을 보내면 그 시각을 기록, 서버 기본값이면 null (tech/04)
          entryStatusUpdatedAt: req.entryStatus ? now : null,
          entryStatusSource: req.entryStatus ? (req.entryStatusSource ?? 'form') : null,
        })
        .returning();
      // 참가 예정에 추가하면 관심이 자동으로 켜진다 (PRD 4.8)
      const turnedOn = await tx
        .insert(raceInterests)
        .values({ userId, raceId: race.id })
        .onConflictDoNothing()
        .returning({ raceId: raceInterests.raceId });
      return { reg: row!, interestAutoEnabled: turnedOn.length > 0 };
    }));
  } catch (err) {
    if (isUniqueViolation(err, 'race_registrations_user_race_key')) {
      const [dup] = await db
        .select({ id: raceRegistrations.id })
        .from(raceRegistrations)
        .where(and(eq(raceRegistrations.userId, userId), eq(raceRegistrations.raceId, race.id)));
      throw new AppError('ALREADY_PLANNED', 'race already planned', {
        details: { registrationId: dup?.id },
      });
    }
    throw err;
  }

  const predictionId =
    goalTimeSec !== null && isPredictionSupported(event.distanceM)
      ? await predictForRegistration(db, userId, reg.id, now)
      : null;

  return toRegistration(reg, event, {
    predictionId,
    interestAutoEnabled,
    notice: entryStatus === 'not_registered' && (state === 'upcoming' || state === 'open'),
  });
}

/** 내 참가 예정 + 대회 + 종목. 없거나 남의 것이면 404 */
async function loadOwned(db: Db, userId: string, registrationId: string) {
  const [row] = await db
    .select({ reg: raceRegistrations, race: races, event: raceEvents })
    .from(raceRegistrations)
    .innerJoin(races, eq(races.id, raceRegistrations.raceId))
    .innerJoin(raceEvents, eq(raceEvents.id, raceRegistrations.raceEventId))
    .where(and(eq(raceRegistrations.id, registrationId), eq(raceRegistrations.userId, userId)));
  if (!row || row.race.publishStatus === 'draft') throw notFound('registration');
  return row;
}

/** GET /registrations/{id} */
export async function getRegistration(db: Db, userId: string, registrationId: string) {
  const { reg, event } = await loadOwned(db, userId, registrationId);
  return toRegistration(reg, event, {
    predictionId: await latestPredictionId(db, reg.id),
    interestAutoEnabled: false,
    notice: false,
  });
}

/** PATCH /registrations/{id} — 종목·목표·접수 상태 (tech/06 6.8) */
export async function updateRegistration(
  db: Db,
  userId: string,
  registrationId: string,
  req: UpdateRegistrationReq,
  now = new Date(),
): Promise<Registration> {
  const { reg, race, event: currentEvent } = await loadOwned(db, userId, registrationId);
  assertNotFinished(race, now);

  let event = currentEvent;
  if (req.raceEventId && req.raceEventId !== reg.raceEventId) {
    const [next] = await db
      .select()
      .from(raceEvents)
      .where(and(eq(raceEvents.id, req.raceEventId), eq(raceEvents.raceId, race.id)));
    if (!next) throw validationFailed([{ path: 'raceEventId', code: 'invalid_value' }]);
    event = next;
  }

  let goalTimeSec = reg.goalTimeSec;
  let goalSource = reg.goalSource as GoalSource;
  if (req.goalSource !== undefined) {
    goalSource = req.goalSource;
    goalTimeSec = req.goalSource === 'none' ? null : (req.goalTimeSec ?? null);
  } else if (event.distanceM !== currentEvent.distanceM) {
    // 거리가 다른 종목으로 바꾸고 목표를 보내지 않으면 목표를 지운다 (PRD 4.10 수정)
    goalSource = 'none';
    goalTimeSec = null;
  }
  if (goalTimeSec !== null && (req.goalSource !== undefined || event !== currentEvent)) {
    checkGoal(goalTimeSec, event);
  }

  // 접수 상태는 값이 실제로 바뀔 때만 시각·경로를 갱신한다 (같은 값 재전송은 멱등)
  const entryChanged = req.entryStatus !== undefined && req.entryStatus !== reg.entryStatus;

  const [updated] = await db
    .update(raceRegistrations)
    .set({
      raceEventId: event.id,
      goalTimeSec,
      goalPaceSecPerKm: goalTimeSec === null ? null : goalPace(goalTimeSec, event.distanceM),
      goalSource,
      ...(entryChanged && {
        entryStatus: req.entryStatus,
        entryStatusUpdatedAt: now,
        entryStatusSource: req.entryStatusSource,
      }),
    })
    .where(eq(raceRegistrations.id, reg.id))
    .returning();

  return toRegistration(updated!, event, {
    predictionId: await latestPredictionId(db, reg.id),
    interestAutoEnabled: false,
    notice: false,
  });
}

/** DELETE /registrations/{id} — 참가 예정 해제. 관심은 유지, 연결된 예측은 FK로 race_registration_id = null */
export async function deleteRegistration(
  db: Db,
  userId: string,
  registrationId: string,
  now = new Date(),
) {
  const { reg, race } = await loadOwned(db, userId, registrationId);
  assertNotFinished(race, now);
  await db.delete(raceRegistrations).where(eq(raceRegistrations.id, reg.id));
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * GET /me/races?tab= (tech/06 6.7). 숨김 대회도 unavailable로 포함, 초안은 제외.
 * interested: 관심 ∩ 대회일 ≥ 오늘 / upcoming: 참가 예정 ∩ 대회일 ≥ 오늘 / past: (관심 ∪ 참가 예정) ∩ 대회일 < 오늘 (최근 순)
 */
export async function listMyRaces(
  db: Db,
  userId: string,
  q: { tab: 'interested' | 'upcoming' | 'past'; cursor?: string | undefined; limit: number },
  now = new Date(),
): Promise<{ items: MyRaceItem[]; nextCursor: string | null }> {
  const today = kstDate(now);
  const interestIds = db
    .select({ id: raceInterests.raceId })
    .from(raceInterests)
    .where(eq(raceInterests.userId, userId));
  const registrationIds = db
    .select({ id: raceRegistrations.raceId })
    .from(raceRegistrations)
    .where(eq(raceRegistrations.userId, userId));

  const tabCond =
    q.tab === 'interested'
      ? and(inArray(races.id, interestIds), gte(races.raceDate, today))
      : q.tab === 'upcoming'
        ? and(inArray(races.id, registrationIds), gte(races.raceDate, today))
        : and(
            sql`(${inArray(races.id, interestIds)} OR ${inArray(races.id, registrationIds)})`,
            sql`${races.raceDate} < ${today}`,
          );

  const rows = await db
    .select()
    .from(races)
    .where(and(tabCond, ne(races.publishStatus, 'draft')));
  const ctx = await loadRaceContext(
    db,
    rows.map((r) => r.id),
    userId,
  );
  const items: MyRaceItem[] = rows.map((race) => ({
    ...toRaceSummary(race, ctx, now),
    registration: registrationBriefFor(race, ctx),
    unavailable: race.publishStatus === 'hidden',
  }));

  const desc = q.tab === 'past';
  const keyOf = (it: MyRaceItem) => [
    desc ? -dayNumber(it.raceDate) : dayNumber(it.raceDate),
    it.name,
    it.id,
  ];
  items.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  return paginate(items, keyOf, q.cursor, q.limit);
}
