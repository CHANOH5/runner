import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  devices,
  notifications,
  notificationSchedules,
  raceEvents,
  raceRegistrations,
  races,
} from '../../db/schema/index.js';
import {
  effectiveWindow,
  eventClosesAt,
  registrationState,
} from '../../lib/registration-window.js';
import { kstDate } from '../../lib/time.js';
import { audienceSql } from './audience.js';
import {
  canSendAt,
  isScheduledKind,
  RACE_CHANGE_KINDS,
  SCHEDULED_KINDS,
  type DeliverableKind,
  type RaceChangeKind,
} from './kinds.js';
import {
  EXPO_BATCH_SIZE,
  PushTransportError,
  type PushClient,
  type PushMessage,
  type RateLimiter,
} from './push.js';
import {
  isNoticeKind,
  materializeNotices,
  NOTICE_KINDS,
  prepareNoticeNotification,
} from './notices.js';
import { render, renderBundle, type Rendered } from './render.js';
import { recalculateSchedules } from './schedule.js';

/** 발송 30분 전에 대상 확정 (PRD 7.1) */
export const MATERIALIZE_LEAD_MS = 30 * 60 * 1000;
/** 실패 시 1분 간격 최대 3회 재시도 (PRD 7.1) */
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 60 * 1000;
/** 워커가 집어 간 알림의 임대 시간. 워커가 죽으면 이 시간 뒤 다른 워커가 다시 집는다 */
export const LEASE_MS = 5 * 60 * 1000;
const CLAIM_LIMIT = 1000;
const SCHEDULE_CLAIM_LIMIT = 50;

export type DeliveryDeps = {
  db: Db;
  push: PushClient;
  limiter: RateLimiter;
  /** 고정 시계로 테스트한다. 발송 시각(sent_at, D-018)도 이 시계 */
  clock: () => Date;
};

/** notifications.payload */
export type NotificationPayload = {
  scheduleId?: string;
  raceEventId?: string | null;
  registrationId?: string | null;
  changeSummary?: string | null;
  title?: string;
  body?: string;
  deepLink?: string;
  push?: { ticketIds: string[]; bundled: boolean; devices: number };
};

type NotificationRow = typeof notifications.$inferSelect;
type CancelReason = 'expired' | 'not_eligible';
type RaceRow = typeof races.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;
type RegistrationRow = typeof raceRegistrations.$inferSelect;

/** raw SQL에 시각을 넣을 때 (postgres-js는 sql`` 안의 Date를 직렬화하지 않는다) */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

const groupKey = (userId: string, kind: string, at: Date) =>
  `${userId}|${kind}|${at.toISOString()}`;

/**
 * 1) 대상 확정: 발송 30분 전이 된 예약 행마다 그 시점의 대상(tech/03 7장)으로 사용자별 알림을 만든다.
 * 중복은 (user_id, race_id, kind, scheduled_at) 유니크로 막는다. 여러 워커가 돌아도 SKIP LOCKED로 한 번만 처리.
 */
