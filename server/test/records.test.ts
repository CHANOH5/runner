import { RecordPage, RunRecord } from '@berun/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRecords, users } from '../src/db/schema/index.js';
import { addDays } from '../src/lib/time.js';
import { call, createUser, errorOf, today } from './fixtures.js';
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

const tenK = (over: object = {}) => ({
  category: '10k',
  distanceM: 10000,
  durationSec: 3000,
  runDate: addDays(today(), -10),
  kind: 'race',
  title: '가을 10K',
  ...over,
});
const post = (body: object) => call(ctx, userId, 'POST', '/v1/me/records', body);

describe('POST /v1/me/records', () => {
  it('저장: 페이스·예측 사용 여부 계산, records_changed_at 갱신', async () => {
    const res = await post(tenK());
    expect(res.statusCode).toBe(201);
    expect(RunRecord.parse(res.json())).toMatchObject({
      category: '10k',
      distanceM: 10000,
      durationSec: 3000,
      paceSecPerKm: 300,
      kind: 'race',
      title: '가을 10K',
      usableForPrediction: true,
    });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u!.recordsChangedAt).not.toBeNull();
  });

  it('검증: 10K 18:00(1\'48"/km)·기타 0.5km·고정 거리 불일치·미래 날짜·41자 제목 → 400', async () => {
    const cases: [object, string, string][] = [
      [{ durationSec: 1080 }, 'durationSec', 'pace_out_of_range'],
      [{ category: 'other', distanceM: 500, durationSec: 200 }, 'distanceM', 'out_of_range'],
      [{ category: 'other', distanceM: 12550, durationSec: 4000 }, 'distanceM', 'out_of_range'],
      [{ distanceM: 10500 }, 'distanceM', 'invalid_value'],
      [{ runDate: addDays(today(), 1) }, 'runDate', 'out_of_range'],
      [{ runDate: '1989-12-31' }, 'runDate', 'out_of_range'],
      [{ title: '가'.repeat(41) }, 'title', 'too_long'],
    ];
    for (const [over, path, code] of cases) {
      const res = await post(tenK(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(errorOf(res).fieldErrors).toEqual([{ path, code }]);
    }
  });

  it('기타 거리 12.5km, 빈 제목은 null, 365일 넘은 기록은 예측 미사용', async () => {
    const res = await post(
      tenK({ category: 'other', distanceM: 12500, durationSec: 4000, title: '  ' }),
    );
    expect(RunRecord.parse(res.json())).toMatchObject({ distanceM: 12500, title: null });
    const old = RunRecord.parse((await post(tenK({ runDate: addDays(today(), -400) }))).json());
    expect(old.usableForPrediction).toBe(false);
  });

  it('같은 날짜·거리·기록 → 409 DUPLICATE_RECORD, confirmDuplicate면 저장', async () => {
    const first = RunRecord.parse((await post(tenK())).json());
    const res = await post(tenK());
    expect([res.statusCode, errorOf(res)]).toEqual([
      409,
      expect.objectContaining({
        code: 'DUPLICATE_RECORD',
        details: { existingRecordId: first.id },
      }),
    ]);
    expect((await post(tenK({ confirmDuplicate: true }))).statusCode).toBe(201);
  });

  it('500개 초과 → 422 LIMIT_EXCEEDED', async () => {
    await ctx.db.insert(runRecords).values(
      Array.from({ length: 500 }, (_, i) => ({
        userId,
        category: '10k',
        distanceM: 10000,
        durationSec: 3000 + i,
        runDate: addDays(today(), -i),
        kind: 'training',
      })),
    );
    const res = await post(tenK({ durationSec: 2999 }));
    expect(errorOf(res)).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { resource: 'records', limit: 500 },
    });
  });
});

