import { MyRacePage, Registration } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  predictions,
  raceInterests,
  raceRegistrations,
  runRecords,
} from '../src/db/schema/index.js';
import { addDays } from '../src/lib/time.js';
import {
  addInterest,
  addRegistration,
  call,
  createRace,
  createUser,
  DAY,
  errorOf,
  fromNow,
  today,
} from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => truncateAll(ctx.db));

const add = (userId: string, raceId: string, body: object) =>
  call(ctx, userId, 'POST', `/v1/races/${raceId}/registration`, body);
const patch = (userId: string, regId: string, body: object) =>
  call(ctx, userId, 'PATCH', `/v1/registrations/${regId}`, body);

async function regRow(id: string) {
  const [row] = await ctx.db.select().from(raceRegistrations).where(eq(raceRegistrations.id, id));
  return row!;
}

describe('POST /v1/races/{raceId}/registration', () => {
  it('접수 중 대회, 접수 상태 생략 → not_registered, 관심 자동 켜짐, 공식 접수 안내', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);

    const res = await add(user.id, race.id, { raceEventId: event.id, goalSource: 'none' });
    expect(res.statusCode).toBe(201);
    const body = Registration.parse(res.json());
    expect(body).toMatchObject({
      raceId: race.id,
      raceEventId: event.id,
      eventName: '하프코스',
      eventDistanceM: 21097,
      goalTimeSec: null,
      goalSource: 'none',
      entryStatus: 'not_registered',
      entryStatusUpdatedAt: null,
      predictionId: null,
      predictionSupported: true,
      interestAutoEnabled: true,
      showOfficialRegistrationNotice: true,
      warnings: [],
    });
    const row = await regRow(body.id);
    expect(row.entryStatusSource).toBeNull();
    expect(await ctx.db.$count(raceInterests)).toBe(1);
  });

  it('마감된 대회, 접수 상태 생략 → registered (서버 기본값, 시각은 null)', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx, {
      registrationOpensAt: fromNow(-20 * DAY),
      registrationClosesAt: fromNow(-DAY),
    });
    const res = await add(user.id, race.id, { raceEventId: event.id, goalSource: 'none' });
    const body = Registration.parse(res.json());
    expect(body.entryStatus).toBe('registered');
    expect(body.entryStatusUpdatedAt).toBeNull();
    expect(body.showOfficialRegistrationNotice).toBe(false);
  });

  it('앱이 접수 상태를 보내면 그 값·시각·경로(기본 form)를 저장', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    await addInterest(ctx, user.id, race.id);

    const res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'none',
      entryStatus: 'registered',
    });
    const body = Registration.parse(res.json());
    expect(body.entryStatus).toBe('registered');
    expect(body.entryStatusUpdatedAt).toMatch(/\+09:00$/);
    expect(body.interestAutoEnabled).toBe(false);
    expect((await regRow(body.id)).entryStatusSource).toBe('form');
  });

  it('missed로 생성하면 400', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'none',
      entryStatus: 'missed',
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors?.[0]?.path).toBe('entryStatus');
  });

  it('같은 대회 두 번째 추가 → 409 ALREADY_PLANNED (기존 id 포함)', async () => {
    const user = await createUser(ctx);
    const { race, events } = await createRace(ctx, {
      events: [{}, { name: '10km', category: '10k', distanceM: 10000 }],
    });
    const first = Registration.parse(
      (await add(user.id, race.id, { raceEventId: events[0]!.id, goalSource: 'none' })).json(),
    );
    const res = await add(user.id, race.id, { raceEventId: events[1]!.id, goalSource: 'none' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'ALREADY_PLANNED',
      details: { registrationId: first.id },
    });
  });

  it('취소 대회 409 RACE_CANCELLED, 지난 대회 409 RACE_FINISHED, 다른 대회 종목 400', async () => {
    const user = await createUser(ctx);
    const cancelled = await createRace(ctx, { status: 'cancelled' });
    const past = await createRace(ctx, { inDays: -1 });
    const other = await createRace(ctx);
    const target = await createRace(ctx);

    let res = await add(user.id, cancelled.race.id, {
      raceEventId: cancelled.event.id,
      goalSource: 'none',
    });
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'RACE_CANCELLED']);
    res = await add(user.id, past.race.id, { raceEventId: past.event.id, goalSource: 'none' });
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'RACE_FINISHED']);
    res = await add(user.id, target.race.id, { raceEventId: other.event.id, goalSource: 'none' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'raceEventId', code: 'invalid_value' }]);
  });

  it('목표 검증: 페이스 범위 밖 422, 제한 시간 초과는 경고만, 목표 페이스 서버 계산', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx, {
      events: [{ name: '풀코스', category: 'full', distanceM: 42195, timeLimitMin: 300 }],
    });
    // 풀 1:50:00 = 2'36"/km
    let res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'manual',
      goalTimeSec: 6600,
    });
    expect([res.statusCode, errorOf(res).code]).toEqual([422, 'GOAL_OUT_OF_RANGE']);

    // 5:20:00 > 제한 5시간 → 저장 + 경고
    res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'manual',
      goalTimeSec: 19200,
    });
    expect(res.statusCode).toBe(201);
    const body = Registration.parse(res.json());
    expect(body.warnings).toEqual(['GOAL_OVER_TIME_LIMIT']);
    expect(body.goalPaceSecPerKm).toBe(Math.round(19200 / 42.195));
  });

  it('PRD 수용 기준: 하프 목표 1:58:00 → goal_pace 336', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'manual',
      goalTimeSec: 7080,
    });
    expect(Registration.parse(res.json())).toMatchObject({
      goalTimeSec: 7080,
      goalPaceSecPerKm: 336,
    });
  });

  it('목표 + 예측 가능한 기록이 있으면 예측을 저장해 연결한다', async () => {
    const user = await createUser(ctx);
    await ctx.db.insert(runRecords).values({
      userId: user.id,
      distanceM: 10000,
      durationSec: 3300,
      runDate: addDays(today(), -30),
      category: '10k',
      kind: 'race',
    });
    const { race, event } = await createRace(ctx);
    const res = await add(user.id, race.id, {
      raceEventId: event.id,
      goalSource: 'prediction',
      goalTimeSec: 7300,
    });
    const body = Registration.parse(res.json());
    expect(body.predictionId).not.toBeNull();
    const [p] = await ctx.db
      .select()
      .from(predictions)
      .where(eq(predictions.id, body.predictionId!));
    expect(p!.raceRegistrationId).toBe(body.id);
  });

  it('goalSource가 manual인데 goalTimeSec 없음 → 400', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const res = await add(user.id, race.id, { raceEventId: event.id, goalSource: 'manual' });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'goalTimeSec', code: 'required' }]);
  });

  it('미래 참가 예정 30개 초과 → 422 LIMIT_EXCEEDED', async () => {
    const user = await createUser(ctx);
    for (let i = 0; i < 30; i++) {
      const { race, event } = await createRace(ctx, { inDays: 10 + i });
      await addRegistration(ctx, user.id, race.id, event.id);
    }
    const { race, event } = await createRace(ctx);
    const res = await add(user.id, race.id, { raceEventId: event.id, goalSource: 'none' });
    expect(errorOf(res)).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { resource: 'registrations', limit: 30 },
    });
  });

  it('초안 대회 404, 숨김 대회 410', async () => {
    const user = await createUser(ctx);
    const draft = await createRace(ctx, { publishStatus: 'draft', lastVerifiedAt: null });
    const hidden = await createRace(ctx, { publishStatus: 'hidden' });
    let res = await add(user.id, draft.race.id, {
      raceEventId: draft.event.id,
      goalSource: 'none',
    });
    expect(res.statusCode).toBe(404);
    res = await add(user.id, hidden.race.id, { raceEventId: hidden.event.id, goalSource: 'none' });
    expect([res.statusCode, errorOf(res).code]).toEqual([410, 'RACE_UNAVAILABLE']);
  });
});

