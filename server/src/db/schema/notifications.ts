import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.js';
import { createdAt, pk, timestamptz } from './columns.js';
import { raceEvents, races } from './races.js';

export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  registrationAlerts: boolean('registration_alerts').notNull().default(true),
  ddayAlerts: boolean('dday_alerts').notNull().default(true),
  socialAlerts: boolean('social_alerts').notNull().default(true),
  /** 별도 동의 (P-NOTI-01) */
  marketing: boolean('marketing').notNull().default(false),
  nightMarketing: boolean('night_marketing').notNull().default(false),
});

/** 대회 단위 알림 예약표 (N-01~N-05). 사용자별 행은 발송 30분 전에 만든다 (tech/03 7장) */
export const notificationSchedules = pgTable(
  'notification_schedules',
  {
    id: pk(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    /** 종목별 마감(N-03 참가 등록자)일 때만 */
    raceEventId: uuid('race_event_id').references(() => raceEvents.id, { onDelete: 'cascade' }),
    /** reg_open_d1 | reg_open_soon | reg_close_d1 | race_d7 | race_d1 */
    kind: text('kind').notNull(),
    scheduledAt: timestamptz('scheduled_at').notNull(),
    /** pending | materialized | done | cancelled */
    status: text('status').notNull().default('pending'),
  },
  (t) => [
    unique('notification_schedules_race_event_kind_key')
      .on(t.raceId, t.raceEventId, t.kind)
      .nullsNotDistinct(),
    index('notification_schedules_pending_idx')
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 공지(N-08)면 null */
    raceId: uuid('race_id').references(() => races.id, { onDelete: 'cascade' }),
    /** N-08이면 notices.id */
    noticeId: uuid('notice_id'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    scheduledAt: timestamptz('scheduled_at').notNull(),
    /** scheduled | sent | cancelled | failed */
    status: text('status').notNull().default('scheduled'),
    /** 묶음 발송 키 (user_id + kind + scheduled_at) */
    pushGroupKey: text('push_group_key'),
    sentAt: timestamptz('sent_at'),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // 중복 방지 (PRD 7.1)
    uniqueIndex('notifications_dedupe_key')
      .on(t.userId, t.raceId, t.kind, t.scheduledAt)
      .where(sql`${t.raceId} IS NOT NULL`),
    index('notifications_scheduled_idx')
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled'`),
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

/** 공지·마케팅 푸시 (A-008, N-08) */
export const notices = pgTable(
  'notices',
  {
    id: pk(),
    /** notice | marketing */
    kind: text('kind').notNull(),
    /** marketing은 "(광고) " 자동 접두 */
    title: varchar('title', { length: 30 }).notNull(),
    body: varchar('body', { length: 500 }).notNull(),
    sendPush: boolean('send_push').notNull().default(false),
    /** notice | race | race_list */
    linkType: text('link_type').notNull(),
    linkRaceId: uuid('link_race_id').references(() => races.id, { onDelete: 'set null' }),
    /** null = 승인 즉시 */
    scheduledAt: timestamptz('scheduled_at'),
    /** draft | approved | sent | withdrawn */
    status: text('status').notNull().default('draft'),
    /** admin_users.id (operator) */
    createdBy: uuid('created_by').notNull(),
    /** admin_users.id (owner) */
    approvedBy: uuid('approved_by'),
    approvedAt: timestamptz('approved_at'),
    sentCount: integer('sent_count'),
    failedCount: integer('failed_count'),
    createdAt: createdAt(),
  },
  (t) => [
    // 마케팅 야간 발송 금지 (P-NOTI-02)
    check(
      'notices_marketing_daytime',
      sql`${t.kind} <> 'marketing' OR ${t.scheduledAt} IS NULL OR (${t.scheduledAt} AT TIME ZONE 'Asia/Seoul')::time BETWEEN '08:00' AND '20:59:59'`,
    ),
  ],
);
