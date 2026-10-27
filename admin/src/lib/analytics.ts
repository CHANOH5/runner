/**
 * 관리자 웹 분석 (PostHog, D-017 · P-PRI-08). 앱(`app/src/lib/analytics.ts`)과 같은 규칙:
 * - 식별은 내부 관리자 id만. 이메일·이름·좌표·주소는 보내지 않는다 (허용 속성만 정의 + 보내기 직전 거름망)
 * - `NEXT_PUBLIC_POSTHOG_KEY`·`NEXT_PUBLIC_POSTHOG_HOST`가 없으면 no-op (개발·테스트 기본값)
 * 이벤트 목록: docs/tech/07-analytics.md
 */

export type AdminAnalyticsEvents = {
  admin_logged_in: { role: string };
  admin_notice_saved: {
    notice_id: string;
    kind: string;
    send_push: boolean;
    scheduled: boolean;
    is_edit: boolean;
  };
  admin_notice_approved: {
    notice_id: string;
    kind: string;
    recipients: number;
    scheduled: boolean;
  };
  admin_notice_withdrawn: { notice_id: string; status: string };
  admin_notice_test_sent: { notice_id: string };
  admin_reports_resolved: { count: number; action: string };
};
export type AdminAnalyticsEvent = keyof AdminAnalyticsEvents;

type Value = string | number | boolean | null;

const FORBIDDEN_ANYWHERE = /(e_?mail|nick_?name|password|totp|token)/i;
const FORBIDDEN_WORDS = new Set([
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coord',
  'coords',
  'location',
  'address',
  'venue',
  'phone',
  'name',
]);
const words = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const COORD_VALUE = /-?\d{1,3}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/;

export function sanitizeProps(props: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_ANYWHERE.test(k) || words(k).some((w) => FORBIDDEN_WORDS.has(w))) continue;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      continue;
    }
    if (typeof v === 'string' && (EMAIL_VALUE.test(v) || COORD_VALUE.test(v))) continue;
    out[k] = v;
  }
  return out;
}

export function createAdminAnalytics(cfg: {
  apiKey: string | undefined;
  host: string | undefined;
  fetch: typeof fetch;
}) {
  let adminId: string | null = null;
  const enabled = !!cfg.apiKey && !!cfg.host;
  return {
    enabled,
    track<E extends AdminAnalyticsEvent>(event: E, props: AdminAnalyticsEvents[E]) {
      // 로그인 전(관리자 id 없음)에는 보내지 않는다
      if (!enabled || !adminId) return;
      void cfg
        .fetch(`${cfg.host!.replace(/\/$/, '')}/capture/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            api_key: cfg.apiKey,
            event,
            distinct_id: `admin:${adminId}`,
            timestamp: new Date().toISOString(),
            properties: { ...sanitizeProps(props), $lib: 'berun-admin' },
          }),
        })
        .catch(() => undefined);
    },
    identify(id: string) {
      adminId = id;
    },
    reset() {
      adminId = null;
    },
  };
}

/** 실제 키는 커밋하지 않는다 (admin/.env.local) */
export const adminAnalytics = createAdminAnalytics({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  fetch: (input, init) => fetch(input, init),
});
