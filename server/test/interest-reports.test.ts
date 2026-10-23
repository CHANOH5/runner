import { InterestOffRes, InterestOnRes } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { raceInterests, raceReports, races } from '../src/db/schema/index.js';
import { adminCall, loginAs } from './admin-fixtures.js';
import {
  addRegistration,
  call,
  createRace,
  createUser,
  DAY,
  errorOf,
  fromNow,
} from './fixtures.js';
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

const on = (raceId: string) => call(ctx, userId, 'PUT', `/v1/races/${raceId}/interest`);
const off = (raceId: string) => call(ctx, userId, 'DELETE', `/v1/races/${raceId}/interest`);

describe('PUT/DELETE /v1/races/{id}/interest (F-013)', () => {
  it('켜기·끄기 멱등, 접수 예정이면 notifyRegistrationOpen, 참가 예정은 유지', async () => {
    const { race, event } = await createRace(ctx, {
      registrationOpensAt: fromNow(3 * DAY),
      registrationClosesAt: fromNow(20 * DAY),
    });
    expect(InterestOnRes.parse((await on(race.id)).json())).toEqual({
      interested: true,
      notifyRegistrationOpen: true,
    });
    expect((await on(race.id)).statusCode).toBe(200);
    expect(await ctx.db.$count(raceInterests)).toBe(1);

    await addRegistration(ctx, userId, race.id, event.id);
    expect(InterestOffRes.parse((await off(race.id)).json())).toEqual({
      interested: false,
      stillRegistered: true,
    });
    expect((await off(race.id)).statusCode).toBe(200);
    expect(await ctx.db.$count(raceInterests)).toBe(0);
  });

  it('접수 중 대회는 notifyRegistrationOpen=false, 지난·취소 대회에도 켤 수 있다', async () => {
    const open = await createRace(ctx);
    const past = await createRace(ctx, { inDays: -10 });
    const cancelled = await createRace(ctx, { status: 'cancelled' });
    expect((await on(open.race.id)).json()).toMatchObject({ notifyRegistrationOpen: false });
    expect((await on(past.race.id)).statusCode).toBe(200);
    expect((await on(cancelled.race.id)).statusCode).toBe(200);
  });

  it('하트로 켤 때만 200개 한도 — 자동으로 켜진 관심도 개수에 포함, 참가 예정의 자동 켜기는 막지 않음', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) ids.push((await createRace(ctx, { name: `r${i}` })).race.id);
    // 199개는 하트로(직접 행), 1개는 참가 예정 추가 API로 자동으로 켠다
    await ctx.db
      .insert(raceInterests)
      .values(ids.slice(0, 199).map((raceId) => ({ userId, raceId })));
    const auto = await createRace(ctx, { name: '자동' });
    const added = await call(ctx, userId, 'POST', `/v1/races/${auto.race.id}/registration`, {
      raceEventId: auto.event.id,
      goalSource: 'none',
    });
    expect(added.json()).toMatchObject({ interestAutoEnabled: true });
    expect(await ctx.db.$count(raceInterests, eq(raceInterests.userId, userId))).toBe(200);

    // 하트로 켜기: 200개 → 422
    const res = await on(ids[199]!);
    expect([res.statusCode, errorOf(res)]).toEqual([
      422,
      expect.objectContaining({
        code: 'LIMIT_EXCEEDED',
        details: { resource: 'interests', limit: 200 },
      }),
    ]);
    // 이미 켜진 대회는 멱등 200
    expect((await on(ids[0]!)).statusCode).toBe(200);

    // 200개가 차 있어도 참가 예정 추가는 관심을 켠다 (201번째, PRD v1.6 4.8)
    const more = await createRace(ctx, { name: '자동2' });
    const again = await call(ctx, userId, 'POST', `/v1/races/${more.race.id}/registration`, {
      raceEventId: more.event.id,
      goalSource: 'none',
    });
    expect(again.json()).toMatchObject({ interestAutoEnabled: true });
    expect(await ctx.db.$count(raceInterests, eq(raceInterests.userId, userId))).toBe(201);
  });

  it('초안 404, 숨김: 켜기 410 / 끄기는 가능 (내 대회 정리)', async () => {
    const draft = await createRace(ctx, { publishStatus: 'draft', lastVerifiedAt: null });
    const hidden = await createRace(ctx);
    await on(hidden.race.id);
    await ctx.db.update(races).set({ publishStatus: 'hidden' }).where(eq(races.id, hidden.race.id));
    expect((await on(draft.race.id)).statusCode).toBe(404);
    expect(errorOf(await on(hidden.race.id)).code).toBe('RACE_UNAVAILABLE');
    expect((await off(hidden.race.id)).statusCode).toBe(200);
  });
});

