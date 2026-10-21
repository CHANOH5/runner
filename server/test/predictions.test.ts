import { ApiError, Prediction } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  predictions,
  raceEvents,
  raceRegistrations,
  races,
  runRecords,
  users,
} from '../src/db/schema/index.js';
import { addDays, kstDate } from '../src/lib/time.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

const HALF = 21097;

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => truncateAll(ctx.db));

async function createUser() {
  const [user] = await ctx.db.insert(users).values({ birthYear: 1990 }).returning();
  return user!;
}

/** PRD 5.7 예시 1의 10K 기록 3개 (오늘 KST 기준 60·150·300일 전) */
async function addExample1Records(userId: string) {
  const today = kstDate(new Date());
  return ctx.db
    .insert(runRecords)
    .values(
      [
        [3300, 60],
        [3390, 150],
        [3430, 300],
      ].map(([sec, days]) => ({
        userId,
        distanceM: 10000,
        durationSec: sec!,
        runDate: addDays(today, -days!),
        category: '10k',
        kind: 'race',
      })),
    )
    .returning();
}

async function createRace(opts: { distanceM?: number; timeLimitMin?: number | null } = {}) {
  const [race] = await ctx.db
    .insert(races)
    .values({
      name: '테스트 하프',
      slug: `test-${uuidv7()}`,
      regionCode: 'seoul',
      raceDate: addDays(kstDate(new Date()), 30),
      publishStatus: 'published',
      dedupeKey: 'test',
      officialUrl: 'https://example.com',
      lastVerifiedAt: new Date(),
    })
    .returning();
  const [event] = await ctx.db
    .insert(raceEvents)
    .values({
      raceId: race!.id,
      name: '하프코스',
      category: 'half',
      distanceM: opts.distanceM ?? HALF,
      startAt: new Date('2026-11-15T08:00:00+09:00'),
      timeLimitMin: opts.timeLimitMin === undefined ? 120 : opts.timeLimitMin,
    })
    .returning();
  return { race: race!, event: event! };
}

async function register(userId: string, raceId: string, raceEventId: string) {
  const [reg] = await ctx.db
    .insert(raceRegistrations)
    .values({ userId, raceId, raceEventId })
    .returning();
  return reg!;
}

async function post(userId: string | null, body: unknown, url = '/v1/me/predictions') {
  return ctx.app.inject({
    method: 'POST',
    url,
    headers: userId ? { authorization: `Bearer ${await ctx.tokenFor(userId)}` } : {},
    payload: body as object,
  });
}

function errorOf(res: { json: () => unknown }) {
  return ApiError.parse(res.json()).error;
}

