import { AdminRace, AdminRaceSaveRes, CloneRes } from '@berun/shared';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuditLogs, adminUsers, notifications, raceReports } from '../src/db/schema/index.js';
import type { RaceUpdateSink } from '../src/modules/admin/races-service.js';
import { totpCode } from '../src/modules/admin/totp.js';
import { handleRaceUpdated } from '../src/modules/notifications/delivery.js';
import { addDays } from '../src/lib/time.js';
import {
  adminCall,
  createAdminAccount,
  loginAs,
  PASSWORD,
  type AdminSession,
} from './admin-fixtures.js';
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

type Job = Parameters<RaceUpdateSink['raceUpdated']>[0];
const jobs: Job[] = [];
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({
    raceUpdates: {
      raceUpdated: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  });
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await truncateAll(ctx.db);
  jobs.length = 0;
});

const future = (days: number) => addDays(today(), days);

async function draft(s: AdminSession, body: object = {}) {
  const res = await adminCall(ctx, s, 'POST', '/races', {
    name: '2027 서울 하프마라톤',
    raceDate: future(120),
    regionCode: 'seoul',
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return AdminRace.parse(res.json<{ race: unknown }>().race);
}

/** 편집 화면 값으로 전체 저장 (If-Match = updatedAt) */
function toInput(race: AdminRace, over: object = {}) {
  return {
    name: race.name,
    regionCode: race.regionCode,
    raceDate: race.raceDate,
    organizer: race.organizer,
    venueName: race.venueName,
    venueAddress: race.venueAddress,
    venuePoint: race.venuePoint,
    registrationOpensAt: race.registrationOpensAt,
    registrationOpensTimeKnown: race.registrationOpensTimeKnown,
    registrationClosesAt: race.registrationClosesAt,
    officialUrl: race.officialUrl,
    registrationUrl: race.registrationUrl,
    courseUrl: race.courseUrl,
    raceType: race.raceType,
    registrationMethod: race.registrationMethod,
    status: race.status,
    events: race.events.map(({ registrationCount: _r, ...e }) => e),
    ...over,
  };
}

async function save(s: AdminSession, race: AdminRace, over: object = {}) {
  const res = await adminCall(ctx, s, 'PUT', `/races/${race.id}`, toInput(race, over), {
    'if-match': race.updatedAt,
  });
  expect(res.statusCode, res.body).toBe(200);
  return AdminRaceSaveRes.parse(res.json());
}

const PRESET_EVENTS = [
  { name: '5K', category: '5k', distanceM: 5000 },
  { name: '10K', category: '10k', distanceM: 10000 },
  { name: '하프코스', category: 'half', distanceM: 21097 },
  { name: '풀코스', category: 'full', distanceM: 42195 },
].map((e) => ({ ...e, startTime: '08:00', timeLimitMin: null, feeKrw: 50000 }));

/** 게시 가능한 대회 만들기 */
async function publishable(s: AdminSession, over: object = {}) {
  const d = await draft(s);
  const { race } = await save(s, d, {
    officialUrl: 'https://example.com/seoul-half',
    events: PRESET_EVENTS,
    registrationOpensAt: fromNow(10 * DAY).toISOString(),
    registrationClosesAt: fromNow(40 * DAY).toISOString(),
    ...over,
  });
  return race;
}

describe('관리자 인증 (A-001)', () => {
  it('비밀번호 → TOTP → 세션 쿠키, /auth/me, 로그아웃', async () => {
    const s = await loginAs(ctx, 'owner');
    const me = await adminCall(ctx, s, 'GET', '/auth/me');
    // 새로고침 뒤 쓰기 요청을 위해 세션의 CSRF 토큰도 준다 (관리자 웹, T-024)
    expect(me.json()).toEqual({
      id: s.id,
      email: 'owner@example.com',
      role: 'owner',
      csrfToken: s.csrf,
    });
    expect(me.headers['cache-control']).toBe('no-store');
    expect((await adminCall(ctx, s, 'POST', '/auth/logout')).statusCode).toBe(204);
    expect((await adminCall(ctx, s, 'GET', '/auth/me')).statusCode).toBe(401);
  });

  it('틀린 TOTP 401, 세션 없이 401, 쿠키는 httpOnly·SameSite=Strict', async () => {
    const { admin, secret } = await createAdminAccount(ctx, 'operator');
    const login = await adminCall(ctx, null, 'POST', '/auth/login', {
      email: admin.email,
      password: PASSWORD,
    });
    const { mfaToken } = login.json<{ mfaToken: string }>();
    const bad = await adminCall(ctx, null, 'POST', '/auth/mfa', { mfaToken, totp: '000000' });
    expect(bad.statusCode).toBe(401);
    const good = await adminCall(ctx, null, 'POST', '/auth/mfa', {
      mfaToken,
      totp: totpCode(secret, new Date()),
    });
    expect(String(good.headers['set-cookie'])).toMatch(
      /HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/,
    );
    // 2단계 토큰은 한 번만
    const reuse = await adminCall(ctx, null, 'POST', '/auth/mfa', {
      mfaToken,
      totp: totpCode(secret, new Date()),
    });
    expect(reuse.statusCode).toBe(401);
    expect((await adminCall(ctx, null, 'GET', '/races')).statusCode).toBe(401);
  });

  it('비밀번호 5회 실패 → 15분 잠금 (맞는 비밀번호도 429)', async () => {
    const { admin } = await createAdminAccount(ctx, 'owner');
    for (let i = 0; i < 5; i++) {
      const res = await adminCall(ctx, null, 'POST', '/auth/login', {
        email: admin.email,
        password: 'wrong',
      });
      expect(res.statusCode).toBe(401);
    }
    const locked = await adminCall(ctx, null, 'POST', '/auth/login', {
      email: admin.email,
      password: PASSWORD,
    });
    expect([locked.statusCode, errorOf(locked).code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('비활성화된 관리자는 다음 요청부터 401, CSRF 헤더 없는 쓰기는 403', async () => {
    const owner = await loginAs(ctx, 'owner');
    const op = await loginAs(ctx, 'operator');
    const noCsrf = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/v1/races',
      headers: { cookie: op.cookie },
      payload: { name: '대회', raceDate: future(10), regionCode: 'seoul' },
    });
    expect([noCsrf.statusCode, errorOf(noCsrf).code]).toEqual([403, 'FORBIDDEN']);

    const res = await adminCall(ctx, owner, 'PATCH', `/admins/${op.id}`, { disabled: true });
    expect(res.json()).toMatchObject({ disabled: true });
    expect((await adminCall(ctx, op, 'GET', '/races')).statusCode).toBe(401);
  });

  it('owner: 관리자 생성(TOTP URI 1회), 마지막 owner 강등·자기 비활성화 불가', async () => {
    const owner = await loginAs(ctx, 'owner');
    const created = await adminCall(ctx, owner, 'POST', '/admins', {
      email: 'new@example.com',
      role: 'viewer',
      password: 'a-long-password',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ totpUri: string }>().totpUri).toMatch(/^otpauth:\/\/totp\//);
    const [row] = await ctx.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, 'new@example.com'));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);

    let res = await adminCall(ctx, owner, 'PATCH', `/admins/${owner.id}`, { role: 'operator' });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'role', code: 'last_owner' }]);
    res = await adminCall(ctx, owner, 'PATCH', `/admins/${owner.id}`, { disabled: true });
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'disabled', code: 'self' }]);
  });
});