describe('PATCH /v1/registrations/{id}', () => {
  it('접수 상태 변경 → 시각·경로 저장, 같은 값 재전송은 시각 불변', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, user.id, race.id, event.id);

    let res = await patch(user.id, reg.id, {
      entryStatus: 'registered',
      entryStatusSource: 'return_prompt',
    });
    expect(res.statusCode).toBe(200);
    const first = Registration.parse(res.json());
    expect(first.entryStatus).toBe('registered');
    expect(first.entryStatusUpdatedAt).not.toBeNull();
    expect((await regRow(reg.id)).entryStatusSource).toBe('return_prompt');

    res = await patch(user.id, reg.id, {
      entryStatus: 'registered',
      entryStatusSource: 'my_races',
    });
    const second = Registration.parse(res.json());
    expect(second.entryStatusUpdatedAt).toBe(first.entryStatusUpdatedAt);
    expect((await regRow(reg.id)).entryStatusSource).toBe('return_prompt');

    res = await patch(user.id, reg.id, { entryStatus: 'missed', entryStatusSource: 'race_detail' });
    expect(Registration.parse(res.json()).entryStatus).toBe('missed');
    // missed로 바꿔도 행은 남는다
    expect(await ctx.db.$count(raceRegistrations)).toBe(1);
  });

  it('entryStatus만 있고 entryStatusSource 없음 → 400', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, user.id, race.id, event.id);
    const res = await patch(user.id, reg.id, { entryStatus: 'registered' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'entryStatusSource', code: 'required' }]);
  });

  it('대회 당일은 변경 가능, 대회일 다음 날은 PATCH·DELETE 409 RACE_FINISHED', async () => {
    const user = await createUser(ctx);
    const todayRace = await createRace(ctx, { inDays: 0 });
    const pastRace = await createRace(ctx, { inDays: -1 });
    const r1 = await addRegistration(ctx, user.id, todayRace.race.id, todayRace.event.id);
    const r2 = await addRegistration(ctx, user.id, pastRace.race.id, pastRace.event.id);
    const body = { entryStatus: 'missed', entryStatusSource: 'race_detail' };

    expect((await patch(user.id, r1.id, body)).statusCode).toBe(200);
    let res = await patch(user.id, r2.id, body);
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'RACE_FINISHED']);
    res = await call(ctx, user.id, 'DELETE', `/v1/registrations/${r2.id}`);
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'RACE_FINISHED']);
  });

  it('거리가 다른 종목으로 바꾸고 목표를 보내지 않으면 목표를 지운다', async () => {
    const user = await createUser(ctx);
    const { race, events } = await createRace(ctx, {
      events: [{}, { name: '10km', category: '10k', distanceM: 10000 }],
    });
    const reg = await addRegistration(ctx, user.id, race.id, events[0]!.id, {
      goalTimeSec: 7080,
      goalPaceSecPerKm: 336,
      goalSource: 'manual',
    });
    const res = await patch(user.id, reg.id, { raceEventId: events[1]!.id });
    expect(Registration.parse(res.json())).toMatchObject({
      raceEventId: events[1]!.id,
      goalTimeSec: null,
      goalPaceSecPerKm: null,
      goalSource: 'none',
    });
  });

  it('남의 참가 예정은 404', async () => {
    const owner = await createUser(ctx);
    const other = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, owner.id, race.id, event.id);
    expect((await patch(other.id, reg.id, { goalSource: 'none' })).statusCode).toBe(404);
    expect((await call(ctx, other.id, 'GET', `/v1/registrations/${reg.id}`)).statusCode).toBe(404);
  });
});

