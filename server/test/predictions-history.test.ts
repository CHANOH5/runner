import { Prediction, PredictionCandidates, PredictionPage, Strategy } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { predictions, raceRegistrations, runRecords } from '../src/db/schema/index.js';
import { addDays, kstDate } from '../src/lib/time.js';
import { addRegistration, call, createRace, createUser, errorOf } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

const HALF = 21097;
let ctx: TestContext;
let userId: string;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  userId = (await createUser(ctx)).id;
});

const today = () => kstDate(new Date());

/** PRD 5.7 예시 1 기록 (60·150·300일 전) + 예측에 못 쓰는 기록 2개 */
async function records() {
  return ctx.db
    .insert(runRecords)
    .values(
      [
        [10000, 3300, 60],
        [10000, 3390, 150],
        [10000, 3430, 300],
        [2000, 600, 5], // 3km 미만
        [10000, 3000, 400], // 365일 초과
      ].map(([d, t, days]) => ({
        userId,
        distanceM: d!,
        durationSec: t!,
        runDate: addDays(today(), -days!),
        category: d === 10000 ? '10k' : 'other',
        kind: 'race',
      })),
    )
    .returning();
}

const predict = (body: object) => call(ctx, userId, 'POST', '/v1/me/predictions', body);

describe('GET /v1/me/predictions/candidates (S-032)', () => {
  it('eligible 기록만, 가중치 순, 반영 라벨, 자동 선택 상위 5개', async () => {
    const [a, b, c] = await records();
    const res = await call(
      ctx,
      userId,
      'GET',
      `/v1/me/predictions/candidates?targetDistanceM=${HALF}`,
    );
    const body = PredictionCandidates.parse(res.json());
    expect(body.emptyReason).toBeNull();
    expect(body.records.map((r) => [r.record.id, r.weight, r.weightLabel, r.autoSelected])).toEqual(
      [
        [a!.id, 0.8, 'high', true],
        [b!.id, 0.56, 'medium', true],
        [c!.id, 0.32, 'low', true],
      ],
    );
    expect(body.records[0]!.record).toMatchObject({ paceSecPerKm: 330, usableForPrediction: true });
  });

  it('6개 이상이면 상위 5개만 autoSelected, 기록 없으면 emptyReason', async () => {
    let res = await call(
      ctx,
      userId,
      'GET',
      `/v1/me/predictions/candidates?targetDistanceM=${HALF}`,
    );
    expect(PredictionCandidates.parse(res.json())).toEqual({ records: [], emptyReason: 'none' });
    await ctx.db.insert(runRecords).values(
      Array.from({ length: 6 }, (_, i) => ({
        userId,
        distanceM: 10000,
        durationSec: 3000 + i,
        runDate: addDays(today(), -i - 1),
        category: '10k',
        kind: 'race',
      })),
    );
    res = await call(ctx, userId, 'GET', `/v1/me/predictions/candidates?targetDistanceM=${HALF}`);
    expect(PredictionCandidates.parse(res.json()).records.map((r) => r.autoSelected)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(
      (await call(ctx, userId, 'GET', '/v1/me/predictions/candidates?targetDistanceM=2000'))
        .statusCode,
    ).toBe(400);
  });
});

describe('GET /v1/me/predictions, /{id} (S-030, S-033)', () => {
  it('최근순 요약·커서, 상세는 저장된 그대로 (재계산 없음), 기록이 바뀌면 recordsChangedSince', async () => {
    await records();
    const first = Prediction.parse(
      (await predict({ target: { type: 'distance', distanceM: HALF }, recordIds: null })).json(),
    );
    const second = Prediction.parse(
      (await predict({ target: { type: 'distance', distanceM: 10000 }, recordIds: null })).json(),
    );

    const p1 = PredictionPage.parse(
      (await call(ctx, userId, 'GET', '/v1/me/predictions?limit=1')).json(),
    );
    expect(p1.items.map((p) => p.id)).toEqual([second.id]);
    expect(p1.items[0]).not.toHaveProperty('splits');
    const p2 = PredictionPage.parse(
      (await call(ctx, userId, 'GET', `/v1/me/predictions?limit=1&cursor=${p1.nextCursor}`)).json(),
    );
    expect([p2.items.map((p) => p.id), p2.nextCursor]).toEqual([[first.id], null]);

    // 저장된 값 그대로 — 기록을 지워도 숫자는 같고 "기록이 바뀌었어요" 표시만
    await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/me/records/${first.usedRecords[0]!.recordId}`,
      headers: { authorization: `Bearer ${await ctx.tokenFor(userId)}` },
    });
    const detail = Prediction.parse(
      (await call(ctx, userId, 'GET', `/v1/me/predictions/${first.id}`)).json(),
    );
    expect({ ...detail, recordsChangedSince: false }).toEqual(first);
    expect(detail.recordsChangedSince).toBe(true);
  });

  it('남의 예측은 404', async () => {
    await records();
    const mine = Prediction.parse(
      (await predict({ target: { type: 'distance', distanceM: HALF }, recordIds: null })).json(),
    );
    const other = await createUser(ctx);
    expect((await call(ctx, other.id, 'GET', `/v1/me/predictions/${mine.id}`)).statusCode).toBe(
      404,
    );
  });

  it('참가 예정이 해제되면 상세의 race는 null (거리만 표시)', async () => {
    await records();
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, userId, race.id, event.id);
    const p = Prediction.parse(
      (
        await predict({ target: { type: 'registration', registrationId: reg.id }, recordIds: null })
      ).json(),
    );
    expect(p.race?.id).toBe(race.id);
    await ctx.db.delete(raceRegistrations).where(eq(raceRegistrations.id, reg.id));
    const after = Prediction.parse(
      (await call(ctx, userId, 'GET', `/v1/me/predictions/${p.id}`)).json(),
    );
    expect([after.raceRegistrationId, after.race]).toEqual([null, null]);
  });
});

describe('GET /v1/registrations/{id}/strategy (F-021)', () => {
  it('예측이 없으면 새로 계산·저장, 있으면 최신 것 그대로 + 목표 기준 스플릿', async () => {
    await records();
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, userId, race.id, event.id, {
      goalTimeSec: 7402,
      goalPaceSecPerKm: 351,
      goalSource: 'manual',
    });
    const url = `/v1/registrations/${reg.id}/strategy`;
    const s1 = Strategy.parse((await call(ctx, userId, 'GET', url)).json());
    expect(s1.prediction).toMatchObject({ predictedSec: 7402, raceRegistrationId: reg.id });
    expect(s1.predictionUnavailableReason).toBeNull();
    // 목표 2:03:22 하프 → PRD 5.7 예시 1과 같은 스플릿
    expect(s1.goalSplits?.even.at(0)).toEqual({
      atM: 5000,
      cumulativeSec: 1754,
      segmentPaceSecPerKm: 351,
    });
    expect(await ctx.db.$count(predictions)).toBe(1);

    const s2 = Strategy.parse((await call(ctx, userId, 'GET', url)).json());
    expect(s2.prediction?.id).toBe(s1.prediction?.id);
    expect(await ctx.db.$count(predictions)).toBe(1);
    expect(s1.prediction?.recordsChangedSince).toBe(false);

    // 기록이 바뀌면 다시 계산하지 않고 recordsChangedSince = true (PRD v1.9 6.17 — S-033 "기록이 바뀌었어요 · 다시 예측")
    await call(ctx, userId, 'POST', '/v1/me/records', {
      category: '5k',
      distanceM: 5000,
      durationSec: 1500,
      runDate: addDays(today(), -1),
      kind: 'training',
      title: null,
    });
    const s3 = Strategy.parse((await call(ctx, userId, 'GET', url)).json());
    expect(s3.prediction).toMatchObject({
      id: s1.prediction?.id,
      predictedSec: 7402,
      recordsChangedSince: true,
    });
    expect(await ctx.db.$count(predictions)).toBe(1);
  });

  it('기록 없음 → no_records (목표 있으면 목표 스플릿만), 미지원 거리 → unsupported_distance', async () => {
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, userId, race.id, event.id, {
      goalTimeSec: 7200,
      goalPaceSecPerKm: 341,
      goalSource: 'manual',
    });
    let s = Strategy.parse(
      (await call(ctx, userId, 'GET', `/v1/registrations/${reg.id}/strategy`)).json(),
    );
    expect(s).toMatchObject({ prediction: null, predictionUnavailableReason: 'no_records' });
    expect(s.goalSplits?.even.at(-1)).toMatchObject({ atM: HALF, cumulativeSec: 7200 });

    await records();
    const ultra = await createRace(ctx, {
      events: [{ name: '50K', category: 'other', distanceM: 50000 }],
    });
    const reg2 = await addRegistration(ctx, userId, ultra.race.id, ultra.event.id);
    s = Strategy.parse(
      (await call(ctx, userId, 'GET', `/v1/registrations/${reg2.id}/strategy`)).json(),
    );
    expect(s).toEqual({
      prediction: null,
      predictionUnavailableReason: 'unsupported_distance',
      goalSplits: null,
    });
  });

  it('남의 참가 예정은 404', async () => {
    const other = await createUser(ctx);
    const { race, event } = await createRace(ctx);
    const reg = await addRegistration(ctx, other.id, race.id, event.id);
    const res = await call(ctx, userId, 'GET', `/v1/registrations/${reg.id}/strategy`);
    expect([res.statusCode, errorOf(res).code]).toEqual([404, 'NOT_FOUND']);
  });
});