describe('권한 (PRD 8.1)', () => {
  it('viewer는 조회만, operator는 대회·제보 쓰기(삭제·계정 관리 제외), owner는 전부', async () => {
    const owner = await loginAs(ctx, 'owner');
    const op = await loginAs(ctx, 'operator');
    const viewer = await loginAs(ctx, 'viewer');
    const race = await draft(owner);

    const expectStatus = async (
      s: AdminSession,
      method: 'GET' | 'POST' | 'DELETE',
      url: string,
      status: number,
      body?: object,
    ) =>
      expect((await adminCall(ctx, s, method, url, body)).statusCode, `${method} ${url}`).toBe(
        status,
      );

    await expectStatus(viewer, 'GET', '/races', 200);
    await expectStatus(viewer, 'GET', `/races/${race.id}`, 200);
    await expectStatus(viewer, 'GET', '/reports', 200);
    await expectStatus(viewer, 'POST', '/races', 403, {
      name: '대회',
      raceDate: future(10),
      regionCode: 'seoul',
    });
    await expectStatus(viewer, 'POST', `/races/${race.id}/clone`, 403, {});
    await expectStatus(viewer, 'POST', '/reports/resolve', 403, {
      ids: [race.id],
      action: 'applied',
    });
    await expectStatus(viewer, 'GET', '/admins', 403);

    await expectStatus(op, 'POST', '/races', 201, {
      name: '대회2',
      raceDate: future(10),
      regionCode: 'seoul',
    });
    await expectStatus(op, 'POST', `/races/${race.id}/clone`, 201, {});
    await expectStatus(op, 'DELETE', `/races/${race.id}`, 403);
    await expectStatus(op, 'GET', '/admins', 403);

    await expectStatus(owner, 'GET', '/admins', 200);
    await expectStatus(owner, 'DELETE', `/races/${race.id}`, 204);
  });
});

