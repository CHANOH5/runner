import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.js';
import { createdAt, pk, timestamptz, updatedAt } from './columns.js';
import { raceEvents, races } from './races.js';

export const raceInterests = pgTable(
  'race_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.raceId] })],
);

/*
 * registration_verifications(참가 인증)는 Phase 2 (PRD 9장).
 */
export const raceRegistrations = pgTable(
  'race_registrations',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    raceEventId: uuid('race_event_id')
      .notNull()
      .references(() => raceEvents.id, { onDelete: 'cascade' }),
    goalTimeSec: integer('goal_time_sec'),
    /** 서버가 goal_time_sec와 종목 거리로 계산해 저장 */
    goalPaceSecPerKm: integer('goal_pace_sec_per_km'),
    /** 0: 자가 | 1: 배번 | 2: 공식 (P-VER) */
    verificationLevel: smallint('verification_level').notNull().default(0),
    /** Phase 4 결과 입력 */
    finishTimeSec: integer('finish_time_sec'),
    /** planned | finished | dns | dnf */
    status: text('status').notNull().default('planned'),
    /** 목표를 정한 방법: prediction | manual | none (Registration.goalSource) */
    goalSource: text('goal_source').notNull().default('none'),
    /** 사용자가 기록하는 공식 접수 여부 (D-019, PRD 4.10.1): not_registered | registered | missed */
    entryStatus: text('entry_status').notNull().default('not_registered'),
    /** 상태를 바꾼 시각. 생성 시 서버 기본값을 쓰면 null */
    entryStatusUpdatedAt: timestamptz('entry_status_updated_at'),
    /** form | return_prompt | race_detail | my_races */
    entryStatusSource: text('entry_status_source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 대회당 한 종목 (P-VER-04)
    unique('race_registrations_user_race_key').on(t.userId, t.raceId),
    index('race_registrations_event_pace_idx').on(t.raceEventId, t.goalPaceSecPerKm),
    // 알림 대상 확정 (tech/03 7장)
    index('race_registrations_race_entry_status_idx').on(t.raceId, t.entryStatus),
    check(
      'race_registrations_entry_status_check',
      sql`${t.entryStatus} IN ('not_registered', 'registered', 'missed')`,
    ),
    check(
      'race_registrations_entry_status_source_check',
      sql`${t.entryStatusSource} IN ('form', 'return_prompt', 'race_detail', 'my_races')`,
    ),
    check(
      'race_registrations_goal_source_check',
      sql`${t.goalSource} IN ('prediction', 'manual', 'none') AND (${t.goalSource} = 'none') = (${t.goalTimeSec} IS NULL)`,
    ),
  ],
);
