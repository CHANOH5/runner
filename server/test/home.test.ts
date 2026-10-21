import { HomeDeadlines } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toKstIso } from '../src/lib/time.js';
import {
  addInterest,
  addRegistration,
  call,
  createRace,
  createUser,
  DAY,
  fromNow,
  HOUR,
} from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => truncateAll(ctx.db));

const deadlines = async (userId: string) =>
  HomeDeadlines.parse((await call(ctx, userId, 'GET', '/v1/home/deadlines')).json()).items;

/** 2일 뒤 오픈하는 대회 + 2일 뒤 마감하는 대회 */
async function twoRaces(name: string) {
  const opening = await createRace(ctx, {
    name: `${name} 오픈`,
    registrationOpensAt: fromNow(2 * DAY),
    registrationClosesAt: fromNow(20 * DAY),
  });
  const closing = await createRace(ctx, {
    name: `${name} 마감`,
    registrationOpensAt: fromNow(-10 * DAY),
    registrationClosesAt: fromNow(2 * DAY + HOUR),
  });
  return { opening, closing };
}

describe('GET /v1/home/deadlines (PRD v1.5 6.7 ③ — N-01~N-03과 같은 대상)', () => {
  it('관심만 → 오픈·마감 행 모두 포함', async () => {
    const user = await createUser(ctx);
    const { opening, closing } = await twoRaces('관심');
    await addInterest(ctx, user.id, opening.race.id);
    await addInterest(ctx, user.id, closing.race.id);
    expect((await deadlines(user.id)).map((i) => [i.race.name, i.type])).toEqual([
      ['관심 오픈', 'opens'],
      ['관심 마감', 'closes'],
    ]);
  });

  it('참가 예정 not_registered → 포함, registered·missed → 둘 다 제외, 관심 + registered → 제외', async () => {
    const user = await createUser(ctx);
    const nr = await twoRaces('접수전');
    const reg = await twoRaces('접수완료');
    const missed = await twoRaces('접수못함');
    for (const { race, event } of [nr.opening, nr.closing]) {
      await addRegistration(ctx, user.id, race.id, event.id, { entryStatus: 'not_registered' });
    }
    for (const { race, event } of [reg.opening, reg.closing]) {
      await addInterest(ctx, user.id, race.id);
      await addRegistration(ctx, user.id, race.id, event.id, { entryStatus: 'registered' });
    }
    for (const { race, event } of [missed.opening, missed.closing]) {
      await addRegistration(ctx, user.id, race.id, event.id, { entryStatus: 'missed' });
    }
    expect((await deadlines(user.id)).map((i) => i.race.name).sort()).toEqual(
      ['접수전 마감', '접수전 오픈'].sort(),
    );
  });

  it('참가 예정자의 마감 행 시각 = 고른 종목의 마감, 관심만이면 유효 마감', async () => {
    const user = await createUser(ctx);
    const other = await createUser(ctx);
    const eventClose = fromNow(DAY);
    const { race, events } = await createRace(ctx, {
      registrationOpensAt: fromNow(-10 * DAY),
      registrationClosesAt: fromNow(2 * DAY),
      events: [
        { registrationClosesAt: eventClose },
        { name: '10km', category: '10k', distanceM: 10000 },
      ],
    });
    await addRegistration(ctx, user.id, race.id, events[0]!.id);
    await addInterest(ctx, other.id, race.id);

    const [mine] = await deadlines(user.id);
    expect(mine).toMatchObject({ type: 'closes', at: toKstIso(eventClose), timeKnown: true });
    const [theirs] = await deadlines(other.id);
    expect(theirs!.at).toBe(toKstIso(race.registrationClosesAt!));
  });

  it('7일 넘게 남은 오픈·3일 넘게 남은 마감·마감 없는 대회·취소 대회는 빠진다, 최대 5개', async () => {
    const user = await createUser(ctx);
    const far = await createRace(ctx, {
      registrationOpensAt: fromNow(8 * DAY),
      registrationClosesAt: fromNow(20 * DAY),
    });
    const farClose = await createRace(ctx, { registrationClosesAt: fromNow(4 * DAY) });
    const noClose = await createRace(ctx, { registrationClosesAt: null, inDays: 60 });
    const cancelled = await createRace(ctx, {
      status: 'cancelled',
      registrationClosesAt: fromNow(DAY),
    });
    for (const r of [far, farClose, noClose, cancelled]) await addInterest(ctx, user.id, r.race.id);
    expect(await deadlines(user.id)).toEqual([]);

    for (let i = 0; i < 6; i++) {
      const r = await createRace(ctx, { registrationClosesAt: fromNow((i + 1) * 6 * HOUR) });
      await addInterest(ctx, user.id, r.race.id);
    }
    const items = await deadlines(user.id);
    expect(items).toHaveLength(5);
    expect(items.map((i) => Date.parse(i.at))).toEqual(
      [...items.map((i) => Date.parse(i.at))].sort((a, b) => a - b),
    );
  });

  it('오픈 시각 미정이면 timeKnown=false', async () => {
    const user = await createUser(ctx);
    const r = await createRace(ctx, {
      registrationOpensAt: fromNow(3 * DAY),
      registrationOpensTimeKnown: false,
    });
    await addInterest(ctx, user.id, r.race.id);
    expect((await deadlines(user.id))[0]).toMatchObject({ type: 'opens', timeKnown: false });
  });
});
