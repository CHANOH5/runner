import { INTEREST_LIMIT } from '@berun/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { raceEvents, raceInterests, raceRegistrations, races } from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { effectiveWindow, registrationState } from '../../lib/registration-window.js';
import { findVisibleRace } from './service.js';

/**
 * PUT /races/{id}/interest — 켜기 (멱등, tech/06 6.6).
 * 200개 한도는 하트로 직접 켤 때만 검사하고, 개수에는 참가 예정으로 자동으로 켜진 관심도 포함한다 (PRD v1.6 4.8).
 * 지난 대회·취소 대회에도 켤 수 있다.
 */
export async function interestOn(db: Db, userId: string, raceId: string, now = new Date()) {
  const race = await findVisibleRace(db, raceId);
  const [existing] = await db
    .select()
    .from(raceInterests)
    .where(and(eq(raceInterests.userId, userId), eq(raceInterests.raceId, raceId)));
  if (!existing) {
    const count = await db.$count(raceInterests, eq(raceInterests.userId, userId));
    if (count >= INTEREST_LIMIT) {
      throw new AppError('LIMIT_EXCEEDED', 'too many interests', {
        details: { resource: 'interests', limit: INTEREST_LIMIT },
      });
    }
    await db.insert(raceInterests).values({ userId, raceId }).onConflictDoNothing();
  }
  const events = await db.select().from(raceEvents).where(eq(raceEvents.raceId, raceId));
  return {
    interested: true as const,
    notifyRegistrationOpen:
      registrationState(race, effectiveWindow(race, events), now) === 'upcoming',
  };
}

/**
 * DELETE /races/{id}/interest — 끄기 (멱등). 참가 예정은 유지한다.
 * 숨김 대회도 끌 수 있다 (내 대회 목록 정리, S-061). 초안·없는 대회는 404.
 */
export async function interestOff(db: Db, userId: string, raceId: string) {
  const [race] = await db
    .select({ publishStatus: races.publishStatus })
    .from(races)
    .where(eq(races.id, raceId));
  if (!race || race.publishStatus === 'draft') throw notFound('race');
  await db
    .delete(raceInterests)
    .where(and(eq(raceInterests.userId, userId), eq(raceInterests.raceId, raceId)));
  const stillRegistered =
    (await db.$count(
      raceRegistrations,
      and(eq(raceRegistrations.userId, userId), eq(raceRegistrations.raceId, raceId)),
    )) > 0;
  return { interested: false as const, stillRegistered };
}