describe('GET /v1/me/records', () => {
  it('날짜 최신순 → 생성 최신순, 커서', async () => {
    const a = RunRecord.parse((await post(tenK({ runDate: addDays(today(), -3) }))).json());
    const b = RunRecord.parse((await post(tenK({ runDate: addDays(today(), -1) }))).json());
    const c = RunRecord.parse(
      (await post(tenK({ runDate: addDays(today(), -1), durationSec: 3100 }))).json(),
    );
    const p1 = RecordPage.parse((await call(ctx, userId, 'GET', '/v1/me/records?limit=2')).json());
    expect(p1.items.map((r) => r.id)).toEqual([c.id, b.id]);
    const p2 = RecordPage.parse(
      (await call(ctx, userId, 'GET', `/v1/me/records?limit=2&cursor=${p1.nextCursor}`)).json(),
    );
    expect([p2.items.map((r) => r.id), p2.nextCursor]).toEqual([[a.id], null]);
  });

  it('남의 기록은 보이지 않는다', async () => {
    await post(tenK());
    const other = await createUser(ctx);
    const page = RecordPage.parse((await call(ctx, other.id, 'GET', '/v1/me/records')).json());
    expect(page.items).toEqual([]);
  });
});

describe('PATCH·DELETE /v1/me/records/{id}', () => {
  it('수정: 합친 값으로 페이스 검사, category·distanceM은 함께', async () => {
    const rec = RunRecord.parse((await post(tenK())).json());
    const url = `/v1/me/records/${rec.id}`;

    let res = await call(ctx, userId, 'PATCH', url, { category: 'half' });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'distanceM', code: 'required' }]);
    // 하프로 바꾸면 기록 3000초는 2'22"/km → 페이스 범위 밖
    res = await call(ctx, userId, 'PATCH', url, { category: 'half', distanceM: 21097 });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'durationSec', code: 'pace_out_of_range' }]);

    res = await call(ctx, userId, 'PATCH', url, {
      category: 'half',
      distanceM: 21097,
      durationSec: 7200,
      title: null,
    });
    expect(RunRecord.parse(res.json())).toMatchObject({
      category: 'half',
      distanceM: 21097,
      durationSec: 7200,
      paceSecPerKm: 341,
      title: null,
    });
  });

  it('수정 중복 확인: 다른 기록과 같아지면 409, confirmDuplicate면 저장, 제목·구분만 바꾸면 확인 안 함', async () => {
    const a = RunRecord.parse((await post(tenK())).json());
    const b = RunRecord.parse((await post(tenK({ durationSec: 3100 }))).json());
    const url = `/v1/me/records/${b.id}`;

    let res = await call(ctx, userId, 'PATCH', url, { durationSec: 3000 });
    expect([res.statusCode, errorOf(res)]).toEqual([
      409,
      expect.objectContaining({ code: 'DUPLICATE_RECORD', details: { existingRecordId: a.id } }),
    ]);
    res = await call(ctx, userId, 'PATCH', url, { durationSec: 3000, confirmDuplicate: true });
    expect(res.statusCode).toBe(200);

    // 이제 a와 b가 같다: 제목·구분만 바꾸면 확인하지 않음, 자기 값으로 다시 보내도 자기 자신은 제외
    res = await call(ctx, userId, 'PATCH', url, { title: '새 제목', kind: 'training' });
    expect(res.statusCode).toBe(200);
    const c = RunRecord.parse((await post(tenK({ durationSec: 3200 }))).json());
    res = await call(ctx, userId, 'PATCH', `/v1/me/records/${c.id}`, { durationSec: 3300 });
    expect(res.statusCode).toBe(200);
  });

  it('삭제 204, 남의 기록 수정·삭제는 404', async () => {
    const rec = RunRecord.parse((await post(tenK())).json());
    const other = await createUser(ctx);
    expect(
      (await call(ctx, other.id, 'PATCH', `/v1/me/records/${rec.id}`, { kind: 'training' }))
        .statusCode,
    ).toBe(404);
    expect((await call(ctx, other.id, 'DELETE', `/v1/me/records/${rec.id}`)).statusCode).toBe(404);
    expect((await call(ctx, userId, 'DELETE', `/v1/me/records/${rec.id}`)).statusCode).toBe(204);
    expect(await ctx.db.$count(runRecords)).toBe(0);
  });
});
