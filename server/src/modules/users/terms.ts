import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { termsVersions, userConsents } from '../../db/schema/index.js';

export type TermsRow = typeof termsVersions.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Phase 1에 받는 동의 항목 (PRD 4.2). location은 Phase 3, night_push는 받지 않는다 */
export const PHASE1_TERMS_KINDS = ['service', 'privacy', 'marketing'] as const;

/** kind별 현재 시행 버전 (effective_at ≤ now 중 가장 최근) */
export async function currentTerms(db: Db | Tx, now = new Date()): Promise<TermsRow[]> {
  return db
    .selectDistinctOn([termsVersions.kind])
    .from(termsVersions)
    .where(
      and(
        lte(termsVersions.effectiveAt, now),
        inArray(termsVersions.kind, [...PHASE1_TERMS_KINDS]),
      ),
    )
    .orderBy(termsVersions.kind, desc(termsVersions.effectiveAt));
}

/** 재동의가 필요한 필수 약관: 현재 버전에 agree 행이 없는 것 (tech/06 2.2) */
export async function pendingRequiredTerms(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<TermsRow[]> {
  const required = (await currentTerms(db, now)).filter((t) => t.required);
  if (required.length === 0) return [];
  const agreed = await db
    .select({ termsVersionId: userConsents.termsVersionId })
    .from(userConsents)
    .where(
      and(
        eq(userConsents.userId, userId),
        eq(userConsents.action, 'agree'),
        inArray(
          userConsents.termsVersionId,
          required.map((t) => t.id),
        ),
      ),
    );
  const done = new Set(agreed.map((a) => a.termsVersionId));
  return required.filter((t) => !done.has(t.id));
}
