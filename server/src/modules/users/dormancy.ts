import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { devices, notifications, userProfiles, users } from '../../db/schema/index.js';
import { kstDate } from '../../lib/time.js';
import type { PushClient } from '../notifications/push.js';
import { maskId } from '../auth/unlink-worker.js';

/**
 * 휴면 처리 배치 (P-RET-03, T-023). 매일 10:00 KST.
 * - 마지막 접속(last_login_at, 없으면 가입 시각)부터 1년이 되기 30일 전에 안내한다 (한 번만)
 * - 1년이 지났고 안내한 지 30일이 지났으면 `dormant`로 바꾼다 — 안내 없이 휴면으로 만들지 않는다
 *   (배치가 처음 돌거나 멈췄다 돌아 안내가 늦으면 휴면도 그만큼 늦어진다)
 * - 접속(소셜 로그인·토큰 회전)하면 last_login_at이 갱신되고 안내 기록이 지워진다
 * - 휴면 중 알림 제외(N-06 예외)는 알림 대상 쿼리(audience.ts)가 이미 한다. 해제는 로그인 시 (reactivated)
 * 분리 보관 등 법정 요건은 [확인 필요] — 지금은 상태 전환과 안내만 한다.
 */
export const DORMANCY_AFTER_MS = 365 * 24 * 60 * 60 * 1000;
export const DORMANCY_NOTICE_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;

export type DormancyNotice = {
  userId: string;
  nickname: string | null;
  email: string | null;
  /** 휴면 예정일 (KST 날짜) */
  dormantOn: string;
};

/** 안내 채널. 결과: sent 보냄 / skipped 보낼 수단 없음(토큰·주소 없음, 채널 미구현) / failed */
export type DormancyNoticeChannel = {
  name: string;
  send(notice: DormancyNotice): Promise<'sent' | 'skipped' | 'failed'>;
};

export type DormancyLogger = { info: (obj: object, msg: string) => void };

export type DormancyDeps = {
  db: Db;
  channels: DormancyNoticeChannel[];
  clock: () => Date;
  log: DormancyLogger;
};

/** 안내 문구 [미정 — 기획 확인 필요]. 제목 30자·본문 60자 안 */
export function dormancyNoticeText(dormantOn: string) {
  const [, m, d] = dormantOn.split('-').map(Number);
  return {
    title: '휴면 계정 전환 안내',
    body: `${m}월 ${d}일에 휴면 계정으로 바뀌어요. 그 전에 앱을 열면 계속 쓸 수 있어요.`,
    deepLink: 'berun://notifications',
  };
}

/**
 * 앱 푸시 채널 (P-RET-03 "앱 푸시"): 앱 내 알림 행을 남기고 그 사용자의 기기로 바로 보낸다.
 * 알림 설정과 무관하게 보낸다 (휴면 전환 고지). 무효 토큰은 지운다.
 */
export function pushDormancyChannel(
  db: Db,
  push: PushClient,
  clock: () => Date,
): DormancyNoticeChannel {
  return {
    name: 'push',
    async send(notice) {
      const text = dormancyNoticeText(notice.dormantOn);
      const now = clock();
      const [row] = await db
        .insert(notifications)
        .values({
          userId: notice.userId,
          kind: 'dormancy_notice',
          scheduledAt: now,
          status: 'sent',
          payload: text,
        })
        .returning({ id: notifications.id });
      const tokens = (
        await db
          .select({ token: devices.pushToken })
          .from(devices)
          .where(and(eq(devices.userId, notice.userId), isNotNull(devices.pushToken)))
      ).map((d) => d.token!);
      if (tokens.length === 0) {
        await db
          .update(notifications)
          .set({ lastError: 'no_device' })
          .where(eq(notifications.id, row!.id));
        return 'skipped';
      }
      try {
        const tickets = await push.send(
          tokens.map((to) => ({
            to,
            title: text.title,
            body: text.body,
            data: { notificationIds: [row!.id], deepLink: text.deepLink },
            sound: 'default' as const,
            priority: 'high' as const,
          })),
        );
        const dead = tokens.filter(
          (_, i) =>
            tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered',
        );
        if (dead.length)
          await db.update(devices).set({ pushToken: null }).where(inArray(devices.pushToken, dead));
        const ok = tickets.some((t) => t.status === 'ok');
        await db
          .update(notifications)
          .set(ok ? { sentAt: clock() } : { status: 'failed', lastError: 'push_failed' })
          .where(eq(notifications.id, row!.id));
        return ok ? 'sent' : 'failed';
      } catch {
        await db
          .update(notifications)
          .set({ status: 'failed', lastError: 'push_error' })
          .where(eq(notifications.id, row!.id));
        return 'failed';
      }
    },
  };
}