describe('POST /v1/me/predictions', () => {
  it('토큰이 없으면 401 UNAUTHENTICATED', async () => {
    const res = await post(null, {
      target: { type: 'distance', distanceM: HALF },
      recordIds: null,
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHENTICATED');
  });

  it('만료된 토큰은 401', async () => {
    const user = await createUser();
    const { signAccessToken } = await import('../src/modules/auth/tokens.js');
    const token = await signAccessToken(
      ctx.privateKey,
      { userId: user.id, sessionId: uuidv7() },
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/me/predictions',
      headers: { authorization: `Bearer ${token}` },
      payload: { target: { type: 'distance', distanceM: HALF }, recordIds: null },
    });
    expect(res.statusCode).toBe(401);
  });

  it('거리 대상: PRD 예시 1 결과를 돌려주고 저장한다', async () => {
    const user = await createUser();
    await addExample1Records(user.id);

    const res = await post(user.id, {
      target: { type: 'distance', distanceM: HALF },
      recordIds: null,
    });
    expect(res.statusCode).toBe(201);
    const body = Prediction.parse(res.json());
    expect(body).toMatchObject({
      modelVersion: 'riegel-1.06-v1',
      targetDistanceM: HALF,
      predictedSec: 7402,
      rangeMinSec: 7200,
      rangeMaxSec: 7680,
      rangeDisplayUnit: 'minute',
      avgPaceSecPerKm: 351,
      confidence: 'high',
      confidenceReason: 'high',
      firstFullSuggestionSec: null,
      timeLimitWarning: false,
      raceRegistrationId: null,
      race: null,
      recordsChangedSince: false,
    });
    expect(body.usedRecords.map((r) => r.convertedSec)).toEqual([7281, 7480, 7568]);
    expect(body.createdAt).toMatch(/\+09:00$/);

    const [row] = await ctx.db.select().from(predictions).where(eq(predictions.id, body.id!));
    expect(row).toMatchObject({
      userId: user.id,
      predictedSec: 7402,
      confidence: 'high',
      modelVersion: 'riegel-1.06-v1',
    });
    expect(row!.inputSnapshot).toMatchObject({
      selection: 'auto',
      predictionDate: kstDate(new Date()),
    });
    expect(row!.splits).toEqual(body.splits);
  });

  it('참가 등록 대상: 종목 거리·제한 시간을 쓰고 대회 정보를 붙인다', async () => {
    const user = await createUser();
    await addExample1Records(user.id);
    const { race, event } = await createRace({ timeLimitMin: 120 });
    const reg = await register(user.id, race.id, event.id);

    const res = await post(user.id, {
      target: { type: 'registration', registrationId: reg.id },
      recordIds: null,
    });
    expect(res.statusCode).toBe(201);
    const body = Prediction.parse(res.json());
    expect(body.raceRegistrationId).toBe(reg.id);
    expect(body.race).toEqual({
      id: race.id,
      name: '테스트 하프',
      eventName: '하프코스',
      startAt: '2026-11-15T08:00:00+09:00',
    });
    // 상한 2:08 > 제한 시간 2:00
    expect(body.timeLimitWarning).toBe(true);
  });

  it('남의 참가 등록이면 404', async () => {
    const owner = await createUser();
    const other = await createUser();
    await addExample1Records(other.id);
    const { race, event } = await createRace();
    const reg = await register(owner.id, race.id, event.id);

    const res = await post(other.id, {
      target: { type: 'registration', registrationId: reg.id },
      recordIds: null,
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
  });

  it('지원하지 않는 종목 거리는 기록이 없어도 422 TARGET_DISTANCE_UNSUPPORTED', async () => {
    const user = await createUser();
    const { race, event } = await createRace({ distanceM: 50000 });
    const reg = await register(user.id, race.id, event.id);

    const res = await post(user.id, {
      target: { type: 'registration', registrationId: reg.id },
      recordIds: null,
    });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: 'TARGET_DISTANCE_UNSUPPORTED',
      details: { distanceM: 50000 },
    });
  });

  it('거리 대상 범위 밖은 스키마 400 VALIDATION_FAILED', async () => {
    const user = await createUser();
    const res = await post(user.id, {
      target: { type: 'distance', distanceM: 2000 },
      recordIds: null,
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ path: 'target.distanceM', code: 'out_of_range' }],
    });
  });

  it('race_event 대상은 preview 전용 → 400', async () => {
    const user = await createUser();
    const { event } = await createRace();
    const res = await post(user.id, {
      target: { type: 'race_event', raceEventId: event.id },
      recordIds: null,
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'target.type', code: 'invalid_value' }]);
  });

  it('예측에 쓸 기록이 없으면 422 NO_ELIGIBLE_RECORDS (none / all_older_than_365d)', async () => {
    const user = await createUser();
    const body = { target: { type: 'distance', distanceM: HALF }, recordIds: null };

    let res = await post(user.id, body);
    expect(res.statusCode).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: 'NO_ELIGIBLE_RECORDS',
      details: { reason: 'none' },
    });

    await ctx.db.insert(runRecords).values({
      userId: user.id,
      distanceM: 10000,
      durationSec: 3000,
      runDate: addDays(kstDate(new Date()), -400),
      category: '10k',
      kind: 'race',
    });
    res = await post(user.id, body);
    expect(errorOf(res).details).toEqual({ reason: 'all_older_than_365d' });
  });

  it('기록 6개 이상 선택은 422 LIMIT_EXCEEDED', async () => {
    const user = await createUser();
    const res = await post(user.id, {
      target: { type: 'distance', distanceM: HALF },
      recordIds: Array.from({ length: 6 }, () => uuidv7()),
    });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { resource: 'prediction_records', limit: 5 },
    });
  });

  it('직접 고른 기록: 남의 기록·조건 밖 기록은 400 fieldErrors, 정상이면 고른 기록만 사용', async () => {
    const user = await createUser();
    const [a, b] = await addExample1Records(user.id);
    const [old] = await ctx.db
      .insert(runRecords)
      .values({
        userId: user.id,
        distanceM: 10000,
        durationSec: 3000,
        runDate: addDays(kstDate(new Date()), -400),
        category: '10k',
        kind: 'race',
      })
      .returning();

    let res = await post(user.id, {
      target: { type: 'distance', distanceM: HALF },
      recordIds: [a!.id, old!.id, uuidv7()],
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([
      { path: 'recordIds[1]', code: 'not_eligible' },
      { path: 'recordIds[2]', code: 'not_found' },
    ]);

    res = await post(user.id, {
      target: { type: 'distance', distanceM: HALF },
      recordIds: [a!.id, b!.id],
    });
    expect(res.statusCode).toBe(201);
    const body = Prediction.parse(res.json());
    expect(body.usedRecords.map((r) => r.recordId)).toEqual([a!.id, b!.id]);
    // 같은 가중치: (7280.9 + 7479.5) / 2 = 7380.2
    expect(body.predictedSec).toBe(7380);
  });
});

describe('POST /v1/me/predictions/preview', () => {
  it('race_event 대상으로 계산만 하고 저장하지 않는다', async () => {
    const user = await createUser();
    await addExample1Records(user.id);
    const { event } = await createRace({ timeLimitMin: null });

    const res = await post(
      user.id,
      { target: { type: 'race_event', raceEventId: event.id }, recordIds: null },
      '/v1/me/predictions/preview',
    );
    expect(res.statusCode).toBe(200);
    const body = Prediction.parse(res.json());
    expect(body).toMatchObject({ id: null, createdAt: null, predictedSec: 7402 });
    expect(await ctx.db.$count(predictions)).toBe(0);
  });

  it('초안 대회 종목은 404', async () => {
    const user = await createUser();
    const { race, event } = await createRace();
    await ctx.db.update(races).set({ publishStatus: 'draft' }).where(eq(races.id, race.id));
    const res = await post(
      user.id,
      { target: { type: 'race_event', raceEventId: event.id }, recordIds: null },
      '/v1/me/predictions/preview',
    );
    expect(res.statusCode).toBe(404);
  });
});
