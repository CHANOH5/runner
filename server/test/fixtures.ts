import { ApiError } from '@berun/shared';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  raceEvents,
  raceInterests,
  raceRegistrations,
  races,
  raceSources,
  termsVersions,
  userProfiles,
  users,
} from '../src/db/schema/index.js';
import { addDays, kstDate } from '../src/lib/time.js';
import type { TestContext } from './helpers.js';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const today = () => kstDate(new Date());
export const fromNow = (ms: number) => new Date(Date.now() + ms);

export async function createUser(ctx: TestContext, nickname?: string) {
  const [user] = await ctx.db.insert(users).values({ birthYear: 1990 }).returning();
  await ctx.db.insert(userProfiles).values({
    userId: user!.id,
    nickname: nickname ?? `u${user!.id.slice(-8)}`,
    regionCode: 'seoul',
  });
  return user!;
}

type RaceOpts = Partial<typeof races.$inferInsert> & {
  /** 대회일: 오늘 + n일 */
  inDays?: number;
  events?: Partial<typeof raceEvents.$inferInsert>[];
  venue?: { lat: number; lng: number };
};

/** 게시된 도로 대회 + 종목 (기본: 30일 뒤, 하프 1개, 접수 중) */
export async function createRace(ctx: TestContext, opts: RaceOpts = {}) {
  const { inDays = 30, events, venue, ...race } = opts;
  const [row] = await ctx.db
    .insert(races)
    .values({
      name: '테스트 마라톤',
      slug: `test-${uuidv7()}`,
      regionCode: 'seoul',
      raceDate: addDays(today(), inDays),
      publishStatus: 'published',
      dedupeKey: 'test',
      officialUrl: 'https://example.com/race',
      lastVerifiedAt: new Date(),
      registrationOpensAt: fromNow(-10 * DAY),
      registrationClosesAt: fromNow(10 * DAY),
      ...race,
    })
    .returning();
  const evs = await ctx.db
    .insert(raceEvents)
    .values(
      (events ?? [{}]).map((e) => ({
        raceId: row!.id,
        name: '하프코스',
        category: 'half',
        distanceM: 21097,
        ...e,
      })),
    )
    .returning();
  await ctx.db.insert(raceSources).values({
    raceId: row!.id,
    sourceKind: 'official',
    sourceName: '공식 홈페이지',
    sourceUrl: 'https://example.com/race',
    isPrimary: true,
    fetchedAt: new Date(),
  });
  if (venue) {
    await ctx.db.execute(
      sql`UPDATE races SET venue_point = ST_SetSRID(ST_MakePoint(${venue.lng}, ${venue.lat}), 4326)::geography WHERE id = ${row!.id}`,
    );
  }
  return { race: row!, events: evs, event: evs[0]! };
}

export async function addInterest(ctx: TestContext, userId: string, raceId: string) {
  await ctx.db.insert(raceInterests).values({ userId, raceId });
}

export async function addRegistration(
  ctx: TestContext,
  userId: string,
  raceId: string,
  raceEventId: string,
  extra: Partial<typeof raceRegistrations.$inferInsert> = {},
) {
  const [reg] = await ctx.db
    .insert(raceRegistrations)
    .values({ userId, raceId, raceEventId, ...extra })
    .returning();
  return reg!;
}

/** 현재 시행 약관 (service·privacy 필수, marketing 선택) */
export async function seedTerms(ctx: TestContext, effectiveAt = fromNow(-DAY)) {
  const rows = await ctx.db
    .insert(termsVersions)
    .values(
      (['service', 'privacy', 'marketing', 'night_push'] as const).map((kind) => ({
        kind,
        version: `v-${effectiveAt.getTime()}`,
        required: kind === 'service' || kind === 'privacy',
        contentUrl: `https://example.com/terms/${kind}`,
        effectiveAt,
      })),
    )
    .returning();
  const by = (k: string) => rows.find((r) => r.kind === k)!;
  return {
    service: by('service'),
    privacy: by('privacy'),
    marketing: by('marketing'),
    nightPush: by('night_push'),
  };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** 사용자 토큰으로 호출 */
export async function call(
  ctx: TestContext,
  userId: string | null,
  method: Method,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.app.inject({
    method,
    url,
    headers: {
      ...(userId && { authorization: `Bearer ${await ctx.tokenFor(userId)}` }),
      ...headers,
    },
    ...(payload !== undefined && { payload: payload as object }),
  });
}

export const errorOf = (res: { json: () => unknown }) => ApiError.parse(res.json()).error;
