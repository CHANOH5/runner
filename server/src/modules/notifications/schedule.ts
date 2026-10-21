import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notifications, notificationSchedules, raceEvents, races } from '../../db/schema/index.js';
import { effectiveWindow } from '../../lib/registration-window.js';
import { addDays, kstAt, kstDate } from '../../lib/time.js';
import type { ScheduledKind } from './kinds.js';

type RaceRow = typeof races.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;

export type DesiredSchedule = {
  kind: ScheduledKind;
  /** N-03 종목별 마감 행만 값이 있다 */
  raceEventId: string | null;
  scheduledAt: Date;
};

/**
 * 대회 단위 예약표 계산 (PRD 7.1·7.2, tech/03 7장). 순수 함수 — 시계는 인자로 받는다.
 * - N-01 오픈 전날 19:00 / N-02 오픈 −10분 (시각 미정이면 오픈일 09:00)
 * - N-03 마감 전날 19:00. 유효 마감이 없으면 만들지 않는다. 종목별 마감이 있는 종목은 종목 행을 따로 둔다
 * - N-04 대회 7일 전 12:00 / N-05 대회 전날 19:00
 * - 이미 지난 시각은 만들지 않는다. 취소·종료·미게시 대회는 하나도 만들지 않는다
 */
export function computeSchedules(race: RaceRow, events: EventRow[], now: Date): DesiredSchedule[] {
  if (
    race.publishStatus !== 'published' ||
    race.status === 'cancelled' ||
    race.status === 'finished'
  ) {
    return [];
  }
  const window = effectiveWindow(race, events);
  const out: DesiredSchedule[] = [];
  const push = (kind: ScheduledKind, scheduledAt: Date, raceEventId: string | null = null) => {
    if (scheduledAt > now) out.push({ kind, raceEventId, scheduledAt });
  };

  if (window.opensAt) {
    const openDay = kstDate(window.opensAt);
    push('reg_open_d1', kstAt(addDays(openDay, -1), '19:00'));
    push(
      'reg_open_soon',
      race.registrationOpensTimeKnown
        ? new Date(window.opensAt.getTime() - 10 * 60 * 1000)
        : kstAt(openDay, '09:00'),
    );
  }
  if (window.closesAt) {
    push('reg_close_d1', kstAt(addDays(kstDate(window.closesAt), -1), '19:00'));
  }
  for (const e of events) {
    if (e.registrationClosesAt) {
      push('reg_close_d1', kstAt(addDays(kstDate(e.registrationClosesAt), -1), '19:00'), e.id);
    }
  }
  push('race_d7', kstAt(addDays(race.raceDate, -7), '12:00'));
  push('race_d1', kstAt(addDays(race.raceDate, -1), '19:00'));
  return out;
}

const keyOf = (s: { kind: string; raceEventId: string | null }) =>
  `${s.kind}:${s.raceEventId ?? ''}`;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** 이 예약 행으로 확정됐지만 아직 보내지 않은 사용자별 알림을 취소 */
async function cancelMaterialized(tx: Tx, scheduleIds: string[]) {
  if (scheduleIds.length === 0) return;
  await tx
    .update(notifications)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(notifications.status, 'scheduled'),
        inArray(sql`${notifications.payload}->>'scheduleId'`, scheduleIds),
      ),
    );
}

/**
 * 대회 저장·변경 시 미발송 예약표를 다시 계산한다 (PRD 7.1 재계산).
 * - 시각이 같으면 그대로 (보낸 것도 다시 보내지 않음)
 * - 시각이 바뀌면 확정된 미발송 알림을 취소하고 새 시각으로 pending
 * - 더 이상 필요 없는 행(취소 대회, 마감 삭제 등)은 cancelled
 */
export async function recalculateSchedules(db: Db, raceId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, raceId)).for('update');
    if (!race) return { upserted: 0, cancelled: 0 };
    const events = await tx.select().from(raceEvents).where(eq(raceEvents.raceId, raceId));
    const desired = new Map(computeSchedules(race, events, now).map((d) => [keyOf(d), d]));
    const existing = await tx
      .select()
      .from(notificationSchedules)
      .where(eq(notificationSchedules.raceId, raceId));

    let upserted = 0;
    const toCancel: string[] = [];
    for (const row of existing) {
      const want = desired.get(keyOf(row));
      desired.delete(keyOf(row));
      if (!want) {
        if (row.status === 'pending' || row.status === 'materialized') toCancel.push(row.id);
        continue;
      }
      if (want.scheduledAt.getTime() === row.scheduledAt.getTime()) {
        if (row.status === 'cancelled') {
          await tx
            .update(notificationSchedules)
            .set({ status: 'pending' })
            .where(eq(notificationSchedules.id, row.id));
          upserted++;
        }
        continue;
      }
      if (row.status === 'materialized') await cancelMaterialized(tx, [row.id]);
      await tx
        .update(notificationSchedules)
        .set({ scheduledAt: want.scheduledAt, status: 'pending' })
        .where(eq(notificationSchedules.id, row.id));
      upserted++;
    }
    if (desired.size > 0) {
      await tx.insert(notificationSchedules).values(
        [...desired.values()].map((d) => ({
          raceId,
          raceEventId: d.raceEventId,
          kind: d.kind,
          scheduledAt: d.scheduledAt,
        })),
      );
      upserted += desired.size;
    }
    if (toCancel.length > 0) {
      await cancelMaterialized(tx, toCancel);
      await tx
        .update(notificationSchedules)
        .set({ status: 'cancelled' })
        .where(inArray(notificationSchedules.id, toCancel));
    }
    return { upserted, cancelled: toCancel.length };
  });
}