describe('대회 등록·수정 (A-003)', () => {
  it('초안은 대회명·대회일·지역만으로 저장, 자동 채움, 게시 조건 미충족 목록, 중복 경고', async () => {
    const owner = await loginAs(ctx, 'owner');
    const d = await draft(owner);
    expect(d).toMatchObject({
      publishStatus: 'draft',
      status: 'scheduled',
      raceType: 'road',
      registrationMethod: 'unknown',
      events: [],
      publishMissing: ['officialUrl', 'primarySourceVerified', 'events'],
    });
    expect(d.slug).toMatch(/^race-2\d{3}-[a-z0-9]+$/);
    expect(d.lastVerifiedAt).not.toBeNull();

    const dup = await adminCall(ctx, owner, 'POST', '/races', {
      name: '서울 하프마라톤 2027',
      raceDate: d.raceDate,
      regionCode: 'seoul',
    });
    expect(
      dup.json<{ dedupeWarnings: { id: string }[] }>().dedupeWarnings.map((w) => w.id),
    ).toEqual([d.id]);
    const check = await adminCall(
      ctx,
      owner,
      'GET',
      `/races/duplicates?name=${encodeURIComponent('2027서울하프마라톤')}&raceDate=${d.raceDate}`,
    );
    expect(check.json<unknown[]>()).toHaveLength(2);
  });

  it('과거 대회일 신규 등록은 owner만', async () => {
    const op = await loginAs(ctx, 'operator');
    const owner = await loginAs(ctx, 'owner');
    const body = { name: '지난 대회', raceDate: future(-3), regionCode: 'seoul' };
    const res = await adminCall(ctx, op, 'POST', '/races', body);
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'raceDate', code: 'out_of_range' }]);
    expect((await adminCall(ctx, owner, 'POST', '/races', body)).statusCode).toBe(201);
  });

  it('전체 저장: 종목 프리셋 4개 일괄, 좌표 직접 입력, 공식 URL → 대표 출처 자동, If-Match', async () => {
    const owner = await loginAs(ctx, 'owner');
    const d = await draft(owner);
    const { race } = await save(owner, d, {
      officialUrl: 'https://example.com/official',
      venuePoint: { lat: 37.5284, lng: 126.9327 },
      events: PRESET_EVENTS,
      extraSources: [{ kind: 'organizer', name: '주최사 제공', url: null, verifiedAt: null }],
      discoverySources: [
        { kind: 'aggregator', name: '대회 모음 사이트', url: 'https://aggregator.example.com/1' },
      ],
    });
    expect(race.events.map((e) => [e.name, e.startTime])).toEqual([
      ['5K', '08:00'],
      ['10K', '08:00'],
      ['하프코스', '08:00'],
      ['풀코스', '08:00'],
    ]);
    expect(race.venuePoint).toEqual({ lat: 37.5284, lng: 126.9327 });
    expect(race.sources.map((s) => [s.kind, s.isPrimary])).toEqual([
      ['official', true],
      ['organizer', false],
      ['aggregator', false],
    ]);
    expect(race.publishMissing).toEqual([]);

    // If-Match 없음 400, 오래된 값 409
    const noMatch = await adminCall(ctx, owner, 'PUT', `/races/${d.id}`, toInput(race));
    expect(errorOf(noMatch).fieldErrors).toEqual([{ path: 'if-match', code: 'required' }]);
    const stale = await adminCall(ctx, owner, 'PUT', `/races/${d.id}`, toInput(race), {
      'if-match': '2020-01-01T00:00:00+09:00',
    });
    expect([stale.statusCode, errorOf(stale).code]).toEqual([409, 'CONFLICT_STALE']);
  });

  it('입력 검증: 마감 < 오픈, 종목 마감이 대회일 이후 → 400 fieldErrors', async () => {
    const owner = await loginAs(ctx, 'owner');
    const d = await draft(owner);
    const res = await adminCall(
      ctx,
      owner,
      'PUT',
      `/races/${d.id}`,
      toInput(d, {
        registrationOpensAt: fromNow(20 * DAY).toISOString(),
        registrationClosesAt: fromNow(10 * DAY).toISOString(),
        events: [
          { ...PRESET_EVENTS[0], registrationClosesAt: `${addDays(d.raceDate, 1)}T00:00:00+09:00` },
        ],
      }),
      { 'if-match': d.updatedAt },
    );
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).fieldErrors).toEqual([
      { path: 'registrationClosesAt', code: 'before_opens_at' },
      { path: 'events[0].registrationClosesAt', code: 'after_race_date' },
    ]);
  });

  it('게시: 조건 미충족 422 목록 → 채우면 게시 + 예약표 작업, 앱에 보인다', async () => {
    const owner = await loginAs(ctx, 'owner');
    const d = await draft(owner);
    const blocked = await adminCall(ctx, owner, 'POST', `/races/${d.id}/publish`);
    expect([blocked.statusCode, errorOf(blocked)]).toEqual([
      422,
      expect.objectContaining({
        code: 'PUBLISH_REQUIREMENTS_UNMET',
        details: { missing: ['officialUrl', 'primarySourceVerified', 'events'] },
      }),
    ]);
    const trail = await save(owner, d, {
      officialUrl: 'https://example.com/o',
      events: PRESET_EVENTS,
      raceType: 'trail',
    });
    const res = await adminCall(ctx, owner, 'POST', `/races/${d.id}/publish`);
    expect(errorOf(res).details).toEqual({ missing: ['raceTypeRoad'] });

    await save(owner, trail.race, { raceType: 'road' });
    const ok = await adminCall(ctx, owner, 'POST', `/races/${d.id}/publish`);
    expect(AdminRace.parse(ok.json()).publishStatus).toBe('published');
    expect(jobs).toEqual([{ raceId: d.id }]);

    const user = await createUser(ctx);
    expect((await call(ctx, user.id, 'GET', `/v1/races/${d.id}`)).statusCode).toBe(200);
  });

  it('게시 대회 저장: 취소 → N-06a, 연기 → N-06b, 일정 변경 → N-06c(요약), notifyChange=false면 재계산만', async () => {
    const owner = await loginAs(ctx, 'owner');
    let race = await publishable(owner);
    await adminCall(ctx, owner, 'POST', `/races/${race.id}/publish`);
    race = AdminRace.parse((await adminCall(ctx, owner, 'GET', `/races/${race.id}`)).json());
    const user = await createUser(ctx);
    await addInterest(ctx, user.id, race.id);
    jobs.length = 0;

    // 일정 변경
    const newDate = addDays(race.raceDate, 7);
    let res = await save(owner, race, { raceDate: newDate });
    const [, m, d] = newDate.split('-').map(Number);
    expect(res.sideEffects).toEqual({
      notificationsRescheduled: true,
      sentChangeNotice: 'race_schedule_changed',
      affectedUsers: 1,
    });
    expect(jobs.at(-1)).toEqual({
      raceId: race.id,
      notify: 'race_schedule_changed',
      changeSummary: `대회일: ${m}월 ${d}일`,
    });

    // 알림 없이 저장
    res = await save(owner, res.race, { raceDate: addDays(newDate, 1), notifyChange: false });
    expect(res.sideEffects.sentChangeNotice).toBeNull();
    expect(jobs.at(-1)).toEqual({ raceId: race.id, changeSummary: null });

    // 연기, 취소
    res = await save(owner, res.race, { status: 'postponed' });
    expect(jobs.at(-1)).toMatchObject({ notify: 'race_postponed' });
    res = await save(owner, res.race, { status: 'cancelled' });
    expect(res.sideEffects.sentChangeNotice).toBe('race_cancelled');

    // 워커가 이 작업을 처리하면 N-06a가 생긴다
    await handleRaceUpdated({ db: ctx.db, clock: () => new Date() }, race.id, jobs.at(-1));
    const [n] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'race_cancelled'));
    expect(n).toMatchObject({ userId: user.id, status: 'scheduled' });
  });

  it('참가 예정이 있는 종목은 삭제 불가, 관심·참가 예정이 있으면 게시 취소·삭제 409', async () => {
    const owner = await loginAs(ctx, 'owner');
    const race = await publishable(owner);
    await adminCall(ctx, owner, 'POST', `/races/${race.id}/publish`);
    const fresh = AdminRace.parse((await adminCall(ctx, owner, 'GET', `/races/${race.id}`)).json());
    const user = await createUser(ctx);
    await addRegistration(ctx, user.id, race.id, fresh.events[0]!.id);

    const res = await adminCall(
      ctx,
      owner,
      'PUT',
      `/races/${race.id}`,
      toInput(fresh, { events: toInput(fresh).events.slice(1) }),
      {
        'if-match': fresh.updatedAt,
      },
    );
    expect(errorOf(res).fieldErrors).toEqual([{ path: 'events', code: 'event_in_use' }]);

    const unpub = await adminCall(ctx, owner, 'POST', `/races/${race.id}/unpublish`);
    expect([unpub.statusCode, errorOf(unpub)]).toEqual([
      409,
      expect.objectContaining({
        code: 'RACE_IN_USE',
        details: { interestCount: 0, registrationCount: 1 },
      }),
    ]);
    expect(errorOf(await adminCall(ctx, owner, 'DELETE', `/races/${race.id}`)).code).toBe(
      'RACE_IN_USE',
    );
    const imp = await adminCall(ctx, owner, 'GET', `/races/${race.id}/impact`);
    expect(imp.json()).toEqual({ interestCount: 0, registrationCount: 1 });
  });

  it('숨김: 메모는 감사 로그, 앱에서는 410', async () => {
    const owner = await loginAs(ctx, 'owner');
    const race = await publishable(owner);
    await adminCall(ctx, owner, 'POST', `/races/${race.id}/publish`);
    const res = await adminCall(ctx, owner, 'POST', `/races/${race.id}/hide`, {
      memo: '주최 측 요청',
    });
    expect(AdminRace.parse(res.json()).publishStatus).toBe('hidden');
    const [log] = await ctx.db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.id))
      .limit(1);
    expect(log).toMatchObject({
      adminId: owner.id,
      targetType: 'race',
      targetId: race.id,
      memo: '주최 측 요청',
    });
    const user = await createUser(ctx);
    expect(errorOf(await call(ctx, user.id, 'GET', `/v1/races/${race.id}`)).code).toBe(
      'RACE_UNAVAILABLE',
    );
  });

  it('복제: +364일, 연도·회차 갱신, 확인일·출처 확인 일시 비움, 원본 기록 (PRD 8.4.4)', async () => {
    const owner = await loginAs(ctx, 'owner');
    // 이미 지난 대회 (owner는 과거 대회일 등록 가능)
    const src = await draft(owner, { name: '제23회 2026 춘천마라톤', raceDate: future(-10) });
    const filled = await save(owner, src, {
      officialUrl: 'https://example.com/cc',
      events: [PRESET_EVENTS[3]],
      registrationOpensAt: `${addDays(src.raceDate, -80)}T10:00:00+09:00`,
      registrationClosesAt: `${addDays(src.raceDate, -20)}T18:00:00+09:00`,
    });
    const res = await adminCall(ctx, owner, 'POST', `/races/${src.id}/clone`, {});
    expect(res.statusCode).toBe(201);
    const { race, shiftedFields, renamed } = CloneRes.parse(res.json());
    expect(race).toMatchObject({
      name: `제24회 ${addDays(src.raceDate, 364).slice(0, 4)} 춘천마라톤`,
      raceDate: addDays(src.raceDate, 364),
      registrationOpensAt: `${addDays(src.raceDate, -80 + 364)}T10:00:00+09:00`,
      registrationClosesAt: `${addDays(src.raceDate, -20 + 364)}T18:00:00+09:00`,
      publishStatus: 'draft',
      status: 'scheduled',
      lastVerifiedAt: null,
      clonedFrom: src.id,
    });
    expect(race.events.map((e) => [e.name, e.startTime])).toEqual([['풀코스', '08:00']]);
    expect(race.sources).toEqual([
      expect.objectContaining({ isPrimary: true, verifiedAt: null, url: 'https://example.com/cc' }),
    ]);
    expect(race.publishMissing).toEqual(['primarySourceVerified', 'lastVerifiedAt']);
    expect(shiftedFields).toEqual([
      'raceDate',
      'registrationOpensAt',
      'registrationClosesAt',
      'events[0].startTime',
    ]);
    expect(renamed).toEqual({ year: true, edition: true });
    const [log] = await ctx.db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.id))
      .limit(1);
    expect(log!.memo).toBe(`cloned_from=${src.id}`);
    expect(filled.race.id).toBe(src.id);

    // 확인 완료 후 게시 가능
    const verified = await save(owner, race, { markVerifiedNow: true });
    expect(verified.race.publishMissing).toEqual([]);

    // 원본 대회일이 아직 안 지났으면 날짜를 옮기지 않는다
    const upcoming = await draft(owner, { name: '같은 시즌 대회' });
    const same = CloneRes.parse(
      (await adminCall(ctx, owner, 'POST', `/races/${upcoming.id}/clone`, {})).json(),
    );
    expect([same.race.raceDate, same.shiftedFields]).toEqual([upcoming.raceDate, []]);
  });

  it('목록: 필터(게시 상태·게시 조건 미충족·좌표 없음), 관심·참가 예정 수, 페이지', async () => {
    const owner = await loginAs(ctx, 'owner');
    const a = await publishable(owner);
    await adminCall(ctx, owner, 'POST', `/races/${a.id}/publish`);
    await draft(owner, { name: '초안 대회' });
    const user = await createUser(ctx);
    await addInterest(ctx, user.id, a.id);

    const all = (await adminCall(ctx, owner, 'GET', '/races')).json<{
      items: { id: string; interestCount: number }[];
      total: number;
    }>();
    expect(all.total).toBe(2);
    expect(all.items.find((i) => i.id === a.id)!.interestCount).toBe(1);
    const blocked = (await adminCall(ctx, owner, 'GET', '/races?publishBlocked=true')).json<{
      items: { name: string }[];
    }>();
    expect(blocked.items.map((i) => i.name)).toEqual(['초안 대회']);
    const noCoords = (await adminCall(ctx, owner, 'GET', '/races?noCoords=true')).json<{
      items: { id: string }[];
    }>();
    expect(noCoords.items.map((i) => i.id)).toEqual([a.id]);
    const page2 = (await adminCall(ctx, owner, 'GET', '/races?pageSize=1&page=2')).json<{
      items: unknown[];
      total: number;
    }>();
    expect([page2.items.length, page2.total]).toEqual([1, 2]);
  });

  it('감사 로그: 쓰기 요청은 남고 조회는 남지 않는다 (로그인 포함)', async () => {
    const owner = await loginAs(ctx, 'owner');
    const d = await draft(owner);
    await adminCall(ctx, owner, 'GET', `/races/${d.id}`);
    const logs = await ctx.db.select().from(adminAuditLogs).orderBy(adminAuditLogs.id);
    expect(logs.map((l) => [l.action, l.targetId])).toEqual([
      ['login', owner.id],
      ['POST /api/admin/v1/races', d.id],
    ]);
  });
});

