import { RaceCalendar, RaceCount, RacePage } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/time.js';
import { call, createRace, createUser, DAY, errorOf, fromNow, today } from './fixtures.js';
import { createTestContext, truncateAll, type TestContext } from './helpers.js';

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

/** "2026-11" + n개월 */
function month(n: number) {
  const [y, m] = today().split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const count = async (qs = '') => {
  const res = await call(ctx, userId, 'GET', `/v1/races/count${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return RaceCount.parse(res.json()).count;
};
const total = async (qs = '') => {
  const res = await call(ctx, userId, 'GET', `/v1/races?limit=50${qs ? `&${qs.slice(1)}` : ''}`);
  return RacePage.parse(res.json()).items.length;
};
const calendar = async (qs: string) => {
  const res = await call(ctx, userId, 'GET', `/v1/races/calendar${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return RaceCalendar.parse(res.json());
};

describe('GET /v1/races/count', () => {
  it('목록과 같은 필터 규칙으로 센다 (지역·종목·참가비·접수 상태·검색·취소 숨김)', async () => {
    await createRace(ctx, { name: '서울 하프', inDays: 10 });
    await createRace(ctx, {
      name: '부산 10K',
      inDays: 20,
      regionCode: 'busan',
      events: [{ name: '10K', category: '10k', distanceM: 10000, feeKrw: 30000 }],
    });
    await createRace(ctx, {
      name: '접수 예정 풀',
      inDays: 60,
      registrationOpensAt: fromNow(5 * DAY),
      registrationClosesAt: fromNow(20 * DAY),
      events: [{ name: '풀', category: 'full', distanceM: 42195, feeKrw: 80000 }],
    });
    await createRace(ctx, { name: '취소된 대회', inDays: 15, status: 'cancelled' });
    await createRace(ctx, { name: '지난 서울 대회', inDays: -3 });
    await createRace(ctx, { name: '초안', publishStatus: 'draft', lastVerifiedAt: null });

    const cases = [
      '',
      '?region=busan',
      '?region=seoul&region=busan',
      '?category=full&category=10k',
      '?fee=le30k',
      '?registrationState=upcoming',
      '?hideCancelled=true',
      '?includeEnded=true',
      '?q=서울',
      `?from=${addDays(today(), 12)}&to=${addDays(today(), 30)}`,
    ];
    for (const qs of cases) expect(await count(qs), qs).toBe(await total(qs));
    expect(await count()).toBe(4);
    expect(await count('?q=서울')).toBe(2); // 검색은 지난 대회 포함
    expect(await count('?registrationState=upcoming')).toBe(1);
  });

  it('cursor·limit은 받지 않고, 목록과 같은 검증 (기간 12개월 초과 400)', async () => {
    const res = await call(
      ctx,
      userId,
      'GET',
      `/v1/races/count?from=${today()}&to=${addDays(today(), 400)}`,
    );
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'to', code: 'out_of_range' }]);
  });
});

describe('GET /v1/races/calendar', () => {
  it('그 달 대회 있는 날만 날짜순으로 세고, 다른 달·초안·숨김은 빼고, 필터를 적용한다', async () => {
    const m = month(2);
    await createRace(ctx, { name: 'A', raceDate: `${m}-01` });
    await createRace(ctx, { name: 'B', raceDate: `${m}-01`, regionCode: 'busan' });
    await createRace(ctx, { name: 'C', raceDate: `${m}-15`, status: 'cancelled' });
    await createRace(ctx, { name: 'D', raceDate: lastDay(m) });
    await createRace(ctx, { name: '다음 달', raceDate: `${month(3)}-01` });
    await createRace(ctx, { name: '지난 달 말', raceDate: lastDay(month(1)) });
    await createRace(ctx, {
      name: '초안',
      raceDate: `${m}-02`,
      publishStatus: 'draft',
      lastVerifiedAt: null,
    });
    await createRace(ctx, { name: '숨김', raceDate: `${m}-03`, publishStatus: 'hidden' });

    expect(await calendar(`?month=${m}`)).toEqual({
      month: m,
      days: [
        { date: `${m}-01`, count: 2 },
        { date: `${m}-15`, count: 1 },
        { date: lastDay(m), count: 1 },
      ],
    });
    expect((await calendar(`?month=${m}&region=busan`)).days).toEqual([
      { date: `${m}-01`, count: 1 },
    ]);
    expect((await calendar(`?month=${m}&hideCancelled=true`)).days.map((d) => d.date)).toEqual([
      `${m}-01`,
      lastDay(m),
    ]);
    // 날짜 하나의 수 = 목록에서 그날을 고른 결과 수
    expect((await calendar(`?month=${m}`)).days[0]!.count).toBe(await total(`?date=${m}-01`));
  });

  it('지난 날짜는 목록과 같게 includeEnded=true일 때만 센다', async () => {
    const prev = month(-1);
    await createRace(ctx, { name: '지난 달', raceDate: `${prev}-15` });
    expect((await calendar(`?month=${prev}`)).days).toEqual([]);
    expect((await calendar(`?month=${prev}&includeEnded=true`)).days).toEqual([
      { date: `${prev}-15`, count: 1 },
    ]);
  });

  it('달 범위: 이번 달 −1 ~ +12개월, 밖이면 400. 형식이 틀려도 400. 검색어는 받지 않는다', async () => {
    for (const ok of [month(-1), month(0), month(12)]) {
      expect((await call(ctx, userId, 'GET', `/v1/races/calendar?month=${ok}`)).statusCode).toBe(
        200,
      );
    }
    for (const bad of [month(-2), month(13)]) {
      const res = await call(ctx, userId, 'GET', `/v1/races/calendar?month=${bad}`);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).fieldErrors).toEqual([{ path: 'month', code: 'out_of_range' }]);
    }
    for (const qs of ['', '?month=2026-13', '?month=2026-1']) {
      expect((await call(ctx, userId, 'GET', `/v1/races/calendar${qs}`)).statusCode).toBe(400);
    }
    // q는 스키마에 없어 무시된다 (Fastify가 정의되지 않은 쿼리 키를 버림)
    const m = month(1);
    await createRace(ctx, { name: '서울', raceDate: `${m}-10` });
    expect((await calendar(`?month=${m}&q=부산`)).days).toHaveLength(1);
  });

  it('로그인이 필요하다', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/races/calendar?month=${month(0)}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