describe('POST /v1/races/{id}/reports (F-016)', () => {
  const report = (raceId: string, message = '대회일이 공식 홈페이지와 달라요.') =>
    call(ctx, userId, 'POST', `/v1/races/${raceId}/reports`, { field: 'date', message });

  it('저장 → 관리자 제보 목록에 미처리로 보인다', async () => {
    const { race } = await createRace(ctx, { name: '제보 대상' });
    const res = await report(race.id);
    expect(res.statusCode).toBe(201);
    const [row] = await ctx.db.select().from(raceReports);
    expect(row).toMatchObject({
      id: res.json<{ id: string }>().id,
      userId,
      status: 'open',
      field: 'date',
    });

    const admin = await loginAs(ctx, 'viewer');
    const list = (await adminCall(ctx, admin, 'GET', '/reports?status=open')).json<{
      items: { raceName: string }[];
    }>();
    expect(list.items.map((i) => i.raceName)).toEqual(['제보 대상']);
  });

  it('내용 10~500자 (공백 제외), 항목 enum', async () => {
    const { race } = await createRace(ctx);
    let res = await report(race.id, '   짧아요     ');
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'message', code: 'too_short' }]);
    res = await call(ctx, userId, 'POST', `/v1/races/${race.id}/reports`, {
      field: 'price',
      message: '열 글자가 넘는 내용입니다',
    });
    expect(errorOf(res).fieldErrors?.[0]?.path).toBe('field');
  });

  it('하루 한도: 같은 대회 3건 → 429 scope=race, 전체 10건 → scope=total (KST 날짜)', async () => {
    const { race } = await createRace(ctx);
    for (let i = 0; i < 3; i++) expect((await report(race.id)).statusCode).toBe(201);
    let res = await report(race.id);
    expect([res.statusCode, errorOf(res)]).toEqual([
      429,
      expect.objectContaining({ code: 'REPORT_LIMIT_DAILY', details: { scope: 'race', limit: 3 } }),
    ]);
    // 어제 제보는 세지 않는다
    await ctx.db.update(raceReports).set({ createdAt: fromNow(-DAY - 60_000) });
    expect((await report(race.id)).statusCode).toBe(201);

    for (let i = 0; i < 9; i++) {
      const other = await createRace(ctx);
      expect((await report(other.race.id)).statusCode).toBe(201);
    }
    const last = await createRace(ctx);
    res = await report(last.race.id);
    expect(errorOf(res).details).toEqual({ scope: 'total', limit: 10 });
  });

  it('지난·취소 대회도 제보 가능, 숨김 410', async () => {
    const past = await createRace(ctx, { inDays: -5 });
    const cancelled = await createRace(ctx, { status: 'cancelled' });
    const hidden = await createRace(ctx, { publishStatus: 'hidden' });
    expect((await report(past.race.id)).statusCode).toBe(201);
    expect((await report(cancelled.race.id)).statusCode).toBe(201);
    expect(errorOf(await report(hidden.race.id)).code).toBe('RACE_UNAVAILABLE');
  });
});
