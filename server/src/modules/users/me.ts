import type { Me, Provider, RegionCode } from '@berun/shared';
import { and, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  authIdentities,
  raceInterests,
  raceRegistrations,
  races,
  userProfiles,
  users,
} from '../../db/schema/index.js';
import { notFound } from '../../lib/errors.js';
import { kstDate, toKstIso } from '../../lib/time.js';
import { pendingRequiredTerms } from './terms.js';

/** 닉네임 변경 간격 (PRD 4.3) */
export const NICKNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** GET /me 응답 (tech/06 6.3) */
export async function buildMe(db: Db, userId: string, now = new Date()): Promise<Me> {
  const today = kstDate(now);
  const [row] = await db
    .select({ user: users, profile: userProfiles })
    .from(users)
    .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) throw notFound('user');

  const [[identity], pending, [interested], [upcoming], [past]] = await Promise.all([
    db
      .select({ provider: authIdentities.provider })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId))
      .orderBy(authIdentities.createdAt)
      .limit(1),
    pendingRequiredTerms(db, userId, now),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(raceInterests)
      .innerJoin(races, eq(races.id, raceInterests.raceId))
      .where(
        and(
          eq(raceInterests.userId, userId),
          gte(races.raceDate, today),
          ne(races.publishStatus, 'draft'),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(raceRegistrations)
      .innerJoin(races, eq(races.id, raceRegistrations.raceId))
      .where(
        and(
          eq(raceRegistrations.userId, userId),
          gte(races.raceDate, today),
          ne(races.publishStatus, 'draft'),
        ),
      ),
    // 지난 대회 = (관심 ∪ 참가 예정) ∩ 대회일 < 오늘
    db
      .select({ n: sql<number>`count(DISTINCT ${races.id})::int` })
      .from(races)
      .where(
        and(
          lt(races.raceDate, today),
          ne(races.publishStatus, 'draft'),
          sql`(${races.id} IN (SELECT race_id FROM race_interests WHERE user_id = ${userId})
            OR ${races.id} IN (SELECT race_id FROM race_registrations WHERE user_id = ${userId}))`,
        ),
      ),
  ]);

  const changed = row.profile.nicknameChangedAt;
  const availableAt =
    changed && changed.getTime() + NICKNAME_COOLDOWN_MS > now.getTime()
      ? toKstIso(new Date(changed.getTime() + NICKNAME_COOLDOWN_MS))
      : null;

  return {
    id: row.user.id,
    nickname: row.profile.nickname,
    nicknameChangeAvailableAt: availableAt,
    birthYear: row.user.birthYear,
    regionCode: row.profile.regionCode as RegionCode,
    gender: (row.profile.gender as Me['gender']) ?? null,
    runningSince: row.profile.runningSince,
    provider: (identity?.provider ?? 'kakao') as Provider,
    pendingTerms: pending.map((t) => ({
      id: t.id,
      kind: t.kind,
      version: t.version,
      contentUrl: t.contentUrl,
      // 주요 변경 요약은 terms_versions에 컬럼이 없어 null (관리 방식 정해지면 추가)
      summary: null,
    })),
    counts: { interested: interested?.n ?? 0, upcoming: upcoming?.n ?? 0, past: past?.n ?? 0 },
  };
}
