import { HomeDeadlines, HomeNextRace, HomeRecommended } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRecords } from '../src/db/schema/index.js';
import { addDays, kstDate, toKstIso } from '../src/lib/time.js';
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

describe('GET /v1/home/next-race (PRD 6.7 ②)', () => {
  it('대회일 ≥ 오늘인 참가 예정 중 가장 빠른 것 + 외 n개, 기록 유무', async () => {
    const user = await createUser(ctx);
    const empty = HomeNextRace.parse(
      (await call(ctx, user.id, 'GET', '/v1/home/next-race')).json(),
    );
    expect(empty).toEqual({ next: null, moreCount: 0, hasAnyRecord: false });

    const later = await createRace(ctx, { name: '나중', inDays: 30 });
    const sooner = await createRace(ctx, {
      name: '먼저',
      inDays: 10,
      events: [{ name: '풀코스', category: 'full', distanceM: 42195 }],
    });
    const past = await createRace(ctx, { name: '지난', inDays: -1 });
    const hidden = await createRace(ctx, { name: '숨김', inDays: 5, publishStatus: 'hidden' });
    for (const r of [later, sooner, past, hidden]) {
      await addRegistration(ctx, user.id, r.race.id, r.event.id, { entryStatus: 'registered' });
    }
    await ctx.db.insert(runRecords).values({
      userId: user.id,
      distanceM: 10000,
      durationSec: 3000,
      runDate: addDays(kstDate(new Date()), -3),
      category: '10k',
      kind: 'race',
    });
    const res = HomeNextRace.parse((await call(ctx, user.id, 'GET', '/v1/home/next-race')).json());
    expect(res.next).toMatchObject({
      race: { name: '먼저', dDay: 10 },
      registration: { eventName: '풀코스', entryStatus: 'registered' },
      eventCategory: 'full',
    });
    expect([res.moreCount, res.hasAnyRecord]).toEqual([1, true]);
  });
});

describe('GET /v1/home/next-race — 접수 못 함 제외 (PRD v1.9)', () => {
  it('missed는 카드와 "외 n개"에서 빠지고, missed만 남으면 next: null', async () => {
    const user = await createUser(ctx);
    const missed = await createRace(ctx, { name: '못 나감', inDays: 3 });
    const real = await createRace(ctx, { name: '나감', inDays: 20 });
    const other = await createRace(ctx, { name: '또 못 나감', inDays: 30 });
    await addRegistration(ctx, user.id, missed.race.id, missed.event.id, { entryStatus: 'missed' });
    const reg = await addRegistration(ctx, user.id, real.race.id, real.event.id);
    await addRegistration(ctx, user.id, other.race.id, other.event.id, { entryStatus: 'missed' });

    let res = HomeNextRace.parse((await call(ctx, user.id, 'GET', '/v1/home/next-race')).json());
    expect([res.next?.race.name, res.moreCount]).toEqual(['나감', 0]);

    await call(ctx, user.id, 'PATCH', `/v1/registrations/${reg.id}`, {
      entryStatus: 'missed',
      entryStatusSource: 'race_detail',
    });
    res = HomeNextRace.parse((await call(ctx, user.id, 'GET', '/v1/home/next-race')).json());
    expect(res).toMatchObject({ next: null, moreCount: 0 });
    // S-061 참가 예정 탭에는 그대로 (회색 표시용)
    const tab = (await call(ctx, user.id, 'GET', '/v1/me/races?tab=upcoming')).json<{
      items: unknown[];
    }>();
    expect(tab.items).toHaveLength(3);
  });
});

describe('GET /v1/home/recommended (PRD 6.7 ④)', () => {
  it('내 지역·90일 안·접수 예정/중/미정, 관심·참가 예정 제외, 대회일 순', async () => {
    const user = await createUser(ctx); // fixtures: 지역 서울
    await createRace(ctx, { name: '서울 B', inDays: 20 });
    await createRace(ctx, { name: '서울 A', inDays: 10 });
    await createRace(ctx, {
      name: '서울 C',
      inDays: 30,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
    await createRace(ctx, { name: '서울 91일', inDays: 91 });
    await createRace(ctx, { name: '서울 마감', registrationClosesAt: fromNow(-DAY) });
    await createRace(ctx, { name: '서울 취소', status: 'cancelled' });
    const mine = await createRace(ctx, { name: '서울 관심' });
    await addInterest(ctx, user.id, mine.race.id);
    await createRace(ctx, { name: '부산', regionCode: 'busan' });

    const res = HomeRecommended.parse(
      (await call(ctx, user.id, 'GET', '/v1/home/recommended')).json(),
    );
    expect(res).toMatchObject({ regionCode: 'seoul', filledNationwide: false });
    expect(res.items.map((i) => i.name)).toEqual(['서울 A', '서울 B', '서울 C']);
  });

  it('3개 미만이면 전국에서 관심 수 많은 순으로 10개까지 보충 (중복 없음)', async () => {
    const user = await createUser(ctx);
    await createRace(ctx, { name: '서울 하나' });
    const popular = await createRace(ctx, { name: '대구 인기', regionCode: 'daegu', inDays: 40 });
    await createRace(ctx, { name: '부산 보통', regionCode: 'busan', inDays: 5 });
    for (let i = 0; i < 3; i++) {
      const fan = await createUser(ctx);
      await addInterest(ctx, fan.id, popular.race.id);
    }
    const res = HomeRecommended.parse(
      (await call(ctx, user.id, 'GET', '/v1/home/recommended')).json(),
    );
    expect(res.filledNationwide).toBe(true);
    expect(res.items.map((i) => i.name)).toEqual(['서울 하나', '대구 인기', '부산 보통']);
  });
});
