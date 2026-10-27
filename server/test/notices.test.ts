import { NoticeDetail } from '@berun/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notices } from '../src/db/schema/index.js';
import { toKstIso } from '../src/lib/time.js';
import { call, createRace, createUser, DAY, errorOf, fromNow } from './fixtures.js';
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

const ADMIN_ID = '0199f000-0000-7000-8000-000000000999';
async function addNotice(over: Partial<typeof notices.$inferInsert> = {}) {
  const [row] = await ctx.db
    .insert(notices)
    .values({
      kind: 'notice',
      title: '서비스 점검 안내',
      body: '11월 1일 새벽 2시~4시 점검이 있어요.\n점검 중에는 앱을 쓸 수 없어요.',
      linkType: 'notice',
      status: 'sent',
      createdBy: ADMIN_ID,
      approvedBy: ADMIN_ID,
      approvedAt: fromNow(-DAY),
      ...over,
    })
    .returning();
  return row!;
}
const get = (id: string) => call(ctx, userId, 'GET', `/v1/notices/${id}`);

describe('GET /v1/notices/{id} (tech/06 6.5)', () => {
  it('보낸 공지: 본문 그대로(줄바꿈 유지), 게시 시각 = 승인 시각, 이동 버튼 없음', async () => {
    const n = await addNotice();
    const res = await get(n.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(NoticeDetail.parse(res.json())).toEqual({
      id: n.id,
      kind: 'notice',
      title: '서비스 점검 안내',
      body: '11월 1일 새벽 2시~4시 점검이 있어요.\n점검 중에는 앱을 쓸 수 없어요.',
      publishedAt: toKstIso(n.approvedAt!),
      link: { type: 'notice' },
    });
  });

  it('이동 대상: 대회 / 대회 목록. 예약 공지의 게시 시각은 예약 시각. 연결 대회가 지워졌으면 버튼 없음', async () => {
    const { race } = await createRace(ctx);
    const scheduledAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600_000);
    const toRace = await addNotice({
      kind: 'marketing',
      title: '(광고) 가을 대회 모음',
      linkType: 'race',
      linkRaceId: race.id,
      scheduledAt,
    });
    expect(NoticeDetail.parse((await get(toRace.id)).json())).toMatchObject({
      kind: 'marketing',
      link: { type: 'race', raceId: race.id },
      publishedAt: toKstIso(scheduledAt),
    });
    const toList = await addNotice({ linkType: 'race_list' });
    expect(NoticeDetail.parse((await get(toList.id)).json()).link).toEqual({ type: 'race_list' });
    const orphan = await addNotice({ linkType: 'race', linkRaceId: null });
    expect(NoticeDetail.parse((await get(orphan.id)).json()).link).toEqual({ type: 'notice' });
  });

  it('내린 공지 410 NOTICE_WITHDRAWN, 작성 중·발송 대기·없는 공지 404', async () => {
    const withdrawn = await addNotice({ status: 'withdrawn' });
    const res = await get(withdrawn.id);
    expect([res.statusCode, errorOf(res).code]).toEqual([410, 'NOTICE_WITHDRAWN']);

    for (const status of ['draft', 'approved']) {
      const n = await addNotice({ status });
      const r = await get(n.id);
      expect([r.statusCode, errorOf(r).code], status).toEqual([404, 'NOT_FOUND']);
    }
    expect((await get('0199f000-0000-7000-8000-00000000dead')).statusCode).toBe(404);
  });

  it('로그인이 필요하다', async () => {
    const n = await addNotice();
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/notices/${n.id}` })).statusCode).toBe(
      401,
    );
  });
});
