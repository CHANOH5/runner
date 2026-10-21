import { date, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './accounts.js';
import { createdAt, pk, updatedAt } from './columns.js';
import { raceRegistrations } from './participation.js';

export const runRecords = pgTable(
  'run_records',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    distanceM: integer('distance_m').notNull(),
    durationSec: integer('duration_sec').notNull(),
    runDate: date('run_date', { mode: 'string' }).notNull(),
    /** 5k | 10k | half | full | other (PRD 3.3) */
    category: text('category').notNull(),
    /** race | training */
    kind: text('kind').notNull(),
    raceRegistrationId: uuid('race_registration_id').references(() => raceRegistrations.id, {
      onDelete: 'set null',
    }),
    title: text('title'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('run_records_user_date_idx').on(t.userId, t.runDate.desc())],
);

export const predictions = pgTable(
  'predictions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    raceRegistrationId: uuid('race_registration_id').references(() => raceRegistrations.id, {
      onDelete: 'set null',
    }),
    targetDistanceM: integer('target_distance_m').notNull(),
    predictedSec: integer('predicted_sec').notNull(),
    rangeMinSec: integer('range_min_sec').notNull(),
    rangeMaxSec: integer('range_max_sec').notNull(),
    /** high | medium | low (P-PRED-02) */
    confidence: text('confidence').notNull(),
    /** "riegel-1.06-v1" */
    modelVersion: text('model_version').notNull(),
    /** 사용한 기록·가중치와 계산 부가값 (modules/predictions/service.ts PredictionSnapshot) */
    inputSnapshot: jsonb('input_snapshot').notNull(),
    /** { even: SplitRow[], negative: SplitRow[] } */
    splits: jsonb('splits'),
    createdAt: createdAt(),
  },
  // 최근 예측 목록 (created_at DESC, id) — tech/06 4장
  (t) => [index('predictions_user_created_idx').on(t.userId, t.createdAt.desc())],
);
