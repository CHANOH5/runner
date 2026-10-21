import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

/**
 * 푸시 발송 클라이언트 (Expo Push, tech/02). 워커는 이 인터페이스만 쓴다 — 테스트는 가짜를 넣는다.
 * Expo 한도: 요청당 100건, 프로젝트당 초당 600건 (tech/03 7장).
 */
export const EXPO_BATCH_SIZE = 100;

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  /** 앱이 탭 시 이동·읽음 처리에 쓴다 (tech/06 6.12) */
  data: { notificationIds: string[]; deepLink: string };
  sound: 'default';
  priority: 'high';
};

export type PushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } | undefined };

export type PushClient = {
  /** 메시지 순서대로 티켓을 돌려준다. 전송 자체가 실패하면 PushTransportError */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
};

export class PushTransportError extends Error {
  override name = 'PushTransportError';
}

const ExpoResponse = z.object({
  data: z.array(
    z.union([
      z.object({ status: z.literal('ok'), id: z.string() }),
      z.object({
        status: z.literal('error'),
        message: z.string(),
        details: z.object({ error: z.string().optional() }).optional(),
      }),
    ]),
  ),
});

/** 실제 Expo Push 전송. accessToken은 Expo "enhanced security"를 켰을 때만 필요 */
export function expoPushClient(opts: {
  accessToken?: string | undefined;
  timeoutMs?: number;
}): PushClient {
  return {
    async send(messages) {
      let res: Response;
      try {
        res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(opts.accessToken && { authorization: `Bearer ${opts.accessToken}` }),
          },
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch (err) {
        throw new PushTransportError(`expo request failed: ${(err as Error).message}`);
      }
      if (!res.ok) throw new PushTransportError(`expo responded ${res.status}`);
      const parsed = ExpoResponse.safeParse(await res.json());
      if (!parsed.success || parsed.data.data.length !== messages.length) {
        throw new PushTransportError('unexpected expo response');
      }
      return parsed.data.data;
    },
  };
}

/** 실제로 보내지 않고 로그만 남긴다 (로컬·개발 기본값, PUSH_DRY_RUN) */
export function dryRunPushClient(log: Pick<FastifyBaseLogger, 'info'>): PushClient {
  let n = 0;
  return {
    send(messages) {
      log.info({ count: messages.length }, 'push dry-run');
      return Promise.resolve(messages.map(() => ({ status: 'ok' as const, id: `dry-run-${++n}` })));
    },
  };
}

/** 토큰 버킷. 워커가 여러 개면 프로젝트 한도(600/초)를 워커 수로 나눠 설정한다 */
export function createRateLimiter(
  ratePerSec: number,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
) {
  let tokens = ratePerSec;
  let last = clock.now();
  return {
    async acquire(n: number) {
      for (;;) {
        const t = clock.now();
        tokens = Math.min(ratePerSec, tokens + ((t - last) / 1000) * ratePerSec);
        last = t;
        if (tokens >= n) {
          tokens -= n;
          return;
        }
        await clock.sleep(Math.ceil(((n - tokens) / ratePerSec) * 1000));
      }
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