/**
 * 이메일 채널 자리 (P-RET-03 "가능하면 이메일도"). 발송 수단(서비스·발신 주소)이 아직 없어
 * 보내지 않고 skipped로 처리한다 — 채널 결정은 handoff (T-023).
 */
export function fakeEmailDormancyChannel(log: DormancyLogger): DormancyNoticeChannel {
  return {
    name: 'email',
    send(notice) {
      if (!notice.email) return Promise.resolve('skipped');
      log.info(
        { user: maskId(notice.userId), dormantOn: notice.dormantOn },
        'dormancy email not sent (no email channel yet)',
      );
      return Promise.resolve('skipped');
    },
  };
}

const lastActive = sql`coalesce(${users.lastLoginAt}, ${users.createdAt})`;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export type DormancyResult = {
  noticed: number;
  dormant: number;
  channels: Record<string, Record<'sent' | 'skipped' | 'failed', number>>;
};

export async function runDormancyBatch(deps: DormancyDeps): Promise<DormancyResult> {
  const now = deps.clock();
  const result: DormancyResult = { noticed: 0, dormant: 0, channels: {} };

  // 1) 휴면 전환: 1년 미접속 + 안내한 지 30일 이상
  const turned = await deps.db
    .update(users)
    .set({ status: 'dormant' })
    .where(
      and(
        eq(users.status, 'active'),
        sql`${lastActive} <= ${ts(new Date(now.getTime() - DORMANCY_AFTER_MS))}`,
        isNotNull(users.dormancyNotifiedAt),
        lte(users.dormancyNotifiedAt, new Date(now.getTime() - DORMANCY_NOTICE_BEFORE_MS)),
      ),
    )
    .returning({ id: users.id });
  result.dormant = turned.length;

  // 2) 30일 전 안내: 1년 - 30일 미접속 + 아직 안내 안 함
  const due = await deps.db
    .select({
      id: users.id,
      email: users.email,
      nickname: userProfiles.nickname,
      lastActive: sql<string>`${lastActive}`,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(
      and(
        eq(users.status, 'active'),
        isNull(users.dormancyNotifiedAt),
        sql`${lastActive} <= ${ts(new Date(now.getTime() - DORMANCY_AFTER_MS + DORMANCY_NOTICE_BEFORE_MS))}`,
      ),
    )
    .limit(BATCH_LIMIT);

  for (const u of due) {
    // 안내가 늦었으면(배치 첫 실행 등) 휴면은 안내 후 30일 뒤로 미룬다
    const byActivity = new Date(u.lastActive).getTime() + DORMANCY_AFTER_MS;
    const dormantAt = Math.max(byActivity, now.getTime() + DORMANCY_NOTICE_BEFORE_MS);
    const notice: DormancyNotice = {
      userId: u.id,
      nickname: u.nickname,
      email: u.email,
      dormantOn: kstDate(new Date(dormantAt)),
    };
    for (const ch of deps.channels) {
      const outcome = await ch.send(notice);
      const c = (result.channels[ch.name] ??= { sent: 0, skipped: 0, failed: 0 });
      c[outcome]++;
    }
    await deps.db.update(users).set({ dormancyNotifiedAt: now }).where(eq(users.id, u.id));
    result.noticed++;
  }
  deps.log.info({ ...result }, 'dormancy batch');
  return result;
}
