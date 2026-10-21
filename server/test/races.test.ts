import { RaceDetail, RacePage } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, toKstIso } from '../src/lib/time.js';
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
let userId: string;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  userId = (await createUser(ctx)).id;
});

const list = async (qs = '') => {
  const res = await call(ctx, userId, 'GET', `/v1/races${qs}`);
  expect(res.statusCode).toBe(200);
  return RacePage.parse(res.json());
};
const names = async (qs = '') => (await list(qs)).items.map((i) => i.name);

describe('GET /v1/races', () => {
  it('기본: 게시된 오늘 이후 대회만, 대회일 → 대회명 순', async () => {
    await createRace(ctx, { name: '나 대회', inDays: 10 });
    await createRace(ctx, { name: '가 대회', inDays: 10 });
    await createRace(ctx, { name: '오늘 대회', inDays: 0 });
    await createRace(ctx, { name: '지난 대회', inDays: -1 });
    await createRace(ctx, { name: '초안', publishStatus: 'draft', lastVerifiedAt: null });
    await createRace(ctx, { name: '숨김', publishStatus: 'hidden' });
    expect(await names()).toEqual(['오늘 대회', '가 대회', '나 대회']);
    expect(await names('?includeEnded=true')).toEqual([
      '지난 대회',
      '오늘 대회',
      '가 대회',
      '나 대회',
    ]);
  });

  it('카드 필드: 종목 분류 순서, 접수 상태, D-day, 내 관심·참가 예정', async () => {
    const { race, events } = await createRace(ctx, {
      inDays: 5,
      registrationMethod: 'lottery',
      events: [
        { name: '풀', category: 'full', distanceM: 42195 },
        { name: '10K', category: '10k', distanceM: 10000 },
        { name: '10K B', category: '10k', distanceM: 10000 },
      ],
    });
    await addInterest(ctx, userId, race.id);
    await addRegistration(ctx, userId, race.id, events[0]!.id);
    const [item] = (await list()).items;
    expect(item).toMatchObject({
      categories: ['10k', 'full'],
      registrationState: 'open',
      registrationMethod: 'lottery',
      dDay: 5,
      registrationOpensAt: toKstIso(race.registrationOpensAt!),
      my: { interested: true, registered: true },
    });
  });

  it('유효 접수 기간: 대회 기간이 비면 종목 기간을 집계한다', async () => {
    const opens = fromNow(2 * DAY);
    const closes = fromNow(9 * DAY);
    await createRace(ctx, {
      registrationOpensAt: null,
      registrationClosesAt: null,
      events: [
        { registrationOpensAt: opens, registrationClosesAt: fromNow(5 * DAY) },
        { name: '10K', category: '10k', distanceM: 10000, registrationClosesAt: closes },
      ],
    });
    const [item] = (await list()).items;
    expect(item).toMatchObject({
      registrationState: 'upcoming',
      registrationOpensAt: toKstIso(opens),
      registrationClosesAt: toKstIso(closes),
    });
  });

  it('필터: 지역·거리·접수 상태·취소 숨기기', async () => {
    await createRace(ctx, { name: '서울 하프', regionCode: 'seoul' });
    await createRace(ctx, {
      name: '부산 10K',
      regionCode: 'busan',
      events: [{ category: '10k', distanceM: 10000 }],
    });
    await createRace(ctx, {
      name: '경기 예정',
      regionCode: 'gyeonggi',
      registrationOpensAt: fromNow(DAY),
    });
    await createRace(ctx, { name: '취소 대회', status: 'cancelled' });

    expect(await names('?region=busan&region=gyeonggi')).toEqual(['경기 예정', '부산 10K']);
    expect(await names('?category=10k')).toEqual(['부산 10K']);
    expect(await names('?registrationState=upcoming')).toEqual(['경기 예정']);
    expect((await names('?hideCancelled=true')).includes('취소 대회')).toBe(false);
    expect((await names()).includes('취소 대회')).toBe(true);
  });

  it('참가비 구간: 경계값은 낮은 구간, 참가비 없는 종목은 제외', async () => {
    await createRace(ctx, { name: '3만', events: [{ feeKrw: 30000 }] });
    await createRace(ctx, { name: '5만', events: [{ feeKrw: 50000 }] });
    await createRace(ctx, { name: '10만1원', events: [{ feeKrw: 100001 }] });
    await createRace(ctx, { name: '미정', events: [{ feeKrw: null }] });
    expect(await names('?fee=le30k')).toEqual(['3만']);
    expect(await names('?fee=30k_50k')).toEqual(['5만']);
    expect(await names('?fee=gt100k')).toEqual(['10만1원']);
  });

  it('기간: from~to, date, 12개월 초과는 400', async () => {
    await createRace(ctx, { name: '10일 뒤', inDays: 10 });
    await createRace(ctx, { name: '40일 뒤', inDays: 40 });
    expect(await names(`?from=${addDays(today(), 5)}&to=${addDays(today(), 20)}`)).toEqual([
      '10일 뒤',
    ]);
    expect(await names(`?date=${addDays(today(), 40)}`)).toEqual(['40일 뒤']);
    const res = await call(ctx, userId, 'GET', `/v1/races?from=2026-01-01&to=2027-01-02`);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'to', code: 'out_of_range' }]);
  });

  it('검색: 공백·대소문자 무시, 대회명·장소·주최, 예정 → 지난 대회(최근 순)', async () => {
    await createRace(ctx, { name: '춘천 마라톤', inDays: 30 });
    await createRace(ctx, { name: 'Seoul Run', venueName: '춘천 공지천', inDays: 10 });
    await createRace(ctx, { name: '옛날 대회', organizer: '춘천시', inDays: -100 });
    await createRace(ctx, { name: '작년 춘천', inDays: -10 });
    await createRace(ctx, { name: '무관', inDays: 5 });

    expect(await names('?q=춘 천')).toEqual(['Seoul Run', '춘천 마라톤', '작년 춘천', '옛날 대회']);
    expect(await names('?q=SEOULRUN')).toEqual(['Seoul Run']);
    const page = await list('?q=춘천');
    expect(page.items.slice(2).every((i) => i.registrationState === 'ended')).toBe(true);
  });

  it('커서 페이지네이션 (검색 정렬 포함), 잘못된 커서 400', async () => {
    for (let i = 0; i < 5; i++) await createRace(ctx, { name: `대회 ${i}`, inDays: i });
    const p1 = await list('?limit=2');
    const p2 = await list(`?limit=2&cursor=${p1.nextCursor}`);
    const p3 = await list(`?limit=2&cursor=${p2.nextCursor}`);
    expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.name)).toEqual([
      '대회 0',
      '대회 1',
      '대회 2',
      '대회 3',
      '대회 4',
    ]);
    expect(p3.nextCursor).toBeNull();

    await createRace(ctx, { name: '대회 과거', inDays: -3 });
    const s1 = await list('?q=대회&limit=5');
    const s2 = await list(`?q=대회&limit=5&cursor=${s1.nextCursor}`);
    expect(s2.items.map((i) => i.name)).toEqual(['대회 과거']);

    const bad = await call(ctx, userId, 'GET', '/v1/races?cursor=garbage');
    expect([bad.statusCode, errorOf(bad).fieldErrors]).toEqual([
      400,
      [{ path: 'cursor', code: 'invalid_format' }],
    ]);
  });

  it('잘못된 지역 코드는 400', async () => {
    const res = await call(ctx, userId, 'GET', '/v1/races?region=mars');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/races/{raceId}', () => {
  it('상세: 종목 순서, 대회장 좌표, 대표 출처, 내 참가 예정(접수 상태 포함)', async () => {
    const start = new Date('2026-11-15T08:00:00+09:00');
    const { race, events } = await createRace(ctx, {
      organizer: '주최',
      venueName: '여의도',
      venueAddress: '서울 영등포구',
      venue: { lat: 37.5284, lng: 126.9327 },
      events: [
        { name: '풀', category: 'full', distanceM: 42195, startAt: start },
        { name: '5K', category: '5k', distanceM: 5000, feeKrw: 20000 },
      ],
    });
    await addRegistration(ctx, userId, race.id, events[0]!.id, {
      entryStatus: 'registered',
      entryStatusUpdatedAt: new Date(),
      goalTimeSec: 14400,
      goalPaceSecPerKm: 341,
      goalSource: 'manual',
    });

    const res = await call(ctx, userId, 'GET', `/v1/races/${race.id}`);
    expect(res.statusCode).toBe(200);
    const d = RaceDetail.parse(res.json());
    expect(d.events.map((e) => e.name)).toEqual(['5K', '풀']);
    expect(d.venue).toEqual({
      name: '여의도',
      address: '서울 영등포구',
      lat: 37.5284,
      lng: 126.9327,
    });
    expect(d.earliestStartAt).toBe('2026-11-15T08:00:00+09:00');
    expect(d.source).toEqual({ name: '공식 홈페이지', url: 'https://example.com/race' });
    expect(d.my.registration).toMatchObject({
      eventName: '풀',
      eventDistanceM: 42195,
      predictionSupported: true,
      goalTimeSec: 14400,
      entryStatus: 'registered',
    });
    expect(d.my.registration?.entryStatusUpdatedAt).toMatch(/\+09:00$/);
    expect(d.my.interested).toBe(false);
  });

  it('좌표 없으면 null, 초안 404, 숨김 410', async () => {
    const plain = await createRace(ctx);
    const d = RaceDetail.parse(
      (await call(ctx, userId, 'GET', `/v1/races/${plain.race.id}`)).json(),
    );
    expect([d.venue.lat, d.venue.lng]).toEqual([null, null]);

    const draft = await createRace(ctx, { publishStatus: 'draft', lastVerifiedAt: null });
    const hidden = await createRace(ctx, { publishStatus: 'hidden' });
    expect((await call(ctx, userId, 'GET', `/v1/races/${draft.race.id}`)).statusCode).toBe(404);
    const res = await call(ctx, userId, 'GET', `/v1/races/${hidden.race.id}`);
    expect([res.statusCode, errorOf(res).code]).toEqual([410, 'RACE_UNAVAILABLE']);
  });
});