describe('DELETE /v1/registrations/{id}', () => {
  it('해제: 관심은 유지, 연결된 예측은 race_registration_id = null', async () => {
    const user = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    await addInterest(ctx, user.id, race.id);
    const reg = await addRegistration(ctx, user.id, race.id, event.id);
    const [p] = await ctx.db
      .insert(predictions)
      .values({
        userId: user.id,
        raceRegistrationId: reg.id,
        targetDistanceM: 21097,
        predictedSec: 7400,
        rangeMinSec: 7200,
        rangeMaxSec: 7680,
        confidence: 'high',
        modelVersion: 'riegel-1.06-v1',
        inputSnapshot: {},
      })
      .returning();

    const res = await call(ctx, user.id, 'DELETE', `/v1/registrations/${reg.id}`);
    expect(res.statusCode).toBe(204);
    expect(await ctx.db.$count(raceRegistrations)).toBe(0);
    expect(await ctx.db.$count(raceInterests)).toBe(1);
    const [after] = await ctx.db.select().from(predictions).where(eq(predictions.id, p!.id));
    expect(after!.raceRegistrationId).toBeNull();
  });
});

describe('GET /v1/me/races', () => {
  it('탭별 목록, 참가 예정 접수 상태, 숨김 대회는 unavailable', async () => {
    const user = await createUser(ctx);
    const a = await createRace(ctx, { name: 'A 대회', inDays: 20 });
    const b = await createRace(ctx, { name: 'B 대회', inDays: 10 });
    const hidden = await createRace(ctx, { name: 'C 숨김', inDays: 15, publishStatus: 'hidden' });
    const past = await createRace(ctx, { name: 'D 지난', inDays: -5 });
    const draft = await createRace(ctx, {
      name: 'E 초안',
      publishStatus: 'draft',
      lastVerifiedAt: null,
    });

    await addRegistration(ctx, user.id, a.race.id, a.event.id, { entryStatus: 'registered' });
    await addRegistration(ctx, user.id, b.race.id, b.event.id);
    await addRegistration(ctx, user.id, hidden.race.id, hidden.event.id);
    await addInterest(ctx, user.id, a.race.id);
    await addInterest(ctx, user.id, past.race.id);
    await addInterest(ctx, user.id, draft.race.id);

    const upcoming = MyRacePage.parse(
      (await call(ctx, user.id, 'GET', '/v1/me/races?tab=upcoming')).json(),
    );
    expect(upcoming.items.map((i) => [i.name, i.registration?.entryStatus, i.unavailable])).toEqual(
      [
        ['B 대회', 'not_registered', false],
        ['C 숨김', 'not_registered', true],
        ['A 대회', 'registered', false],
      ],
    );

    const interested = MyRacePage.parse(
      (await call(ctx, user.id, 'GET', '/v1/me/races?tab=interested')).json(),
    );
    expect(interested.items.map((i) => i.name)).toEqual(['A 대회']);

    const pastTab = MyRacePage.parse(
      (await call(ctx, user.id, 'GET', '/v1/me/races?tab=past')).json(),
    );
    expect(pastTab.items.map((i) => i.name)).toEqual(['D 지난']);
  });

  it('커서 페이지네이션', async () => {
    const user = await createUser(ctx);
    for (let i = 0; i < 3; i++) {
      const { race, event } = await createRace(ctx, { name: `대회 ${i}`, inDays: 5 + i });
      await addRegistration(ctx, user.id, race.id, event.id);
    }
    const p1 = MyRacePage.parse(
      (await call(ctx, user.id, 'GET', '/v1/me/races?tab=upcoming&limit=2')).json(),
    );
    expect(p1.items.map((i) => i.name)).toEqual(['대회 0', '대회 1']);
    const p2 = MyRacePage.parse(
      (
        await call(ctx, user.id, 'GET', `/v1/me/races?tab=upcoming&limit=2&cursor=${p1.nextCursor}`)
      ).json(),
    );
    expect([p2.items.map((i) => i.name), p2.nextCursor]).toEqual([['대회 2'], null]);
  });
});
