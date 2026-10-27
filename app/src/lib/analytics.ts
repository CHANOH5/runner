import type { DistanceCategory, EntryStatus, EntryStatusSource } from '@berun/shared';

/**
 * 제품 분석 (PostHog, D-017 · PRD 2.3 · P-PRI-08)
 * - 사용자 식별은 내부 user_id만. **이메일·닉네임·좌표(주소 포함)는 보내지 않는다** — 이벤트별 허용 속성만 정의하고,
 *   보내기 직전에 금지 키·이메일·좌표처럼 보이는 값을 한 번 더 걸러낸다 (`sanitizeProps`).
 * - 키(`EXPO_PUBLIC_POSTHOG_KEY`)가 없으면 아무것도 보내지 않는다 (no-op). 개발·테스트 기본값.
 * - 전송은 PostHog capture HTTP API(`POST {host}/capture/`)를 직접 쓴다 — SDK 없이 웹 미리보기에서도 같은 코드.
 * 이벤트 목록: docs/tech/07-analytics.md
 */

type Source<T extends string> = T;
/** PRD 2.3 이벤트와 속성 (snake_case 그대로) */
export type AnalyticsEvents = {
  login_started: { provider: 'kakao' | 'apple' | 'google'; dev: boolean };
  signup_completed: {
    provider: 'kakao' | 'apple' | 'google';
    region_code: string;
    has_gender: boolean;
    duration_sec: number | null;
  };
  signup_blocked_underage: Record<string, never>;
  notification_permission_result: {
    granted: boolean;
    source: Source<'onboarding' | 'first_interest'>;
  };
  record_saved: {
    distance_category: DistanceCategory;
    kind: 'race' | 'training';
    is_edit: boolean;
    source: Source<'onboarding' | 'records'>;
  };
  race_list_viewed: { view: 'list' | 'calendar'; filter_count: number };
  race_searched: { query_length: number; result_count: number };
  race_viewed: { race_id: string; registration_status: string; source: string };
  interest_toggled: { race_id: string; on: boolean; source: string };
  registration_saved: {
    race_id: string;
    race_event_id: string;
    has_goal: boolean;
    goal_source: 'prediction' | 'manual' | 'none';
    is_edit: boolean;
    entry_status: EntryStatus;
    source: Source<'race_detail' | 'return_prompt'>;
  };
  registration_cancelled: { race_id: string };
  entry_status_changed: {
    race_id: string;
    from: EntryStatus;
    to: EntryStatus;
    source: EntryStatusSource;
  };
  entry_prompt_shown: { race_id: string; has_registration: boolean };
  entry_prompt_answered: { race_id: string; answer: 'registered' | 'not_yet' | 'dismissed' };
  external_link_opened: {
    race_id: string;
    link_type: 'official' | 'registration';
    registration_state: string;
  };
  prediction_viewed: {
    target_distance_m: number;
    confidence: string;
    record_count: number;
    source: string;
  };
  strategy_tab_changed: { strategy: 'even' | 'negative' };
  notification_opened: { kind: string; race_id: string | null };
  race_report_submitted: { race_id: string; field: string };
  directions_opened: { race_id: string; app: 'naver' | 'kakao' | 'apple' | 'google' | 'web' };
  account_deleted: { reason_code: string | null };
};
export type AnalyticsEvent = keyof AnalyticsEvents;

type Value = string | number | boolean | null;

/** 절대 보내지 않는 키 (P-PRI-08, D-017): 이메일·닉네임은 키 어디에 있어도, 좌표·주소·이름은 단어 단위로 */
const FORBIDDEN_ANYWHERE = /(e_?mail|nick_?name)/i;
const FORBIDDEN_WORDS = new Set([
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coord',
  'coords',
  'coordinate',
  'coordinates',
  'location',
  'address',
  'venue',
  'phone',
  'name',
]);
/** userName·venue_lat·homeAddress → ['user','name'] 등 단어로 나눈다 */
const words = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const isForbiddenKey = (key: string) =>
  FORBIDDEN_ANYWHERE.test(key) || words(key).some((w) => FORBIDDEN_WORDS.has(w));
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** "37.5665,126.9780"·"37.52 126.93" 같은 좌표 문자열 */
const COORD_VALUE = /-?\d{1,3}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/;

/**
 * 보내기 직전 거름망. 허용 타입(문자열·숫자·불리언·null)만, 금지 키·이메일·좌표 같은 값은 뺀다.
 * 타입으로도 막지만(이벤트별 속성 정의), 실수로 객체째 넘겨도 새지 않게 한 번 더.
 */
export function sanitizeProps(props: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(props)) {
    if (isForbiddenKey(k)) continue;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      continue;
    }
    if (typeof v === 'string' && (EMAIL_VALUE.test(v) || COORD_VALUE.test(v))) continue;
    out[k] = v;
  }
  return out;
}

export type AnalyticsConfig = {
  /** 없으면 no-op */
  apiKey: string | undefined;
  host: string | undefined;
  fetch: typeof fetch;
  /** 모든 이벤트에 붙는 공통 속성 (앱 버전·플랫폼) */
  context: () => Record<string, Value>;
  /** 로그인 전 익명 id */
  anonymousId: () => string;
  now?: () => Date;
};

export function createAnalytics(cfg: AnalyticsConfig) {
  let userId: string | null = null;
  const enabled = !!cfg.apiKey && !!cfg.host;
  const now = cfg.now ?? (() => new Date());

  function send(event: string, props: Record<string, unknown>) {
    if (!enabled) return;
    const body = {
      api_key: cfg.apiKey,
      event,
      distinct_id: userId ?? cfg.anonymousId(),
      timestamp: now().toISOString(),
      properties: { ...sanitizeProps({ ...cfg.context(), ...props }), $lib: 'berun-app' },
    };
    // 분석 실패는 앱 동작에 영향을 주지 않는다
    void cfg
      .fetch(`${cfg.host!.replace(/\/$/, '')}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      .catch(() => undefined);
  }

  return {
    enabled,
    track<E extends AnalyticsEvent>(event: E, props: AnalyticsEvents[E]) {
      send(event, props);
    },
    /** 로그인·가입 후: 내부 user_id만 (D-017) */
    identify(id: string) {
      userId = id;
    },
    /** 로그아웃·탈퇴 */
    reset() {
      userId = null;
    },
    get userId() {
      return userId;
    },
  };
}

/** access token(JWT)의 sub = 내부 user_id. 서명 검증은 서버 몫이고 여기서는 식별용으로만 읽는다 */
export function userIdFromAccessToken(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(
      globalThis.atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')),
    ) as {
      sub?: unknown;
    };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}
