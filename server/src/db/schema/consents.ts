import { boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, timestamptz } from './columns.js';

export const termsVersions = pgTable(
  'terms_versions',
  {
    id: pk(),
    /** service | privacy | location | marketing | night_push */
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    required: boolean('required').notNull(),
    contentUrl: text('content_url').notNull(),
    effectiveAt: timestamptz('effective_at').notNull(),
  },
  (t) => [unique('terms_versions_kind_version_key').on(t.kind, t.version)],
);

/** 동의·철회 이력 (append-only) */
export const userConsents = pgTable(
  'user_consents',
  {
    id: pk(),
    /** 탈퇴 후 법정 보존 대상이므로 FK 없이 보관 [확인 필요] */
    userId: uuid('user_id').notNull(),
    termsVersionId: uuid('terms_version_id')
      .notNull()
      .references(() => termsVersions.id),
    /** agree | withdraw */
    action: text('action').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('user_consents_user_terms_idx').on(t.userId, t.termsVersionId, t.createdAt.desc())],
);