export async function materializeDue(
  deps: DeliveryDeps,
): Promise<{ schedules: number; created: number }> {
  const now = deps.clock();
  return deps.db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notificationSchedules)
      .where(
        and(
          eq(notificationSchedules.status, 'pending'),
          lte(notificationSchedules.scheduledAt, new Date(now.getTime() + MATERIALIZE_LEAD_MS)),
        ),
      )
      .orderBy(notificationSchedules.scheduledAt)
      .limit(SCHEDULE_CLAIM_LIMIT)
      .for('update', { skipLocked: true });

    let created = 0;
    for (const s of due) {
      const kind = s.kind as DeliverableKind;
      const audience = await tx.execute<{ user_id: string; registration_id: string | null }>(
        audienceSql({ raceId: s.raceId, kind, raceEventId: s.raceEventId }),
      );
      if (audience.length > 0) {
        const rows = await tx
          .insert(notifications)
          .values(
            audience.map((a) => ({
              userId: a.user_id,
              raceId: s.raceId,
              kind,
              scheduledAt: s.scheduledAt,
              pushGroupKey: groupKey(a.user_id, kind, s.scheduledAt),
              payload: {
                scheduleId: s.id,
                raceEventId: s.raceEventId,
                registrationId: a.registration_id,
              } satisfies NotificationPayload,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        created += rows.length;
      }
      await tx
        .update(notificationSchedules)
        .set({ status: 'materialized' })
        .where(eq(notificationSchedules.id, s.id));
    }
    return { schedules: due.length, created };
  });
}

/**
 * N-06 대회 변경 알림 (관리자 저장 즉시, 끌 수 없음). 대상: 관심 ∪ 참가 예정, 대회일 ≥ 오늘, active 사용자.
 * 행을 만들기만 하고 발송은 sendDue가 한다 (워커는 바로 이어서 sendDue를 부른다).
 */
export async function notifyRaceChange(
  deps: Pick<DeliveryDeps, 'db' | 'clock'>,
  raceId: string,
  kind: RaceChangeKind,
  changeSummary: string | null = null,
): Promise<number> {
  const now = deps.clock();
  const [race] = await deps.db.select().from(races).where(eq(races.id, raceId));
  if (!race || race.raceDate < kstDate(now)) return 0;
  const audience = await deps.db.execute<{ user_id: string; registration_id: string | null }>(
    audienceSql({ raceId, kind, raceEventId: null }),
  );
  if (audience.length === 0) return 0;
  const rows = await deps.db
    .insert(notifications)
    .values(
      audience.map((a) => ({
        userId: a.user_id,
        raceId,
        kind,
        scheduledAt: now,
        pushGroupKey: groupKey(a.user_id, kind, now),
        payload: { registrationId: a.registration_id, changeSummary } satisfies NotificationPayload,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length;
}

/**
 * 대회 저장 후 호출 (관리자 API·워커 작업): 예약표 재계산 + 필요하면 N-06.
 * 취소면 재계산이 N-01~N-05 예약과 확정된 미발송 알림을 모두 취소한다 (PRD 4.9 수용 기준).
 */
export async function handleRaceUpdated(
  deps: Pick<DeliveryDeps, 'db' | 'clock'>,
  raceId: string,
  opts: { notify?: RaceChangeKind; changeSummary?: string | null } = {},
) {
  const schedules = await recalculateSchedules(deps.db, raceId, deps.clock());
  const notified = opts.notify
    ? await notifyRaceChange(deps, raceId, opts.notify, opts.changeSummary ?? null)
    : 0;
  return { ...schedules, notified };
}

type SendContext = {
  races: Map<string, RaceRow>;
  events: Map<string, EventRow[]>;
  registrations: Map<string, RegistrationRow>;
};

const regKey = (userId: string, raceId: string) => `${userId}|${raceId}`;

async function loadContext(db: Db, rows: NotificationRow[]): Promise<SendContext> {
  const raceIds = [...new Set(rows.flatMap((r) => (r.raceId ? [r.raceId] : [])))];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  if (raceIds.length === 0)
    return { races: new Map(), events: new Map(), registrations: new Map() };
  const [raceRows, eventRows, regRows] = await Promise.all([
    db.select().from(races).where(inArray(races.id, raceIds)),
    db.select().from(raceEvents).where(inArray(raceEvents.raceId, raceIds)),
    db
      .select()
      .from(raceRegistrations)
      .where(
        and(inArray(raceRegistrations.raceId, raceIds), inArray(raceRegistrations.userId, userIds)),
      ),
  ]);
  const events = new Map<string, EventRow[]>();
  for (const e of eventRows) events.set(e.raceId, [...(events.get(e.raceId) ?? []), e]);
  return {
    races: new Map(raceRows.map((r) => [r.id, r])),
    events,
    registrations: new Map(regRows.map((r) => [regKey(r.userId, r.raceId), r])),
  };
}

/**
 * 발송 직전 확인 (PRD 7.1): ① 알림 설정 ② 대회 상태 ③ 대상 조건 ④ 시각 조건. ①③은 대상 쿼리를 다시 돌려 확인한다.
 * 통과하면 그 시점 값으로 문구를 다시 만든다 (N-04 본문 변형 등, tech/03 7장). 실패면 null = 취소.
 */
async function prepare(
  db: Db,
  row: NotificationRow,
  ctx: SendContext,
  now: Date,
): Promise<Rendered | { cancel: CancelReason }> {
  // 공지·마케팅 (N-08): 대회와 무관 — 공지 상태·야간·동의만 다시 본다
  if (isNoticeKind(row.kind)) return prepareNoticeNotification(db, row, now);
  const kind = row.kind as DeliverableKind;
  const payload = row.payload as NotificationPayload;
  const race = row.raceId ? ctx.races.get(row.raceId) : undefined;
  if (!race || race.publishStatus !== 'published' || !canSendAt(kind, now)) {
    return { cancel: 'not_eligible' };
  }
  if (isScheduledKind(kind) && (race.status === 'cancelled' || race.status === 'finished')) {
    return { cancel: 'not_eligible' };
  }

  const events = ctx.events.get(race.id) ?? [];
  const window = effectiveWindow(race, events);
  const reg = ctx.registrations.get(regKey(row.userId, race.id)) ?? null;
  const event = reg ? (events.find((e) => e.id === reg.raceEventId) ?? null) : null;
  const today = kstDate(now);
  const closesAt = event ? eventClosesAt(event, window) : window.closesAt;

  // ④ 시각 조건 — 문구가 사실과 달라지면 보내지 않는다 (워커가 멈췄다 늦게 돈 경우 포함)
  const opensAt = window.opensAt;
  const timeOk = (() => {
    switch (kind) {
      case 'reg_open_d1': // "내일 접수가 시작돼요" → 오픈 전날까지
        return opensAt !== null && now < opensAt && today < kstDate(opensAt);
      case 'reg_open_soon':
        return (
          opensAt !== null &&
          (race.registrationOpensTimeKnown ? now < opensAt : today <= kstDate(opensAt))
        );
      case 'reg_close_d1': // "내일 마감돼요" → 마감 전날까지
        return closesAt !== null && now < closesAt && today < kstDate(closesAt);
      case 'race_d7': // "일주일 남았어요" → D-7 당일(KST) 23:59까지 (PRD v1.7)
        return today < race.raceDate && today <= kstDate(row.scheduledAt);
      case 'race_d1': // "내일은" → 대회 전날까지
        return today < race.raceDate;
      default: // N-06은 대회일까지 (PRD v1.7)
        return race.raceDate >= today;
    }
  })();
  if (!timeOk) return { cancel: 'expired' };

  // ①③ 설정·대상·사용자 상태 (대상 확정 때와 같은 쿼리)
  const still = await db.execute(
    audienceSql({ raceId: race.id, kind, raceEventId: payload.raceEventId ?? null }, row.userId),
  );
  if (still.length === 0) return { cancel: 'not_eligible' };

  return render({
    kind,
    race,
    opensAt,
    opensTimeKnown: race.registrationOpensTimeKnown,
    closesAt,
    registrationClosed: registrationState(race, window, now) === 'closed',
    event: event ? { name: event.name, startAt: event.startAt } : null,
    registration: reg,
    changeSummary: payload.changeSummary ?? null,
  });
}

type Group = {
  key: string;
  userId: string;
  kind: DeliverableKind;
  items: { row: NotificationRow; rendered: Rendered }[];
};

/**
 * sent: 푸시 전달 / failed: 재시도 끝에 실패 / cancelled: 발송 직전 확인 불충족(설정·대상·대회 상태)
 * expired: 유효 구간이 지나 보내지 않음 — 실패와 따로 센다 (PRD v1.7, A-002). 행에는 last_error로 사유를 남긴다
 */
export type SendResult = {
  sent: number;
  failed: number;
  cancelled: number;
  expired: number;
  retried: number;
  noDevice: number;
};

/**
 * 2) 발송: 예약 시각이 된 알림을 집어(임대) 발송 직전 확인 → 묶음 → Expo 배치 전송.
 * - 같은 사용자·종류·예약 시각 2건 이상이면 푸시 1건 (앱 내 목록에는 각각 남는다)
 * - 기기 토큰이 없으면 앱 내 알림만 (status sent, sent_at null)
 * - DeviceNotRegistered → devices.push_token 삭제
 * - 전송 실패는 1분 뒤 재시도, 3회 넘게 실패하면 failed (앱 내 알림은 남는다)
 * - sent_at = 푸시 서비스에 넘긴 시각 (D-018)
 */
export async function sendDue(deps: DeliveryDeps): Promise<SendResult> {
  const now = deps.clock();
  const result: SendResult = {
    sent: 0,
    failed: 0,
    cancelled: 0,
    expired: 0,
    retried: 0,
    noDevice: 0,
  };
  const kinds = [...SCHEDULED_KINDS, ...RACE_CHANGE_KINDS, ...NOTICE_KINDS];

  const claimed = await deps.db.execute<{ id: string }>(sql`
    UPDATE notifications SET next_attempt_at = ${ts(new Date(now.getTime() + LEASE_MS))}
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'scheduled'
        AND scheduled_at <= ${ts(now)}
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${ts(now)})
        AND kind IN (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )})
      ORDER BY scheduled_at
      LIMIT ${CLAIM_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  if (claimed.length === 0) {
    await closeSchedules(deps.db, now);
    return result;
  }
  const rows = await deps.db
    .select()
    .from(notifications)
    .where(
      inArray(
        notifications.id,
        claimed.map((c) => c.id),
      ),
    );
  const ctx = await loadContext(deps.db, rows);

  // 발송 직전 확인 + 문구
  const groups = new Map<string, Group>();
  const cancelled: Record<CancelReason, string[]> = { expired: [], not_eligible: [] };
  for (const row of rows) {
    const rendered = await prepare(deps.db, row, ctx, now);
    if ('cancel' in rendered) {
      cancelled[rendered.cancel].push(row.id);
      continue;
    }
    const key = row.pushGroupKey ?? row.id;
    const g = groups.get(key) ?? {
      key,
      userId: row.userId,
      kind: row.kind as DeliverableKind,
      items: [],
    };
    g.items.push({ row, rendered });
    groups.set(key, g);
  }
  for (const reason of ['expired', 'not_eligible'] as const) {
    const ids = cancelled[reason];
    if (ids.length === 0) continue;
    await deps.db
      .update(notifications)
      .set({ status: 'cancelled', lastError: reason })
      .where(inArray(notifications.id, ids));
  }
  result.cancelled += cancelled.not_eligible.length;
  result.expired += cancelled.expired.length;

  // 기기
  const userIds = [...new Set([...groups.values()].map((g) => g.userId))];
  const deviceRows = userIds.length
    ? await deps.db
        .select({ userId: devices.userId, token: devices.pushToken })
        .from(devices)
        .where(and(inArray(devices.userId, userIds), isNotNull(devices.pushToken)))
    : [];
  const tokensOf = new Map<string, string[]>();
  for (const d of deviceRows) tokensOf.set(d.userId, [...(tokensOf.get(d.userId) ?? []), d.token!]);

  // 메시지 (묶음 = 같은 그룹 키 2건 이상)
  const outbox: { group: Group; message: PushMessage }[] = [];
  const noDevice: Group[] = [];
  for (const g of groups.values()) {
    const tokens = tokensOf.get(g.userId) ?? [];
    if (tokens.length === 0) {
      noDevice.push(g);
      continue;
    }
    const raceName = (i: Group['items'][number]) => ctx.races.get(i.row.raceId!)?.name ?? '';
    g.items.sort((x, y) => raceName(x).localeCompare(raceName(y)));
    const content =
      g.items.length >= 2
        ? renderBundle(
            g.kind,
            g.items.map((i) => ctx.races.get(i.row.raceId!)?.name ?? ''),
            {
              anyOpensTimeUnknown: g.items.some(
                (i) => ctx.races.get(i.row.raceId!)?.registrationOpensTimeKnown === false,
              ),
            },
          )
        : g.items[0]!.rendered;
    const notificationIds = g.items.map((i) => i.row.id);
    for (const to of tokens) {
      outbox.push({
        group: g,
        message: {
          to,
          title: content.title,
          body: content.body,
          data: { notificationIds, deepLink: content.deepLink },
          sound: 'default',
          priority: 'high',
        },
      });
    }
  }

  // 앱 내 알림 문구는 그룹과 무관하게 각자 저장
  const savePayload = (item: Group['items'][number], extra: Partial<NotificationPayload> = {}) => ({
    ...(item.row.payload as NotificationPayload),
    ...item.rendered,
    ...extra,
  });

  for (const g of noDevice) {
    for (const item of g.items) {
      await deps.db
        .update(notifications)
        .set({ status: 'sent', payload: savePayload(item), lastError: 'no_device' })
        .where(eq(notifications.id, item.row.id));
      result.noDevice++;
    }
  }

  // 배치 전송
  type Outcome = { ok: string[]; dead: string[]; transient: string | null; handedAt: Date | null };
  const outcomes = new Map<string, Outcome>();
  const outcomeOf = (g: Group) => {
    const o = outcomes.get(g.key) ?? { ok: [], dead: [], transient: null, handedAt: null };
    outcomes.set(g.key, o);
    return o;
  };
  for (let i = 0; i < outbox.length; i += EXPO_BATCH_SIZE) {
    const chunk = outbox.slice(i, i + EXPO_BATCH_SIZE);
    await deps.limiter.acquire(chunk.length);
    const handedAt = deps.clock();
    try {
      const tickets = await deps.push.send(chunk.map((c) => c.message));
      chunk.forEach((c, j) => {
        const o = outcomeOf(c.group);
        const t = tickets[j];
        if (t?.status === 'ok') {
          o.ok.push(t.id);
          o.handedAt = handedAt;
        } else if (t?.details?.error === 'DeviceNotRegistered') {
          o.dead.push(c.message.to);
        } else {
          o.transient = t?.details?.error ?? t?.message ?? 'missing_ticket';
        }
      });
    } catch (err) {
      const reason = err instanceof PushTransportError ? err.message : 'push_error';
      for (const c of chunk) outcomeOf(c.group).transient = reason;
    }
  }

  const deadTokens = [...outcomes.values()].flatMap((o) => o.dead);
  if (deadTokens.length) {
    await deps.db
      .update(devices)
      .set({ pushToken: null })
      .where(inArray(devices.pushToken, deadTokens));
  }

  for (const g of groups.values()) {
    const o = outcomes.get(g.key);
    if (!o) continue;
    for (const item of g.items) {
      const row = item.row;
      if (o.ok.length > 0) {
        await deps.db
          .update(notifications)
          .set({
            status: 'sent',
            sentAt: o.handedAt,
            lastError: null,
            payload: savePayload(item, {
              push: { ticketIds: o.ok, bundled: g.items.length >= 2, devices: o.ok.length },
            }),
          })
          .where(eq(notifications.id, row.id));
        result.sent++;
      } else if (!o.transient) {
        // 모든 기기 토큰이 무효 → 재시도해도 소용없다
        await deps.db
          .update(notifications)
          .set({ status: 'failed', lastError: 'device_not_registered', payload: savePayload(item) })
          .where(eq(notifications.id, row.id));
        result.failed++;
      } else if (row.attemptCount + 1 > MAX_RETRIES) {
        await deps.db
          .update(notifications)
          .set({
            status: 'failed',
            attemptCount: row.attemptCount + 1,
            lastError: o.transient,
            payload: savePayload(item),
          })
          .where(eq(notifications.id, row.id));
        result.failed++;
      } else {
        await deps.db
          .update(notifications)
          .set({
            attemptCount: row.attemptCount + 1,
            nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
            lastError: o.transient,
          })
          .where(eq(notifications.id, row.id));
        result.retried++;
      }
    }
  }

  await closeSchedules(deps.db, now);
  return result;
}

/** 확정된 알림이 모두 처리된 예약 행은 done */
async function closeSchedules(db: Db, now: Date) {
  await db.execute(sql`
    UPDATE notification_schedules s SET status = 'done'
    WHERE s.status = 'materialized' AND s.scheduled_at <= ${ts(now)}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.payload->>'scheduleId' = s.id::text AND n.status = 'scheduled'
      )
  `);
}

/** 워커 1회 실행: 대상 확정(대회 예약·공지) → 발송 */
export async function runTick(deps: DeliveryDeps) {
  const materialized = await materializeDue(deps);
  const notices = await materializeNotices(deps.db, deps.clock());
  const sent = await sendDue(deps);
  return { materialized, notices, sent };
}