describe('제보 처리 (A-004)', () => {
  async function report(raceId: string, userId: string | null, message: string, hoursAgo = 1) {
    const [r] = await ctx.db
      .insert(raceReports)
      .values({
        raceId,
        userId,
        field: 'date',
        message,
        createdAt: fromNow(-hoursAgo * 60 * 60 * 1000),
      })
      .returning();
    return r!;
  }

  it('목록 오래된 순·72시간 경과 표시, 상세(제보자·같은 대회 미처리), 일괄 반려 → N-07b 앱 내 알림', async () => {
    const owner = await loginAs(ctx, 'owner');
    const { race } = await createRace(ctx, { name: '제보 대회' });
    const reporter = await createUser(ctx, '제보러너');
    const old = await report(
      race.id,
      reporter.id,
      '대회일이 공식 홈페이지와 달라요. 확인 부탁드려요.',
      80,
    );
    const recent = await report(race.id, null, '장소가 바뀌었어요 확인해주세요', 2);

    const list = (await adminCall(ctx, owner, 'GET', '/reports?status=open')).json<{
      items: { id: string; overdue72h: boolean; preview: string }[];
    }>();
    expect(list.items.map((i) => [i.id, i.overdue72h])).toEqual([
      [old.id, true],
      [recent.id, false],
    ]);

    const detail = (await adminCall(ctx, owner, 'GET', `/reports/${old.id}`)).json<{
      reporterNickname: string;
      otherOpenReports: { id: string }[];
      race: { id: string };
    }>();
    expect(detail.reporterNickname).toBe('제보러너');
    expect(detail.otherOpenReports.map((o) => o.id)).toEqual([recent.id]);
    expect(detail.race.id).toBe(race.id);
    const anon = (await adminCall(ctx, owner, 'GET', `/reports/${recent.id}`)).json<{
      reporterNickname: string | null;
    }>();
    expect(anon.reporterNickname).toBeNull();

    const bad = await adminCall(ctx, owner, 'POST', '/reports/resolve', {
      ids: [old.id],
      action: 'rejected',
    });
    expect(errorOf(bad).fieldErrors).toEqual([{ path: 'rejectReason', code: 'required' }]);

    const res = await adminCall(ctx, owner, 'POST', '/reports/resolve', {
      ids: [old.id, recent.id],
      action: 'rejected',
      rejectReason: 'same_as_official',
    });
    expect(res.json()).toEqual({ resolved: 2 });
    const [row] = await ctx.db.select().from(raceReports).where(eq(raceReports.id, old.id));
    expect(row).toMatchObject({
      status: 'rejected',
      resolutionNote: 'same_as_official',
      resolvedBy: owner.id,
    });
    expect(row!.resolvedAt).not.toBeNull();

    // 제보자(탈퇴하지 않은 1명)에게만 앱 내 알림 — 앱 목록 API로 확인
    const inbox = (await call(ctx, reporter.id, 'GET', '/v1/me/notifications')).json<{
      items: { kind: string; title: string; body: string }[];
    }>();
    expect(inbox.items).toEqual([
      expect.objectContaining({
        kind: 'report_rejected',
        title: '제보를 확인했어요',
        body: '제보 대회: 공식 정보와 같아요. 다른 점이 있으면 다시 알려주세요.',
      }),
    ]);

    // 이미 처리된 제보는 다시 처리하지 않는다
    const again = await adminCall(ctx, owner, 'POST', '/reports/resolve', {
      ids: [old.id],
      action: 'applied',
    });
    expect(again.json()).toEqual({ resolved: 0 });
  });

  it('반영 → N-07a', async () => {
    const op = await loginAs(ctx, 'operator');
    const { race } = await createRace(ctx, { name: '반영 대회' });
    const reporter = await createUser(ctx);
    const r = await report(race.id, reporter.id, '참가비가 바뀌었어요. 확인 부탁드립니다.');
    await adminCall(ctx, op, 'POST', '/reports/resolve', { ids: [r.id], action: 'applied' });
    const [n] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, reporter.id));
    expect(n).toMatchObject({ kind: 'report_applied', status: 'sent' });
    expect((n!.payload as { body: string }).body).toBe(
      '반영 대회 정보를 고쳤어요. 알려주셔서 감사해요.',
    );
  });
});

describe('개발용 값은 운영에서 거부 (T-024)', () => {
  it('NODE_ENV=production이면 개발 관리자 시드를 만들지 않는다', async () => {
    const { seedDevAdmin } = await import('../src/db/seed.js');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seedDevAdmin(ctx.db, ctx.app.cipher!)).rejects.toThrow(/NODE_ENV=production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(await ctx.db.$count(adminUsers)).toBe(0);
  });
});
