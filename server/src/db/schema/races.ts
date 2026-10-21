import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.js';
import { createdAt, pk, timestamptz, updatedAt } from './columns.js';

/*
 * races.venue_point geography(Point, 4326)는 raw SQL 마이그레이션에서 만든다 (columns.ts 참고).
 * race_courses(코스 LineString)는 PRD 9장에 따라 Phase 2 이후에 만든다.
 */
export const races = pgTable(
  'races',
  {
    id: pk(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('races_slug_key'),
    organizer: text('organizer'),
    regionCode: text('region_code').notNull(),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    raceDate: date('race_date', { mode: 'string' }).notNull(),
    timezone: text('timezone').notNull().default('Asia/Seoul'),
    registrationOpensAt: timestamptz('registration_opens_at'),
    /** false면 opens_at은 오픈일 00:00 KST, 시각 미정 (N-02는 09:00) */
    registrationOpensTimeKnown: boolean('registration_opens_time_known').notNull().default(true),
    registrationClosesAt: timestamptz('registration_closes_at'),
    courseUrl: text('course_url'),
    /** scheduled | postponed | cancelled | finished (P-RACE-06) */
    status: text('status').notNull().default('scheduled'),
    /** draft | published | hidden */
    publishStatus: text('publish_status').notNull().default('draft'),
    /** road | trail | ultra | track | virtual. Phase 1은 road만 게시 (D-013) */
    raceType: text('race_type').notNull().default('road'),
    /** first_come | lottery | unknown */
    registrationMethod: text('registration_method').notNull().default('unknown'),
    /** 정규화 대회명 + 대회일 (중복 경고용, 유니크 아님 — PRD 8.4) */
    dedupeKey: text('dedupe_key').notNull(),
    officialUrl: text('official_url'),
    registrationUrl: text('registration_url'),
    /** 최종 확인일 (P-RACE-02). 게시 시 필수 */
    lastVerifiedAt: timestamptz('last_verified_at'),
    clonedFrom: uuid('cloned_from').references((): AnyPgColumn => races.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('races_race_date_idx').on(t.raceDate),
    index('races_region_date_idx').on(t.regionCode, t.raceDate),
    index('races_registration_opens_at_idx').on(t.registrationOpensAt),
    index('races_dedupe_key_idx').on(t.dedupeKey),
    // 게시 조건 일부. 종목·출처·도로 대회 한정(D-013)은 서버 검사
    check(
      'races_publish_requirements',
      sql`${t.publishStatus} <> 'published' OR (${t.officialUrl} IS NOT NULL AND ${t.lastVerifiedAt} IS NOT NULL)`,
    ),
  ],
);

/** 종목 (5K / 10K / Half / Full ...) */
export const raceEvents = pgTable(
  'race_events',
  {
    id: pk(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 5k | 10k | half | full | other (PRD 3.3) */
    category: text('category').notNull(),
    distanceM: integer('distance_m').notNull(),
    startAt: timestamptz('start_at'),
    /** 제한 시간 (분) */
    timeLimitMin: integer('time_limit_min'),
    feeKrw: integer('fee_krw'),
    capacity: integer('capacity'),
    /** 종목별 접수 기간이 대회와 다를 때만 (null이면 races 값 사용) */
    registrationOpensAt: timestamptz('registration_opens_at'),
    registrationClosesAt: timestamptz('registration_closes_at'),
  },
  (t) => [index('race_events_race_id_idx').on(t.raceId)],
);

export const raceSources = pgTable(
  'race_sources',
  {
    id: pk(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    /** official | organizer | aggregator | news | user_report | manual */
    sourceKind: text('source_kind').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url'),
    externalId: text('external_id'),
    /** 앱에 "출처"로 표시할 대표 출처 (P-RACE-02) */
    isPrimary: boolean('is_primary').notNull().default(false),
    /** 마지막으로 가져온 본문 해시 (원문은 저장하지 않음) */
    contentHash: text('content_hash'),
    fetchedAt: timestamptz('fetched_at'),
    lastCheckedAt: timestamptz('last_checked_at'),
    lastChangedAt: timestamptz('last_changed_at'),
  },
  (t) => [
    uniqueIndex('race_sources_primary_key')
      .on(t.raceId)
      .where(sql`${t.isPrimary}`),
  ],
);

/** 수집기·주최사·운영자가 올린 신규/변경 후보. 승인되어야 races에 반영 (T-012) */
export const raceCandidates = pgTable(
  'race_candidates',
  {
    id: pk(),
    /** null이면 신규 대회 후보 */
    raceId: uuid('race_id').references(() => races.id, { onDelete: 'cascade' }),
    /** crawler | organizer | admin */
    origin: text('origin').notNull(),
    sourceUrl: text('source_url'),
    proposed: jsonb('proposed').notNull(),
    diff: jsonb('diff'),
    /** pending | approved | rejected | duplicate */
    status: text('status').notNull().default('pending'),
    /** admin_users.id */
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamptz('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('race_candidates_status_idx').on(t.status, t.createdAt)],
);

/** 정보 오류 제보 (F-016) */
export const raceReports = pgTable('race_reports', {
  id: pk(),
  raceId: uuid('race_id')
    .notNull()
    .references(() => races.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  field: text('field'),
  message: text('message').notNull(),
  /** open | applied | rejected */
  status: text('status').notNull().default('open'),
  resolutionNote: text('resolution_note'),
  /** admin_users.id */
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamptz('resolved_at'),
  createdAt: createdAt(),
});
