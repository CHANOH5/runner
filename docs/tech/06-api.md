# 06. API 명세 — Phase 1 (T-011)

- 담당: 개발자
- 상태: v1.3 (PRD v1.5 홈 접수 임박 대상 반영)
- 기준: `../planning/05-prd-phase1.md` v1.5, `04-db-schema.md`, `03-architecture.md`
- 관련 결정: D-005~D-008, D-010, D-013, D-014, D-016~D-018

> 표기
> - `[미정]`, `[확인 필요]`는 공통 규칙과 같다.
> - 스키마는 **Zod** 기준으로 쓴다. 실제 코드는 앱·서버가 함께 쓰는 `packages/shared`(`@berun/shared`)에 둔다 (tech/02, PRD 3.5). 여기 적은 Zod는 명세용 의사 코드다.

---

## 목차
1. 공통 규약
2. 인증
3. 에러
4. 페이지네이션
5. 공통 스키마
6. 앱 API (엔드포인트)
7. 관리자 API
8. 요청 제한 (rate limit)
9. 서버가 강제하는 정책 매핑
10. 앱 화면 ↔ API 매핑
11. PRD 반영 이력

---

## 1. 공통 규약

| 항목 | 규칙 |
|---|---|
| 기본 URL | 앱: `https://api.berun.app/v1` / 관리자: `https://admin.berun.app/api/admin/v1` (도메인 `[미정]`, PRD Q-12) |
| 형식 | JSON (UTF-8). 필드명 **camelCase**. 요청 본문 최대 64KB |
| ID | UUID v7 문자열 |
| 시각 | ISO 8601, **KST 오프셋 포함** `2026-11-01T10:00:00+09:00`. 서버는 어떤 오프셋이든 받고, 응답은 항상 `+09:00` |
| 날짜 | `YYYY-MM-DD` (KST 날짜). "오늘"은 서버의 KST 날짜 (PRD 3.1) |
| 기간 값 | 기록·목표는 **정수 초**(`…Sec`), 거리는 **정수 m**(`…M`), 페이스는 **초/km 정수**(`…SecPerKm`) |
| 금액 | 원 단위 정수 (`feeKrw`) |
| null | "값 없음"은 필드를 빼지 않고 `null`로 보낸다. 앱은 PRD 4.7 규칙대로 "미정"·행 숨김을 처리한다 |
| 문자열 검증 | 앞뒤 공백 제거 후 **코드포인트 단위** 길이 검사 (PRD 3.5). 서버가 같은 Zod 스키마로 다시 검증 |
| 공통 요청 헤더 | `Authorization: Bearer {accessToken}` (인증 API 제외) · `X-App-Version: 1.0.3` · `X-Platform: ios\|android` · `X-Device-Id: {uuid}` (앱 설치 시 생성해 보관) |
| 멱등 키 | 생성형 POST(기록 추가, 참가 예정 추가, 제보, 예측)는 `Idempotency-Key: {uuid}` 권장. 같은 키로 24시간 안에 다시 오면 처음 응답을 그대로 돌려준다 (중복 탭·재시도 대응, PRD 3.4) |
| 캐시 | 대회 목록·상세 공개 데이터: `Cache-Control: private, max-age=60` + `ETag`. 개인 데이터: `no-store`. **(T-018) Phase 1은 대회 목록·상세도 `no-store`** — 로그인 필수라 응답에 사용자별 `my`(관심·참가 예정)가 들어 있어, 추가·해제 직후 기기 HTTP 캐시가 오래된 값을 돌려줄 수 있다. 비로그인 둘러보기를 열 때 `my`를 뺀 공개 응답에 다시 적용한다 |
| 버전 | URL 경로 `/v1`. 깨지는 변경은 `/v2`. 필드 추가는 깨지지 않는 변경으로 본다 (앱은 모르는 필드를 무시) |
| 시간대 | 요청에 시간대를 받지 않는다. 모든 계산은 Asia/Seoul |
| 이름 규칙 (D-019) | 화면 용어 **참가 예정** = 내부 이름 `registration` (`/registrations`, `registrationId`, DB `race_registrations`). 사용자가 기록하는 **실제 대회 접수 여부** = `entryStatus` (`entry_status`). `races`의 `registrationOpensAt`·`registrationState` 등은 **공식 접수 기간·상태**다. 내부 이름은 바꾸지 않는다 — 근거: ① 화면에 노출되지 않는 계약 이름이고 ② 이미 구현된 예측 API·공유 스키마(`target.type = 'registration'`, `raceRegistrationId`)·테스트·시드가 쓰고 있어 바꾸면 마이그레이션과 API 호환 비용만 생기며 ③ PRD 4.10이 내부 이름 유지를 허용한다. 대신 **새로 만드는 이름에는 `registered`를 '참가 예정' 뜻으로 쓰지 않는다** (`entryStatus = 'registered'`와 헷갈림 → 에러 코드 `ALREADY_PLANNED`) |

## 2. 인증

### 2.1 토큰
| 토큰 | 형식 | 수명 | 보관 |
|---|---|---|---|
| access token | JWT (ES256). claims: `sub`(userId), `sid`(auth_sessions.id), `iat`, `exp` | 15분 | 앱 메모리 |
| refresh token | 32바이트 랜덤 (base64url). DB에는 SHA-256 해시만 (`auth_sessions.token_hash`) | 30일, 사용할 때마다 **회전** | 앱 SecureStore |
| signup token | 32바이트 랜덤. 서버 Redis `signup:{hash}`에 provider·uid·email·(Apple refresh token 암호문) | 30분 | 앱 메모리 |

- **회전과 재사용 감지**: `/auth/refresh`는 새 refresh token을 주고 이전 것을 `rotated_at`으로 표시한다. 이미 회전된 토큰이 다시 오면 탈취로 보고 **같은 `family_id` 전체를 폐기**하고 401 `REFRESH_REUSED`.
- 기기당 세션 1개: 같은 `X-Device-Id`로 다시 로그인하면 그 기기의 이전 세션을 폐기한다.
- access token 검증 시 `users.status`를 매 요청 확인하지 않는다 (15분 지연 허용). 단 `suspended` 처리 시 해당 사용자 세션을 모두 폐기한다.

### 2.2 약관 재동의 게이트
- 필수 약관 새 버전이 시행되면, 재동의 전까지 대부분의 API가 **403 `TERMS_REQUIRED`** 를 돌려준다 (`details.kinds: ["service"]`).
- 예외(게이트 통과): `/app-config`, `/auth/*`, `GET /terms/current`, `POST /me/consents`, `GET /me`, `DELETE /me`, `GET /me/consents`.
- 앱은 S-001에서 `GET /me`의 `pendingTerms`로 먼저 판단하고(PRD 6.1), 그 밖에서 403을 받으면 재동의 화면을 띄운다.

### 2.3 관리자 인증
- 별도 체계: 이메일 + 비밀번호 + TOTP → **httpOnly·Secure·SameSite=Strict 세션 쿠키** (서버 세션, Redis). 세션 8시간, 30분 무활동 시 만료 (PRD 8.2).
- 비밀번호 5회 실패 시 15분 잠금 (`admin_users.locked_until`). 접속 IP 허용 목록은 ALB/WAF에서 강제 (tech/03).
- 상태 변경 요청은 CSRF 토큰 헤더 `X-CSRF-Token` 필수.
- 모든 쓰기 요청은 `admin_audit_logs`에 자동 기록 (미들웨어).

## 3. 에러

### 3.1 형식
```ts
const ApiError = z.object({
  error: z.object({
    code: z.string(),                 // 아래 표의 코드 (앱은 code로 분기, message는 표시하지 않는다)
    message: z.string(),              // 개발자용 영문 설명
    details: z.record(z.unknown()).optional(),
    fieldErrors: z.array(z.object({   // 400 VALIDATION_FAILED일 때만
      path: z.string(),               // "goalTimeSec", "events[2].distanceM"
      code: z.string(),               // required | too_short | too_long | too_few | too_many | out_of_range | invalid_format | invalid_value | invalid_type | unknown_field | (API별) not_found · not_eligible · missing_required(가입 필수 약관) · pace_out_of_range(기록 페이스) · not_allowed(goalSource none인데 goalTimeSec)
    })).optional(),
  }),
  requestId: z.string(),              // 로그 추적용 (응답 헤더 X-Request-Id와 같음)
});
```
- 사용자에게 보이는 문구는 **앱이 code별로 가진다** (PRD 문구). 서버 message는 노출하지 않는다.

### 3.2 코드
| HTTP | code | 언제 | 앱 처리 (PRD) |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Zod 검증 실패. 잘못된 JSON·본문 64KB 초과 등 Fastify 요청 오류도 이 코드 (`details.reason`) | 입력란 아래 메시지 (3.5) |
| 401 | `UNAUTHENTICATED` | 토큰 없음·만료·위조 | refresh 1회 → 실패 시 S-002 (3.4) |
| 401 | `REFRESH_INVALID` / `REFRESH_REUSED` | refresh 실패 | S-002 "다시 로그인해주세요" |
| 401 | `SIGNUP_TOKEN_EXPIRED` | 가입 토큰 30분 경과 | S-002 "시간이 지나 처음부터…" (4.1) |
| 401 | `SOCIAL_TOKEN_INVALID` | provider 검증 실패 | "로그인하지 못했어요…" |
| 403 | `ACCOUNT_SUSPENDED` | 정지 계정 로그인 | 안내 화면 (4.1) |
| 403 | `TERMS_REQUIRED` | 필수 약관 재동의 필요 | 재동의 화면 (4.2) |
| 403 | `FORBIDDEN` | 남의 리소스 접근 | 404처럼 처리 |
| 404 | `NOT_FOUND` | 없음, 또는 초안 대회 | "삭제되었거나 찾을 수 없는…" |
| 410 | `NOTICE_WITHDRAWN` | 내린 공지 (`notices.status = withdrawn`) | "내려간 공지예요" (8.6) |
| 410 | `RACE_UNAVAILABLE` | 숨김(`hidden`) 대회 | "더 이상 볼 수 없는 대회예요" (8.4.2) |
| 409 | `ALREADY_PLANNED` | 같은 대회에 참가 예정 두 번째 추가 (v1.1까지 `ALREADY_REGISTERED`) | 수정 모드로 (4.10) |
| 409 | `RACE_CANCELLED` | 취소 대회에 참가 예정 추가 | 버튼 비활성 상태 동기화 |
| 409 | `RACE_FINISHED` | 지난 대회에 참가 예정 추가·수정(접수 상태 포함)·해제 | 〃 |
| 409 | `DUPLICATE_RECORD` | 같은 날짜·거리·기록 (확인 없이) | "같은 기록이 이미 있어요…" → `confirmDuplicate: true`로 재요청 (4.4) |
| 409 | `NICKNAME_TAKEN` | 닉네임 선점 | "이미 사용 중이에요" (4.3) |
| 409 | `CONFLICT_STALE` | 관리자 동시 수정 (`If-Match` 불일치) | "다른 곳에서 수정됐어요. 새로고침" |
| 409 | `RACE_IN_USE` | (T-020) 관심·참가 예정이 있는 대회의 게시 취소·삭제 (`details.interestCount`, `registrationCount`) | 관리자 웹: "취소 상태로 바꿔주세요" (PRD 8.4) |
| 422 | `NICKNAME_FORBIDDEN` | 금칙어·예약어 | "사용할 수 없는 닉네임이에요" |
| 422 | `NICKNAME_CHANGE_COOLDOWN` | 7일 이내 재변경 (`details.availableAt`) | "{M월 D일}부터 바꿀 수 있어요" |
| 422 | `UNDERAGE` | 만 14세 미만 | 가입 중단 화면 (서버는 가입 세션 폐기 + 소셜 연결 해제) |
| 422 | `LIMIT_EXCEEDED` | 개수 한도 (`details.limit`, `details.resource`: `records`·`interests`·`registrations`·`prediction_records`) | 각 한도 문구 (4.4, 4.8, 4.10, 4.12) |
| 422 | `TARGET_DISTANCE_UNSUPPORTED` | 예측 대상 거리가 3,000m 미만 또는 42,195m 초과 (`registration`·`race_event` 대상) | 예측 추천 숨김, 직접 입력·목표 없음만 (4.10, 4.12) |
| 422 | `NO_ELIGIBLE_RECORDS` | 예측 가능한 기록 0개 (`details.reason`: `none`·`all_older_than_365d`) | S-032 빈 상태 (4.12) |
| 422 | `GOAL_OUT_OF_RANGE` | 목표 페이스 2'50"~15'00"/km 밖 | "목표 기록을 다시 확인해주세요" |
| 422 | `PUBLISH_REQUIREMENTS_UNMET` | 관리자 게시 조건 미충족 (`details.missing: string[]`) | 미충족 목록 (8.4.1) |
| 429 | `RATE_LIMITED` | 요청 제한 (`Retry-After` 헤더) | 일반 토스트 |
| 429 | `REPORT_LIMIT_DAILY` | 제보 같은 대회 3건/일, 전체 10건/일 | "오늘은 더 제보할 수 없어요…" (4.11) |
| 426 | `UPGRADE_REQUIRED` | `X-App-Version` < 최소 버전 | 강제 업데이트 화면 (6.1) |
| 500 | `INTERNAL` | 서버 오류 | "잠시 문제가 생겼어요" |
| 503 | `MAINTENANCE` | 점검 | 〃 (`details.until`) |

- 참가 예정의 목표 기록이 제한 시간을 넘는 것은 **에러가 아니다** — 저장하고 응답에 `warnings: ["GOAL_OVER_TIME_LIMIT"]`를 넣는다 (4.10).

## 4. 페이지네이션

- **커서 방식**. 요청 `?cursor={opaque}&limit={n}` (기본 20, 최대 50). 응답:
```ts
const Page = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item),
  nextCursor: z.string().nullable(),   // null이면 끝
});
```
- 커서는 서버가 정렬 키를 base64url로 인코딩한 불투명 문자열. 정렬 키:
  - 대회 목록: `(race_date, name, id)` 오름차순 (PRD 4.5)
  - 내 기록: `(run_date DESC, created_at DESC, id)`
  - 알림: `(created_at DESC, id)`
  - 예측: `(created_at DESC, id)`
  - 관리자 목록: 정렬 필드 + id
- 전체 개수가 필요한 화면(필터 결과 수 "128개 대회 보기")은 별도 `count` 엔드포인트를 쓴다. 목록 응답에는 총개수를 넣지 않는다.
- 관리자 목록은 페이지 번호 방식(`?page=1&pageSize=50`, 응답에 `total`)을 쓴다 — 데이터가 수백 건이고 표 UI에 맞다.

## 5. 공통 스키마

```ts
// ---- 기본 값 ----
const Id = z.string().uuid();
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DateTime = z.string().datetime({ offset: true });
const RegionCode = z.enum([ /* 시·도 17개 코드: 'seoul','busan','daegu','incheon','gwangju','daejeon','ulsan','sejong','gyeonggi','gangwon','chungbuk','chungnam','jeonbuk','jeonnam','gyeongbuk','gyeongnam','jeju' */ ]);
const DistanceCategory = z.enum(['5k', '10k', 'half', 'full', 'other']);   // PRD 3.3
const Provider = z.enum(['kakao', 'apple', 'google']);

// ---- 대회 ----
const RaceStatus = z.enum(['scheduled', 'postponed', 'cancelled', 'finished']);
// 접수 상태: 서버 계산값, 저장하지 않음 (PRD 4.5 표 순서대로 판정, 아래 "유효 접수 기간" 규칙 적용)
const RegistrationState = z.enum([
  'cancelled',        // 취소
  'ended',            // 종료 (대회일 지남 또는 finished)
  'unscheduled',      // 접수 일정 미정
  'upcoming',         // 접수 예정
  'open',             // 접수 중
  'closed',           // 접수 마감
]);
const RegistrationMethod = z.enum(['first_come', 'lottery', 'unknown']);

/* 유효 접수 기간 (PRD 4.5, 7.1) — registrationState, RaceSummary.registrationOpensAt/ClosesAt,
   home/deadlines, notification_schedules가 모두 이 한 함수를 쓴다.
   1) 대회 기간(races.registration_opens_at/closes_at)이 둘 다 비어 있고 종목별 기간이 있으면
      opensAt = 종목 중 가장 이른 오픈, closesAt = 종목 중 가장 늦은 마감 (한쪽만 있는 값도 각각 집계)
   2) closesAt이 없으면 "대회 전날 23:59:59 KST"까지 접수 중으로 본다 (판정용. 응답의 registrationClosesAt은 null 그대로)
   3) 참가 예정자의 N-03(reg_close_d1)은 고른 종목의 마감(종목 값 → 없으면 유효 closesAt)을 쓴다
      → notification_schedules에 race_event_id 행으로 따로 둔다. closesAt이 없으면 N-03은 만들지 않는다 */

const RaceEvent = z.object({
  id: Id,
  name: z.string(),                          // "하프코스"
  category: DistanceCategory,
  distanceM: z.number().int(),
  startAt: DateTime.nullable(),
  timeLimitMin: z.number().int().nullable(),
  feeKrw: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  registrationOpensAt: DateTime.nullable(),  // 종목별 기간이 대회와 다를 때만 값 있음
  registrationClosesAt: DateTime.nullable(),
});

const RaceSummary = z.object({              // 리스트 카드 (PRD 4.5)
  id: Id,
  name: z.string(),
  raceDate: DateStr,
  regionCode: RegionCode,
  categories: z.array(DistanceCategory),     // 분류 순서, 중복 제거
  status: RaceStatus,
  registrationState: RegistrationState,
  registrationOpensAt: DateTime.nullable(),  // 유효 접수 기간(위 규칙 1) 적용값. D-n 표시용
  registrationOpensTimeKnown: z.boolean(),
  registrationClosesAt: DateTime.nullable(),  // 유효 접수 기간 적용값. null이면 앱은 마감 "미정" 표시
  registrationMethod: RegistrationMethod,    // unknown이면 앱이 배지 숨김
  dDay: z.number().int().nullable(),         // 대회일까지 남은 일수 (KST). 지난 대회 null
  my: z.object({                             // 로그인 사용자 기준
    interested: z.boolean(),
    registered: z.boolean(),
  }),
});

const RaceDetail = RaceSummary.extend({     // 상세 (PRD 4.7)
  organizer: z.string().nullable(),
  venue: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    lat: z.number().nullable(),              // 좌표 없으면 null → 앱은 안내 박스 (4.7)
    lng: z.number().nullable(),
  }),
  earliestStartAt: DateTime.nullable(),
  officialUrl: z.string().url().nullable(),
  registrationUrl: z.string().url().nullable(),
  courseUrl: z.string().url().nullable(),
  events: z.array(RaceEvent),                // 분류 순서 → 거리 순
  source: z.object({                         // 대표 출처만 (is_primary). 집계 사이트는 절대 내보내지 않음 (P-RACE-07)
    name: z.string(),                        // "공식 홈페이지" | "주최사 제공"
    url: z.string().url().nullable(),
  }),
  lastVerifiedAt: DateTime,                  // 게시된 대회는 항상 있음 (DB CHECK)
  my: z.object({
    interested: z.boolean(),
    registration: z.lazy(() => RegistrationBrief).nullable(),
  }),
});

const EntryStatus = z.enum(['not_registered', 'registered', 'missed']);   // 접수 전 / 접수 완료 / 접수 못 함 (D-019, PRD 4.10.1)
const EntryStatusSource = z.enum(['form', 'return_prompt', 'race_detail', 'my_races']);

const RegistrationBrief = z.object({          // 참가 예정 요약
  id: Id,
  raceEventId: Id,
  eventName: z.string(),
  eventDistanceM: z.number().int(),
  predictionSupported: z.boolean(),          // 3,000 ≤ 종목 거리 ≤ 42,195. false면 S-032 "예측 미지원 거리" 회색 (PRD 4.12)
  goalTimeSec: z.number().int().nullable(),
  goalPaceSecPerKm: z.number().int().nullable(),
  entryStatus: EntryStatus,
  entryStatusUpdatedAt: DateTime.nullable(),
});

// ---- 기록 ----
const RunRecord = z.object({
  id: Id,
  category: DistanceCategory,
  distanceM: z.number().int(),
  durationSec: z.number().int(),
  paceSecPerKm: z.number().int(),            // 서버 계산 (PRD 3.2)
  runDate: DateStr,
  kind: z.enum(['race', 'training']),
  title: z.string().nullable(),
  usableForPrediction: z.boolean(),          // false면 "예측 미사용" 태그 (4.4)
  createdAt: DateTime,
});

// ---- 예측 ----
const Confidence = z.enum(['high', 'medium', 'low']);
const ConfidenceReason = z.enum([            // PRD 5.4 사유 → 앱이 문구 매핑
  'high', 'single_record', 'distance_gap', 'cv_moderate',
  'short_records', 'stale_records', 'cv_high',
]);
const SplitRow = z.object({
  atM: z.number().int(),                     // 지점 (m). 마지막 행 = 목표 거리
  cumulativeSec: z.number().int(),
  segmentPaceSecPerKm: z.number().int(),
});
const Prediction = z.object({
  id: Id.nullable(),                         // preview는 null (저장 안 함)
  modelVersion: z.literal('riegel-1.06-v1'), // D-010
  targetDistanceM: z.number().int(),
  predictedSec: z.number().int(),
  rangeMinSec: z.number().int(),             // 반올림 규칙 적용된 값 (PRD 5.5)
  rangeMaxSec: z.number().int(),
  rangeDisplayUnit: z.enum(['minute', 'ten_seconds']), // ≥ 21,000m → minute
  avgPaceSecPerKm: z.number().int(),
  confidence: Confidence,
  confidenceReason: ConfidenceReason,
  firstFullSuggestionSec: z.number().int().nullable(), // 첫 풀 보수 목표 (+5%, 분 올림)
  timeLimitWarning: z.boolean(),             // 상한 > 제한 시간
  usedRecords: z.array(z.object({
    recordId: Id, distanceM: z.number().int(), durationSec: z.number().int(),
    runDate: DateStr, convertedSec: z.number().int(),
  })),
  splits: z.object({ even: z.array(SplitRow), negative: z.array(SplitRow) }),
  raceRegistrationId: Id.nullable(),
  race: z.object({ id: Id, name: z.string(), eventName: z.string(), startAt: DateTime.nullable() }).nullable(),
  recordsChangedSince: z.boolean(),          // 예측 후 기록 변경 → "기록이 바뀌었어요 · 다시 예측" (6.14)
  createdAt: DateTime.nullable(),
});

// ---- 알림 ----
const NotificationKind = z.enum([
  'reg_open_d1', 'reg_open_soon', 'reg_close_d1', 'race_d7', 'race_d1',
  'race_cancelled', 'race_postponed', 'race_schedule_changed',
  'report_applied', 'report_rejected', 'notice', 'marketing',
  'dormancy_notice',   // (T-023) 휴면 30일 전 안내 — 앱 내 알림 + 푸시, deepLink berun://notifications
]);
const AppNotification = z.object({
  id: Id,
  kind: NotificationKind,
  title: z.string(),                         // 서버가 PRD 7.2 문구로 렌더링해 저장한 값
  body: z.string(),
  deepLink: z.string(),                      // berun://races/{id} 등 (PRD 7.3)
  createdAt: DateTime,
  readAt: DateTime.nullable(),
});
```

## 6. 앱 API

> 표의 "인증" 열: `없음` = 토큰 불필요 / `사용자` = access token / `가입` = signup token.
> 모든 응답 본문은 `{ data: ... }`가 아니라 **리소스를 그대로** 돌려준다 (목록은 4장의 `Page`).

### 6.1 앱 설정
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /app-config` | 없음 | 강제 업데이트·점검. CDN 캐시 5분 (tech/03 9장) |

```ts
// 응답
z.object({
  minNativeVersion: z.object({ ios: z.string(), android: z.string() }),  // semver
  maintenance: z.object({ active: z.boolean(), until: DateTime.nullable() }),
  supportEmail: z.string().email().nullable(),                           // [미정] Q-12
})
```
- 다른 모든 API도 `X-App-Version` < 최소 버전이면 426 `UPGRADE_REQUIRED` (이중 방어).

### 6.2 인증 · 가입 (F-001, F-002, F-003)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `POST /auth/social` | 없음 | 소셜 토큰 검증 → 기존 회원이면 토큰 발급, 신규면 signup token |
| `GET /terms/current` | 없음 | 현재 시행 약관 목록 (S-003, 재동의 화면) |
| `GET /nicknames/availability` | 가입 또는 사용자 | 닉네임 사용 가능 여부 (500ms 디바운스, 4.3) |
| `POST /auth/signup` | 가입 | 약관 동의 + 프로필 → 계정 생성(한 트랜잭션) → 토큰 발급 |
| `POST /auth/signup/abort` | 가입 | 가입 중단 (만 14세 미만·사용자 취소) → 소셜 연결 해제 + 세션 삭제 |
| `POST /auth/refresh` | 없음 (refresh token) | 토큰 회전 |
| `POST /auth/logout` | 사용자 | 현재 기기 세션 폐기 + 푸시 토큰 해제 (6.21) |

```ts
// POST /auth/social
const SocialLoginReq = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('kakao'),  accessToken: z.string() }),
  z.object({ provider: z.literal('apple'),  identityToken: z.string(), authorizationCode: z.string() }), // iOS만 (D-016)
  z.object({ provider: z.literal('google'), idToken: z.string() }),
]);
const TokenPair = z.object({ accessToken: z.string(), refreshToken: z.string(), accessTokenExpiresAt: DateTime });
const SocialLoginRes = z.discriminatedUnion('result', [
  z.object({ result: z.literal('logged_in'), tokens: TokenPair, pendingTerms: z.array(z.string()), // pendingTerms 있으면 재동의
             reactivated: z.boolean() }),   // 이번 로그인으로 휴면(dormant)이 해제됐으면 true (한 번만) → 재동의 뒤 휴면 해제 안내 (PRD v1.6 4.1)
  z.object({ result: z.literal('signup_required'), signupToken: z.string(), signupTokenExpiresAt: DateTime,
             emailProvided: z.boolean() }),   // 이메일 값 자체는 앱에 돌려주지 않는다
]);
// 에러: 401 SOCIAL_TOKEN_INVALID, 403 ACCOUNT_SUSPENDED
// Apple: authorizationCode를 즉시 refresh token으로 교환해 Redis 가입 세션(또는 기존 auth_identities)에 암호화 저장 (tech/03 8장)

// GET /terms/current
z.array(z.object({
  id: Id, kind: z.enum(['service', 'privacy', 'marketing']), version: z.string(),
  required: z.boolean(), contentUrl: z.string().url(), effectiveAt: DateTime,
}))   // Phase 1은 location·night_push를 내보내지 않는다 (PRD 4.2)

// GET /nicknames/availability?nickname=러너
z.object({ result: z.enum(['available', 'taken', 'forbidden', 'invalid_format']) })

// POST /auth/signup   (헤더 Authorization: Bearer {signupToken})
const SignupReq = z.object({
  agreedTermIds: z.array(Id).min(2),           // 필수 service·privacy 현재 버전 포함 필수. marketing은 선택
  profile: z.object({
    nickname: Nickname,                        // 2~12자, [가-힣A-Za-z0-9_.], 공백 불가
    birthYear: z.number().int().min(1926),     // ≤ 올해
    birthdayPassedThisYear: z.boolean().optional(), // (올해 − 출생연도) = 14일 때만 필수. 저장하지 않음
    regionCode: RegionCode,
    gender: z.enum(['male', 'female']).nullable(),
    runningSince: z.number().int().min(1950).nullable(), // ≥ birthYear + 5
  }),
});
const SignupRes = z.object({ tokens: TokenPair, user: Me, marketingAgreedAt: DateTime.nullable() }); // 날짜 토스트 (4.2)
// 에러: 401 SIGNUP_TOKEN_EXPIRED, 409 NICKNAME_TAKEN, 422 NICKNAME_FORBIDDEN, 422 UNDERAGE, 400 VALIDATION_FAILED(필수 약관 누락 포함)
// 422 UNDERAGE면 서버가 abort와 같은 처리(소셜 연결 해제, 세션 삭제)를 한 뒤 응답한다. 앱은 24시간 차단 플래그만 기기에 둔다.

// 응답 201. (T-018) 같은 소셜 계정의 가입이 먼저 끝났으면 401 SIGNUP_TOKEN_EXPIRED (처음부터 로그인)
// POST /auth/signup/abort   → 204 (가입 토큰이 이미 만료돼도 204 — 멱등)
// POST /auth/refresh
z.object({ refreshToken: z.string() })  →  TokenPair
// 에러: 401 REFRESH_INVALID | REFRESH_REUSED, 403 ACCOUNT_SUSPENDED
// (T-023) 회전 성공 = 접속으로 기록(users.last_login_at, 휴면 안내 초기화). 휴면(dormant) 계정의 refresh는 401 REFRESH_INVALID → 앱은 S-002 소셜 로그인 → reactivated
// POST /auth/logout  → 204 (본문 없음)
```

### 6.3 내 정보 · 프로필 · 동의 · 기기 (F-003, F-002, F-071, F-072)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /me` | 사용자 | 프로필 + 재동의 필요 약관 + 마이 숫자 카드 |
| `PATCH /me/profile` | 사용자 | 닉네임(7일 제한)·지역·성별·러닝 시작 연도. 출생연도 불가 |
| `GET /me/consents` | 사용자 | S-065 동의 상태 |
| `POST /me/consents` | 사용자 | 재동의(필수 약관 새 버전) |
| `GET /me/notification-settings` | 사용자 | S-064 |
| `PATCH /me/notification-settings` | 사용자 | 토글 변경. 마케팅은 동의 행 추가 |
| `PUT /me/device` | 사용자 | 현재 기기 푸시 토큰·버전 등록/갱신 (앱 시작·토큰 변경 시) |
| `DELETE /me` | 사용자 | 회원 탈퇴 |

```ts
const Nickname = z.string().trim().min(2).max(12).regex(/^[가-힣A-Za-z0-9_.]+$/);

const Me = z.object({
  id: Id,
  nickname: z.string(),
  nicknameChangeAvailableAt: DateTime.nullable(),   // null이면 지금 변경 가능
  birthYear: z.number().int(),                       // 읽기 전용
  regionCode: RegionCode,
  gender: z.enum(['male', 'female']).nullable(),
  runningSince: z.number().int().nullable(),
  provider: Provider,
  pendingTerms: z.array(z.object({ id: Id, kind: z.string(), version: z.string(), contentUrl: z.string().url(), summary: z.string().nullable() })),
  counts: z.object({ interested: z.number().int(), upcoming: z.number().int(), past: z.number().int() }), // S-060
});

// PATCH /me/profile  (보낸 필드만 변경)
z.object({
  nickname: Nickname.optional(),
  regionCode: RegionCode.optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
  runningSince: z.number().int().nullable().optional(),
}).strict()   // birthYear를 보내면 400 (PRD 4.3)
// → Me. 에러: 409 NICKNAME_TAKEN, 422 NICKNAME_FORBIDDEN, 422 NICKNAME_CHANGE_COOLDOWN

// GET /me/consents
z.array(z.object({ kind: z.enum(['service', 'privacy', 'marketing']), agreed: z.boolean(), agreedAt: DateTime.nullable(), contentUrl: z.string().url() }))

// POST /me/consents
z.object({ agreedTermIds: z.array(Id).min(1) })  → 204

// GET/PATCH /me/notification-settings
const NotificationSettings = z.object({
  registrationAlerts: z.boolean(),   // N-01~03
  ddayAlerts: z.boolean(),           // N-04~05
  marketing: z.boolean(),            // N-08b. 변경 시 user_consents agree/withdraw 행 추가
});
// PATCH 요청: NotificationSettings.partial(). 응답: NotificationSettings & { marketingChangedAt: DateTime | null } (날짜 토스트, 4.14)
// (T-021) GET도 같은 응답. marketingChangedAt = 마지막 마케팅 동의·철회 시각(이력 없으면 null). 선택 동의 철회는 marketing=false. 현재 마케팅 약관 버전이 없으면 500

// (T-021 추가) GET/PATCH /me/privacy — 항목별 공개 범위 (P-PRI-03). 다른 사용자가 보는 화면은 Phase 2라 값만 저장
z.object({ ageVisibility, genderVisibility, regionVisibility, recordsVisibility: z.enum(['public','participants','friends','private']), listedInParticipants: z.boolean() })  // PATCH는 partial().strict()

// (T-021) X-Device-Id 필수(없으면 400). pushPermission은 저장 컬럼이 없어 받기만 한다 (권한 거부면 pushToken null)
// (T-021 추가) DELETE /me/device → 204: 이 기기의 푸시 토큰만 해제. 기기 행을 지우면 FK로 그 기기 로그인 세션도 지워지므로 행은 남긴다
// PUT /me/device
z.object({
  pushToken: z.string().nullable(),           // Expo push token. 권한 거부면 null
  pushPermission: z.enum(['granted', 'denied', 'undetermined']),
  appVersion: z.string(),
  platform: z.enum(['ios', 'android']),
})  → 204   // 기기 식별은 X-Device-Id. 같은 pushToken이 다른 사용자에 있으면 그쪽에서 제거

// (T-021) 탈퇴 사유 통계 행은 사유를 고르지 않아도(reasonCode null) 남긴다(탈퇴 수 집계). reasonText는 reasonCode = other일 때만, 아니면 400 not_allowed
// 연결 해제 작업은 next_attempt_at = 지금으로 넣는다 (카카오·Apple, Google 없음). 파기 대상·보존 대상은 tech/03 8장
// DELETE /me
z.object({
  reasonCode: z.enum(['no_races', 'too_many_alerts', 'bad_prediction', 'other_app', 'privacy', 'other']).nullable(),
  reasonText: z.string().trim().max(200).nullable(),   // reasonCode = other일 때만
  confirmed: z.literal(true),                           // "안내를 모두 확인했어요"
})  → 204
// 처리: 한 트랜잭션으로 파기 + race_reports.user_id=null + account_deletion_stats(날짜만) + social_unlink_jobs → 커밋 후 204 (tech/03 8장)
```

### 6.4 대회 (F-010, F-011, F-012)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /races` | 사용자 | 목록·검색·필터 (리스트, 캘린더 날짜 선택 시 그날 목록) |
| `GET /races/count` | 사용자 | 필터 결과 수 ("128개 대회 보기") |
| `GET /races/calendar` | 사용자 | 월간 달력 날짜별 대회 수 |
| `GET /races/{raceId}` | 사용자 | 상세 |

> Phase 1은 비로그인 둘러보기가 없어 모든 대회 API가 로그인 필요 (PRD 9장, Q-15). 공개로 바꾸려면 `my` 필드만 빼면 된다.

```ts
// GET /races  쿼리 (배열은 반복 키: ?region=seoul&region=gyeonggi)
const RaceListQuery = z.object({
  q: z.string().trim().min(1).max(30).optional(),        // 대회명·장소명·주최, 부분 일치·공백 무시·대소문자 무시
  region: z.array(RegionCode).optional(),
  from: DateStr.optional(),                               // 기간 필터 (앱이 "이번 달" 등을 날짜로 바꿔 보냄)
  to: DateStr.optional(),                                 // from~to 최대 12개월
  date: DateStr.optional(),                               // 캘린더에서 고른 하루 (from=to=date와 같음)
  category: z.array(DistanceCategory).optional(),         // 종목 하나라도 해당
  registrationState: z.array(z.enum(['upcoming', 'open', 'closed', 'unscheduled'])).optional(),
  fee: z.array(z.enum(['le30k', '30k_50k', '50k_100k', 'gt100k'])).optional(), // 종목 하나라도 해당, 참가비 null 종목 제외
  includeEnded: z.coerce.boolean().default(false),        // "종료 포함"
  hideCancelled: z.coerce.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
// 응답: Page(RaceSummary) + 검색 시 구분선용 필드
z.object({ items: z.array(RaceSummary), nextCursor: z.string().nullable() })
```
- 기본 조건: `publish_status = 'published'`, `race_date ≥ 오늘`(`includeEnded=false`), 정렬 `race_date, name`.
- (T-018 구현) 불리언 쿼리는 `true`·`false` 문자열만 받는다 (`z.coerce.boolean`은 `'false'`도 참이 되므로). 접수 상태 필터·정렬·커서는 SQL로 거른 결과를 메모리에서 처리한다 (유효 접수 기간 계산을 한 함수로 유지, 게시 대회 수백 개 기준). 검색은 공백 제거·소문자 비교(`position`)이고 `pg_trgm`은 대회 수가 늘면 도입한다.
- **검색(`q`가 있을 때)**: 지난 대회도 포함하고 **예정 대회 전부 → 지난 대회(최근 순)** 순서로 돌려준다. 각 항목의 `registrationState === 'ended'`로 앱이 "지난 대회" 구분선을 그린다 (PRD 4.6).
- 참가비 구간 경계 (PRD 4.6, 경계값은 낮은 구간에 포함): `le30k` = ≤ 30,000 / `30k_50k` = 30,001~50,000 / `50k_100k` = 50,001~100,000 / `gt100k` = > 100,000.
- 구현: 검색은 PostgreSQL `pg_trgm` + 공백 제거 정규화 컬럼. 대회 수백 개 규모라 충분하다.

```ts
// GET /races/count  — RaceListQuery에서 cursor·limit 제외
z.object({ count: z.number().int() })

// GET /races/calendar?month=2026-11  (+ RaceListQuery의 필터들. q는 받지 않음)
z.object({
  month: z.string(),                                    // "2026-11"
  days: z.array(z.object({ date: DateStr, count: z.number().int() })), // 대회 있는 날만. 앱이 9+ 처리
})
// month 범위: 오늘 기준 −1개월 ~ +12개월 (PRD 4.5). 밖이면 400

// GET /races/{raceId}  → RaceDetail
// 404 NOT_FOUND: 없음 또는 draft
// 410 RACE_UNAVAILABLE: hidden (관심·참가 예정자 포함 모두에게. 앱은 "더 이상 볼 수 없는 대회예요")
```
- `my.registration`(`RegistrationBrief`)에 `entryStatus`가 있어 S-022 내 참가 예정 카드·하단 바 접수 상태·복귀 질문 조건 ③을 판단한다. "아직 접수 전이에요 · 마감 {M.D HH:mm}"는 `registrationState = 'open'` + `registrationClosesAt`(유효 접수 기간)으로 앱이 그린다.
- 대회장 지도: 앱은 `venue.lat/lng`가 있으면 미니 지도, 없으면 안내 박스 (PRD 4.7). 다크 모드에서도 기본(밝은) 지도 (PRD 4.7, 커스텀 다크 스타일은 Q-18).
- [길찾기]·[지도 앱에서 검색]은 서버 호출 없이 앱이 URL 스킴으로 연다 (handoff 답변 2번).

### 6.5 홈 (S-010)
섹션별 독립 로딩이므로 엔드포인트를 나눈다 (PRD 6.7).

| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /home/next-race` | 사용자 | 내 다음 대회 카드 |
| `GET /home/deadlines` | 사용자 | 접수 임박 (관심만 ∪ 참가 예정 `접수 전`, 7일 안 오픈 / 3일 안 마감, 최대 5개 — 아래 대상 규칙) |
| `GET /home/recommended` | 사용자 | 추천 대회 (아래 조건) |
| `GET /me/notifications/unread-count` | 사용자 | 벨 배지 (6.10 참고) |

```ts
// GET /home/next-race
z.object({
  next: z.object({
    race: RaceSummary, registration: RegistrationBrief, eventCategory: DistanceCategory,
  }).nullable(),                           // null → 빈 상태. 접수 상태 배지 = registration.entryStatus, 마감 안내 = race.registrationState·registrationClosesAt
  moreCount: z.number().int(),             // "외 n개 대회"
  hasAnyRecord: z.boolean(),               // 기록 유도 카드 표시 여부 (6.7 ⑤)
})
// GET /home/deadlines
z.object({ items: z.array(z.object({
  race: RaceSummary,
  type: z.enum(['opens', 'closes']),
  at: DateTime,                            // 오픈 또는 마감 시각
  timeKnown: z.boolean(),                  // 오픈 시각 미정이면 false
})) })
// 응답 스키마는 v1.2와 같다
// GET /home/recommended
z.object({ regionCode: RegionCode, items: z.array(RaceSummary), filledNationwide: z.boolean() })
```
- 접수 임박 대상 (PRD v1.5 6.7 ③, 접수 알림 N-01~N-03과 같은 규칙 — tech/03 7장):
  - 참가 예정이 **있으면** `entry_status = 'not_registered'`일 때만 포함 (관심 여부 무관). `registered`·`missed`인 대회는 **오픈 행·마감 행 모두** 빠진다
  - 참가 예정이 **없으면** 관심 대회 기준
  - SQL 조건: `(i.user_id IS NOT NULL AND r.id IS NULL) OR r.entry_status = 'not_registered'`
  - 마감 행의 `at`은 참가 예정자면 고른 종목의 마감(종목 값 → 없으면 유효 closesAt), 관심만이면 유효 closesAt (N-03과 같음). 마감 시각이 없으면 마감 행을 만들지 않는다
- (T-021·T-022) `GET /home/next-race`: 게시된 대회만(숨김 제외), **접수 상태 `missed` 제외**(카드·`moreCount` 모두, missed만 남으면 `next: null`, PRD v1.9 6.7 ②), 같은 날이면 출발 시각 → 대회명 순
- (T-021) `GET /home/recommended`의 `regionCode`는 nullable — 프로필 지역이 없으면 전국 보충만 한다
- 추천 조건 (PRD 6.7 ④): 게시된 대회 중
  1. `region_code` = 내 지역, 대회일 오늘 ~ 오늘+90일
  2. `registrationState` ∈ {`upcoming`, `open`, `unscheduled`} (취소·마감·종료 제외)
  3. **내가 관심 또는 참가 예정으로 둔 대회 제외**
  4. 대회일 순 최대 10개
  5. 3개 미만이면 **전국** 대회 중 2·3과 대회일 조건(오늘~90일)을 똑같이 적용해 관심 수 많은 순으로 10개까지 보충 (`filledNationwide = true`). 같은 대회는 중복하지 않는다

### 6.6 관심 대회 (F-013)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `PUT /races/{raceId}/interest` | 사용자 | 켜기 (멱등) |
| `DELETE /races/{raceId}/interest` | 사용자 | 끄기 (멱등). 참가 예정은 유지 |

```ts
// PUT 응답
z.object({ interested: z.literal(true), notifyRegistrationOpen: z.boolean() }) // 접수 예정이면 true → 토스트 문구 분기 (4.8)
// (T-021) 이미 켜진 대회는 한도 검사 없이 200. DELETE는 숨김 대회도 가능(내 대회 정리), 초안·없음은 404
// DELETE 응답
z.object({ interested: z.literal(false), stillRegistered: z.boolean() })
// 에러: 422 LIMIT_EXCEEDED (resource=interests, limit=200), 404, 410
```
- 지난 대회·취소 대회에도 켤 수 있다 (알림 대상에는 발송 시점 조건으로 빠짐).
- "참가 예정인 대회예요" 확인 다이얼로그는 앱이 `my.registered`로 판단해 띄운다. 서버는 확인 없이 처리.

### 6.7 내 대회 (S-061, S-060)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /me/races?tab=interested\|upcoming\|past` | 사용자 | 탭별 목록 (커서) |

```ts
// 응답
Page(RaceSummary.extend({
  registration: RegistrationBrief.nullable(),
  unavailable: z.boolean(),        // hidden 대회 → 앱은 탭 시 "더 이상 볼 수 없는 대회예요"
}))
```
- `interested`: 관심 ∩ `race_date ≥ 오늘`, 대회일 순 / `upcoming`: 참가 예정 ∩ `race_date ≥ 오늘`, 대회일 순 / `past`: (관심 ∪ 참가 예정) ∩ `race_date < 오늘`, 최근 순.
- `upcoming` 항목의 `registration.entryStatus`로 S-061 배지를 그린다 (`missed`도 탭에 남고 앱이 회색 처리, 정렬 변경 없음). "마감 D-n"은 `registrationClosesAt`으로 앱이 계산한다.
- 숨김(`hidden`) 대회도 포함하고 `unavailable: true`로 표시한다. 초안으로 되돌린 대회는 관심·참가가 0일 때만 가능하므로 나오지 않는다.

### 6.8 참가 예정 · 접수 상태 (F-015, D-019)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `POST /races/{raceId}/registration` | 사용자 | 참가 예정 추가 (접수 상태 포함) |
| `GET /registrations/{registrationId}` | 사용자 | 단건 (S-023 수정 모드) |
| `PATCH /registrations/{registrationId}` | 사용자 | 종목·목표·접수 상태 변경, [이 기록을 목표로 설정]. 접수 상태만 바꾸는 요청(복귀 질문, S-022·S-061 상태 시트)도 여기 |
| `DELETE /registrations/{registrationId}` | 사용자 | 참가 예정 해제 |
| `GET /registrations/{registrationId}/strategy` | 사용자 | 해당 참가 예정 기준 최신 예측 (없으면 새로 계산·저장). 딥링크 `berun://registrations/{id}/strategy` (7.3) |

```ts
const GoalInput = z.discriminatedUnion('goalSource', [
  z.object({ goalSource: z.literal('prediction'), goalTimeSec: z.number().int().positive() }), // = 예측 T̂ 또는 첫 풀 보수 목표
  z.object({ goalSource: z.literal('manual'),     goalTimeSec: z.number().int().positive() }),
  z.object({ goalSource: z.literal('none') }),
]);

// POST /races/{raceId}/registration
z.object({
  raceEventId: Id,
  entryStatus: z.enum(['not_registered', 'registered']).optional(), // missed는 생성 불가 → 400 VALIDATION_FAILED
  entryStatusSource: EntryStatusSource.optional(),                  // 기본 'form'. 복귀 질문 → S-023 경로면 'return_prompt'
  // 앱은 entryStatus를 항상 보낸다 (PRD v1.5 4.10 ⑤). 서버 기본값은 다른 클라이언트·구버전 대비용
}).and(GoalInput)
// entryStatus 생략 시 서버 기본값: 대회 유효 접수 기간(5장 규칙) 기준 registrationState = 'closed'면 'registered', 그 외 'not_registered'.
//   (T-018) 서버 기본값을 쓰면 entry_status_updated_at·entry_status_source 모두 null. 앱이 entryStatus를 보내면 source 기본 'form'
//   앱도 같은 기본값을 미리 선택해 보내지만 서버 규칙이 기준이다 (PRD 4.10 3-1)
// 응답 201
const Registration = z.object({
  id: Id, raceId: Id, raceEventId: Id, eventName: z.string(), eventDistanceM: z.number().int(),
  goalTimeSec: z.number().int().nullable(),
  goalPaceSecPerKm: z.number().int().nullable(),   // 서버 계산 round(goal / (distanceM/1000))
  goalSource: z.enum(['prediction', 'manual', 'none']),
  entryStatus: EntryStatus,
  entryStatusUpdatedAt: DateTime.nullable(),
  predictionId: Id.nullable(),                     // 목표 있으면 추가 시점 예측을 계산·저장하고 연결 (4.10 ⑥). 예측 미지원 거리·기록 없음이면 null
  predictionSupported: z.boolean(),
  interestAutoEnabled: z.boolean(),
  showOfficialRegistrationNotice: z.boolean(),     // entryStatus = not_registered이고 접수 예정·접수 중이면 true → 바텀시트 (P-RACE-01)
  warnings: z.array(z.enum(['GOAL_OVER_TIME_LIMIT'])),
  createdAt: DateTime,
});
// 에러: 409 ALREADY_PLANNED(details.registrationId), 409 RACE_CANCELLED, 409 RACE_FINISHED,
//       422 GOAL_OUT_OF_RANGE, 422 LIMIT_EXCEEDED(resource=registrations, limit=30), 400(raceEventId가 그 대회 종목이 아님), 410

// PATCH /registrations/{id}  (보낸 필드만 변경)
z.object({
  raceEventId: Id.optional(),
  entryStatus: EntryStatus.optional(),                 // 3개 값 모두 가능
  entryStatusSource: EntryStatusSource.optional(),     // entryStatus를 보낼 때 필수 (form / return_prompt / race_detail / my_races)
}).and(GoalInput.optional())
// → Registration
// 종목을 거리가 다른 종목으로 바꾸고 목표를 보내지 않으면 서버가 목표를 지운다 (4.10 수정) → 응답 goalSource='none'
// entryStatus가 실제로 바뀌면 entry_status_updated_at = now(), entry_status_source = 요청값. 같은 값이면 시각을 바꾸지 않는다 (멱등)
// 에러: 409 RACE_FINISHED (race_date < 오늘(KST)이면 수정 불가 — 대회 당일까지 변경 가능, PRD v1.5 4.10.1), 422 GOAL_OUT_OF_RANGE,
//       400 (entryStatus만 있고 entryStatusSource 없음)
// 'missed'로 바꿔도 행은 남는다. "참가 예정에서 뺄까요?" → [참가 예정 해제]는 앱이 이어서 DELETE를 호출한다

// (T-018) Registration.predictionId는 이 참가 예정에 연결된 가장 최근 예측. PATCH는 예측을 다시 계산하지 않는다.
//   interestAutoEnabled·showOfficialRegistrationNotice는 추가(POST) 응답에서만 의미가 있고 GET·PATCH는 false
// DELETE /registrations/{id} → 204 (참가 예정 해제). predictions.race_registration_id = null, 관심 유지, 대회일 지났으면 409 RACE_FINISHED

// (T-021) strategy의 prediction = 이 참가 예정에 연결된 가장 최근 저장 예측(기록이 바뀌어도 다시 계산하지 않고 recordsChangedSince로 표시). 없으면 계산·저장
// GET /registrations/{id}/strategy
z.object({
  prediction: Prediction.nullable(),
  predictionUnavailableReason: z.enum(['no_records', 'unsupported_distance']).nullable(), // prediction이 null일 때만 값
  goalSplits: z.object({ even: z.array(SplitRow), negative: z.array(SplitRow) }).nullable(), // 목표 기록 기준 (4.13 "목표 기준")
})
// unsupported_distance: 예측은 계산하지 않고 goalSplits만 (목표 없으면 둘 다 null). 스플릿 계산(PRD 5.6)은 거리 제한이 없다
//   (< 15,000m → 1km 단위, ≥ 15,000m → 5km 단위. 50km·100km도 그대로 동작)
```
- 목표 검증: 페이스 = goalTimeSec ÷ (distanceM/1000), **170 ≤ 페이스 ≤ 900초/km** (2'50"~15'00"). 제한 시간 초과는 경고만.
- 접수 상태 변경은 알림 대상에 **발송 30분 전 대상 확정 시점의 값**으로 반영된다 (tech/03 7장). 이미 확정된 `notifications` 행은 발송 직전 확인 ③에서 다시 걸러진다.
- 복귀 질문의 24시간·누적 3회 제한은 기기 저장이라 서버 API가 없다 (PRD 4.10.1).

### 6.9 대회 정보 오류 제보 (F-016)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `POST /races/{raceId}/reports` | 사용자 | 제보 접수 |

```ts
z.object({
  field: z.enum(['date', 'venue', 'events', 'fee', 'registration', 'links', 'status', 'other']),
  message: z.string().trim().min(10).max(500),
})
// 201 { id }. 에러: 429 REPORT_LIMIT_DAILY (details.scope: 'race' | 'total', details.limit), 404, 410
// (T-021) 내용 길이는 앞뒤 공백 제거 후 코드포인트 기준 (too_short / too_long). 같은 대회 한도를 먼저 본다
```
- 지난 대회·취소 대회도 제보 가능. 한도 판정 날짜는 KST.

### 6.10 기록 (F-004)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /me/records` | 사용자 | 날짜 최신순, 커서 20개 |
| `POST /me/records` | 사용자 | 추가 (온보딩 S-005는 여러 개를 연달아 호출) |
| `PATCH /me/records/{recordId}` | 사용자 | 수정 |
| `DELETE /me/records/{recordId}` | 사용자 | 삭제 |

```ts
const RecordInput = z.object({
  category: DistanceCategory,
  distanceM: z.number().int(),        // 5k/10k/half/full이면 고정값과 같아야 함. other: 1,000~100,000, 100m 단위
  durationSec: z.number().int().min(1).max(23 * 3600 + 59 * 60 + 59),
  runDate: DateStr,                   // 1990-01-01 ~ 오늘(KST)
  kind: z.enum(['race', 'training']),
  title: z.string().trim().max(40).nullable(),
  confirmDuplicate: z.boolean().default(false),
}).superRefine(/* 페이스 150~1200초/km (2'30"~20'00"), 고정 거리 일치 */);
// POST 201 → RunRecord. 에러: 409 DUPLICATE_RECORD(details.existingRecordId), 422 LIMIT_EXCEEDED(resource=records, limit=500)
// PATCH: RecordInput.partial() (category와 distanceM은 함께) + confirmDuplicate(기본 false). DELETE → 204
// PATCH 에러: 409 DUPLICATE_RECORD(details.existingRecordId) — 날짜·거리·기록 중 하나라도 바뀌었고 자기 자신이 아닌 기록과 같을 때만. 제목·구분만 바꾸면 확인하지 않음 (PRD v1.6 4.4)
```
- 추가·수정·삭제 시 `users.records_changed_at = now()` → 예측 카드 `recordsChangedSince` 계산. 저장된 예측은 다시 계산하지 않는다 (4.4).

### 6.11 기록 예측 · 페이스 전략 (F-020, F-021)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /me/predictions/candidates` | 사용자 | S-032: eligible 기록 + 자동 선택 + 반영 라벨 |
| `POST /me/predictions` | 사용자 | 계산 + 저장 → S-033 |
| `POST /me/predictions/preview` | 사용자 | 계산만 (S-023 추천 카드, 저장 안 함) |
| `GET /me/predictions` | 사용자 | 최근 예측 (S-030 최근 3개 `limit=3`, 전체 보기 최대 50개) |
| `GET /me/predictions/{predictionId}` | 사용자 | 저장된 예측 그대로 (재계산 없음) |

```ts
// (T-021) weight는 소수 3자리 반올림, emptyReason은 eligible 기록이 0개일 때만. targetDistanceM 3,000~42,195 밖은 400
// GET /me/predictions/candidates?targetDistanceM=21097
z.object({
  records: z.array(z.object({
    record: RunRecord,
    weight: z.number(),                                 // 내부값. 앱은 표시하지 않음
    weightLabel: z.enum(['high', 'medium', 'low']),     // 많이/보통/조금 반영 (w ≥ 0.7 / ≥ 0.4 / < 0.4)
    autoSelected: z.boolean(),                          // 상위 5개
  })),
  emptyReason: z.enum(['none', 'all_older_than_365d']).nullable(),
})

// POST /me/predictions , POST /me/predictions/preview
const PredictionReq = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('distance'), distanceM: z.number().int().min(3000).max(42195) }), // 칩 또는 직접 입력
    z.object({ type: z.literal('registration'), registrationId: Id }),                           // 내 참가 대회 (거리·제한 시간 사용)
    z.object({ type: z.literal('race_event'), raceEventId: Id }),                                // preview 전용: S-023에서 참가 예정 추가 전
  ]),
  recordIds: z.array(Id).min(1).nullable(),             // null = 자동 선택. 값 있으면 고른 기록만, 같은 가중치 (5.2). 6개 이상은 422 LIMIT_EXCEEDED (스키마 max 없음)
});
// 응답: Prediction (preview는 id·createdAt null)
// 에러: 422 TARGET_DISTANCE_UNSUPPORTED (registration·race_event 대상 거리가 3,000~42,195m 밖. distance 대상은 스키마에서 400),
//       422 NO_ELIGIBLE_RECORDS, 400 (recordIds 중 내 기록이 아님 → fieldErrors code `not_found`, eligible 아님 → `not_eligible`), 422 LIMIT_EXCEEDED(resource=prediction_records, limit=5)
//       POST /me/predictions에 target.type = race_event → 400 (fieldErrors path `target.type`, code `invalid_value`)
```
- 검사 순서: 대상(남의 참가 예정·초안 대회 404, 숨김 410, 거리) → 기록 개수 한도 → 기록 선택 검증 → 계산. 미지원 거리면 기록이 없어도 `TARGET_DISTANCE_UNSUPPORTED`.
- `NO_ELIGIBLE_RECORDS.details.reason`: 3,000~42,195m 기록이 있지만 모두 365일 초과면 `all_older_than_365d`, 그 밖은 `none`.
- 계산은 서버에서만 한다 (PRD 5장). 같은 입력·같은 날짜 → 같은 결과 (결정적). 예측일 = 요청 시각의 KST 날짜.
- `GET /me/predictions` 응답 항목은 `Prediction`에서 `splits`·`usedRecords`를 뺀 요약형 (`PredictionSummary`).

### 6.12 알림 (F-014, S-011)
| 메서드·경로 | 인증 | 설명 |
|---|---|---|
| `GET /me/notifications` | 사용자 | 최근 90일, 커서 20개 |
| `GET /me/notifications/unread-count` | 사용자 | `{ count }` (앱은 99+ 처리) |
| `POST /me/notifications/read` | 사용자 | 읽음 처리 |
| `GET /notices/{noticeId}` | 사용자 | 공지 상세 — **앱 화면**으로 표시 (웹뷰·공지 웹 페이지 없음, PRD 8.6) |

```ts
// GET /me/notifications → Page(AppNotification). status = sent 또는 failed (푸시가 실패해도 앱 내 알림은 남는다, PRD 7.1). scheduled·cancelled 제외
// (T-019) title·body·deepLink는 워커가 발송 시점에 렌더링해 notifications.payload에 저장한 값. 푸시 data = { notificationIds, deepLink }
// (T-020 구현) 정렬·커서·createdAt은 created_at이 아니라 **scheduled_at**(예약 발송 시각, 즉시 알림은 생성 시각) — 예약 알림은 발송 30분 전에 행이 생겨
//   created_at으로 정렬하면 "3시간 전" 표시가 받은 시각과 30분 어긋난다. 보이는 기간(90일)은 created_at 기준. 문구가 아직 없는(발송 전) 행은 내보내지 않는다
// POST /me/notifications/read
z.union([ z.object({ ids: z.array(Id).min(1).max(100) }), z.object({ all: z.literal(true) }) ])  → 204
// GET /notices/{id}
z.object({
  id: Id,
  kind: z.enum(['notice', 'marketing']),
  title: z.string(),                      // marketing은 "(광고) " 포함
  body: z.string(),                       // 일반 텍스트. 앱이 줄바꿈 유지·URL 자동 링크(인앱 브라우저)
  publishedAt: DateTime,
  link: z.discriminatedUnion('type', [    // 하단 이동 버튼. notice면 버튼 없음
    z.object({ type: z.literal('notice') }),
    z.object({ type: z.literal('race'), raceId: Id }),
    z.object({ type: z.literal('race_list') }),
  ]),
})
// 410 NOTICE_WITHDRAWN: 관리자가 내린 공지 → 앱은 "내려간 공지예요" (S-011 목록의 해당 알림 행은 그대로 둔다)
// 404 NOT_FOUND: 없음 또는 아직 발송 전(draft·approved 예약 대기)
```
- 푸시 페이로드(`data`): `{ notificationIds: string[], deepLink: string }`. 묶음 푸시는 `deepLink = berun://notifications` (PRD 7.3). 앱은 푸시 탭으로 열리면 해당 알림을 읽음 처리한다.

## 7. 관리자 API (`/api/admin/v1`)

> 권한: `O` owner, `P` operator, `V` viewer (PRD 8.1). 표에 없는 역할은 403.
> 동시 수정 방지: 대회 수정은 `If-Match: {updatedAt}` 헤더 필수 → 다르면 409 `CONFLICT_STALE`.

> **구현 (T-020)**: 7.1 인증·계정, 7.3 대회(지오코딩 제외), 7.5 제보. 7.2 대시보드·7.4 수집 후보·7.6 공지·7.7 원격 설정은 다음 작업.
> - 세션: Redis `admin:sess:{hash}`, 쿠키 `berun_admin_session`(path `/api/admin`, httpOnly, SameSite=Strict, 운영은 Secure). 2단계 토큰 5분·5회. 잠금 중 로그인 → **429 `RATE_LIMITED`** (`details.lockedUntil`). 비활성 관리자는 다음 요청부터 401.
> - CSRF 실패·역할 부족 → 403 `FORBIDDEN`. 감사 로그 `action`은 `{METHOD} {경로 패턴}` (로그인은 `login`, 로그아웃 `logout`), 응답 전에 기록.
> - `POST /admins`: `{ email, role, password(12자 이상) }` → `{ admin, totpUri }` (TOTP 등록 URI는 이 응답에만). `PATCH /admins/{id}`: `{ role?, disabled? }` — 자기 비활성화·마지막 owner 강등은 400.
> - `If-Match`: 없으면 400(`if-match` required), 초 단위 비교. 관리자 입력 시각은 초 단위로 저장.
> - 슬러그 자동: 대회명의 영문·숫자 부분(없으면 `race`) + 대회 연도 + 짧은 랜덤 (한글은 로마자로 바꾸지 않음).
> - `PUT`: 종목 표의 빠진 행은 삭제 — 참가 예정이 있는 종목이면 400(`events`, `event_in_use`). 게시된 대회를 도로 외 종류로 바꾸면 400(`raceType`, `publish_requires_road`).
> - 공식 URL을 처음 넣으면 대표 출처(확인 일시 = 지금)를 만든다. 이후 확인 일시는 `markVerifiedNow`일 때만 갱신.
> - N-06c 요약(`changeSummary`): 대회일·출발 시각·접수 오픈·접수 마감 중 바뀐 것 최대 2개 (예: "대회일: 3월 22일"). 상태 연기·취소가 일정 변경보다 우선.
> - `GET /races` 관리자 목록 응답: `{ items, total, page, pageSize }`, 항목에 `publishMissing`·`hasCoords`.
> - 제보 처리 N-07은 앱 내 알림만(푸시 없음, `status = sent`, `sent_at` null). 탈퇴·휴면·정지 제보자에게는 남기지 않는다.

### 7.1 인증 · 계정 (A-001)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `POST /auth/login` | — | `{ email, password }` → `{ mfaRequired: true, mfaToken }` |
| `POST /auth/mfa` | — | `{ mfaToken, totp }` → 세션 쿠키 + `{ admin: { id, email, role }, csrfToken }` |
| `POST /auth/logout` | OPV | 세션 종료 |
| `GET /auth/me` | OPV | 현재 관리자 `{ id, email, role, csrfToken }` (`Cache-Control: no-store`). 새로고침한 관리자 웹이 같은 세션의 CSRF 토큰을 다시 받는다 (T-024) |
| `GET/POST /admins`, `PATCH /admins/{id}` | O | 관리자 계정 생성·역할 변경·비활성화 (첫 owner는 시드) |

### 7.2 대시보드 (A-002)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /dashboard` | OPV | PRD 8.3 카드 전부 |
| `PUT /settings/coverage-target` | O | 기준 목록 목표 수 `{ target: number }` (`app_configs.coverage_target`) |

```ts
z.object({
  users: z.object({ signupsToday: z.number(), signups7d: z.number(), dau: z.number(), wau: z.number() }),
  races: z.object({ publishedUpcoming: z.number(), drafts: z.number(), staleVerified: z.number(), publishedWithoutCoords: z.number() }),
  coverage: z.object({ published: z.number(), target: z.number().nullable(), enteredToday: z.number(), enteredThisWeek: z.number() }),
  opensThisWeek: z.array(z.object({ raceId: Id, name: z.string(), opensAt: DateTime, interestCount: z.number() })),
  reports: z.object({ open: z.number(), overdue72h: z.number() }),
  notifications: z.object({ sentToday: z.number(), failedToday: z.number(), n02OnTimeRate7d: z.number().nullable() }), // D-018 기준
})
```

### 7.3 대회 (A-003)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /races` | OPV | 목록. 필터: `q`, `publishStatus[]`, `status[]`, `region[]`, `from`, `to`, `staleVerified`, `noCoords`, `publishBlocked`. 정렬 `raceDate`. 열: PRD 8.4 + `interestCount`, `registrationCount` |
| `POST /races` | OP | **초안 생성** — 필수는 `name`, `raceDate`, `regionCode` 3개뿐 (8.4.1) |
| `GET /races/{id}` | OPV | 편집용 전체 (종목·출처·내부 발견 경로 포함) |
| `PUT /races/{id}` | OP | 전체 저장 (종목 표 포함, 아래 스키마). 게시 상태면 영향 확인 필요 |
| `POST /races/{id}/publish` | OP | 게시 조건 검사 후 게시 |
| `POST /races/{id}/unpublish` | OP | 게시 → 초안 (관심·참가 0일 때만) |
| `POST /races/{id}/hide` | OP | 숨김 (주최 측 요청 등), `{ memo }` 필수 → 감사 로그 |
| `DELETE /races/{id}` | O | 삭제 (관심·참가 0일 때만, 그 외 409 → 취소 상태 안내) |
| `POST /races/{id}/clone` | OP | 복제 → 새 초안 반환 (8.4.4) |
| `GET /races/duplicates` | OP | 입력 중 중복 경고 `?name=&raceDate=` → 같은 `dedupe_key` 후보 |
| `GET /races/{id}/impact` | OPV | 저장 전 영향 확인 모달용 `{ interestCount, registrationCount }` |
| `GET /geocode` | OP | `?query=주소또는장소명` → NCP Geocoding 결과 후보 (서버 측 키) |

```ts
const AdminRaceEventInput = z.object({
  id: Id.optional(),                              // 없으면 신규 행
  name: z.string().trim().min(1).max(20),
  category: DistanceCategory,
  distanceM: z.number().int().min(1000).max(100000),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(), // 날짜는 대회일 자동 (8.4.2)
  timeLimitMin: z.number().int().min(30).max(720).nullable(),
  feeKrw: z.number().int().min(0).max(1_000_000).nullable(),
  capacity: z.number().int().min(1).max(100_000).nullable(),
  registrationOpensAt: DateTime.nullable(),      // 종목별 접수 기간 — 관리자 표의 접힌 "고급" 칸 (PRD 8.4.2)
  registrationClosesAt: DateTime.nullable(),     // 대회 접수 기간과 다를 때만 입력
});
// 검증 (AdminRaceInput.superRefine에서 대회일과 함께): 둘 중 하나만 있어도 저장 가능.
//   opensAt < closesAt (둘 다 있을 때), closesAt < 대회일 00:00 KST, opensAt < 대회일 00:00 KST
//   위반 시 400 fieldErrors path 예: "events[2].registrationClosesAt", code: "after_race_date" | "before_opens_at"

const AdminRaceInput = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),     // 없으면 자동 (충돌 시 -2, -3)
  organizer: z.string().trim().max(60).nullable(),
  regionCode: RegionCode,
  venueName: z.string().trim().max(60).nullable(),
  venueAddress: z.string().trim().max(120).nullable(),
  venuePoint: z.object({ lat: z.number().min(33).max(39), lng: z.number().min(124).max(132) }).nullable(),
  raceDate: DateStr,                                     // 신규는 오늘 이후 (과거는 owner만)
  registrationOpensAt: DateTime.nullable(),
  registrationOpensTimeKnown: z.boolean().default(true), // false면 서버가 opensAt을 그날 00:00으로 저장
  registrationClosesAt: DateTime.nullable(),             // > opensAt, < 대회일
  officialUrl: z.string().url().startsWith('https://').nullable(),
  registrationUrl: z.string().url().startsWith('https://').nullable(),
  courseUrl: z.string().url().startsWith('https://').nullable(),
  raceType: z.enum(['road', 'trail', 'ultra', 'track', 'virtual']).default('road'),
  registrationMethod: RegistrationMethod.default('unknown'),
  status: RaceStatus.default('scheduled'),
  events: z.array(AdminRaceEventInput),                  // 초안은 0개 허용, 게시엔 1개 이상
  extraSources: z.array(z.object({                       // 공식 출처는 officialUrl에서 자동 생성 (8.4.2)
    kind: z.enum(['official', 'organizer']), name: z.string(), url: z.string().url().nullable(), verifiedAt: DateTime.nullable(),
  })).default([]),
  discoverySources: z.array(z.object({                   // 내부 발견 경로 — 앱에 절대 노출 안 함
    kind: z.enum(['aggregator', 'news', 'user_report', 'crawler', 'manual']), name: z.string(), url: z.string().url().nullable(),
  })).default([]),
  markVerifiedNow: z.boolean().default(false),           // [확인 완료 — 오늘로 갱신]: last_verified_at·대표 출처 확인 일시 = now()
  notifyChange: z.boolean().default(true),               // 일정 변경 시 N-06c 발송 (기본 체크)
});

// POST /races (초안): AdminRaceInput.partial().required({ name: true, raceDate: true, regionCode: true })
// 신규 작성은 last_verified_at = now() 자동. 복제 초안은 null — 대표 출처 확인 일시도 같은 규칙 (PRD 8.4.2)

// PUT /races/{id} 응답
z.object({
  race: AdminRace,                                        // 저장된 전체
  dedupeWarnings: z.array(z.object({ id: Id, name: z.string(), raceDate: DateStr })),
  sideEffects: z.object({                                 // 서버가 실행한 것
    notificationsRescheduled: z.boolean(),
    sentChangeNotice: z.enum(['race_cancelled', 'race_postponed', 'race_schedule_changed']).nullable(),
    affectedUsers: z.number().int(),
  }),
})
```
- 게시 상태 대회 저장 규칙 (PRD 8.4 저장 시 동작):
  - `status` → `cancelled`: N-06a 즉시 발송 (끌 수 없음), 미발송 N-01~N-05 `cancelled`.
  - `status` → `postponed`: N-06b 즉시 발송.
  - 대회일·출발 시각·접수 기간 변경: `notification_schedules` 재계산(항상) + `notifyChange=true`면 N-06c.
  - 앱은 저장 전에 `GET /races/{id}/impact`로 영향 모달을 띄운다. 서버는 모달 확인 여부를 강제하지 않는다.
- `raceType ≠ road`는 저장은 되지만 게시 불가 (D-013).

```ts
// POST /races/{id}/publish → 200 AdminRace | 422 PUBLISH_REQUIREMENTS_UNMET
// details.missing 코드: 'name' | 'raceDate' | 'regionCode' | 'officialUrl' | 'primarySourceVerified'
//                     | 'events' | 'eventFields' | 'raceTypeRoad' | 'lastVerifiedAt'
// 게시 시 notification_schedules 생성

// POST /races/{id}/clone
z.object({ shiftDates: z.boolean().optional() })   // 기본: 원본 대회일 < 오늘이면 true
// 응답: AdminRace (새 초안) + shiftedFields: string[] (노란 강조용) + renamed: { year: boolean, edition: boolean }
// 규칙: 날짜 +364일(52주) (PRD 8.4.4), 대회명 첫 20\d\d → 새 연도, 첫 제N회 → N+1
//       종목 복사, 대표 출처 URL만 복사(확인 일시 null), last_verified_at null, status scheduled, publish draft,
//       races.cloned_from = 원본, 감사 로그 memo = 원본 id

// GET /geocode?query=…
z.object({ items: z.array(z.object({ roadAddress: z.string().nullable(), jibunAddress: z.string().nullable(), lat: z.number(), lng: z.number() })) })
// NCP 장애 시 502 → 관리자는 좌표 붙여넣기·지도 핀으로 입력 (8.4.2)
```
- 관리자 웹의 핀 조정 지도는 브라우저에서 NCP Web Dynamic Map JS SDK를 직접 쓴다 (API 호출 없음, handoff 답변 3번).

### 7.4 수집 후보 (tech/05, `race_candidates`)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /candidates` | OPV | `status=pending` 기본, 신규/변경 구분 |
| `GET /candidates/{id}` | OPV | 제안값·diff·출처 |
| `POST /candidates/{id}/create-race` | OP | 후보 값으로 새 초안 생성 → AdminRace (8.4.1 "수집 후보에서 시작") |
| `POST /candidates/{id}/apply` | OP | 변경 후보를 기존 대회에 반영 → 대회 수정 화면으로 (실제 저장은 `PUT /races/{id}`) |
| `POST /candidates/{id}/reject` | OP | `{ reason: 'duplicate' \| 'irrelevant' \| 'wrong' }` |

- Phase 1 출시 시점에는 수집기가 "발견 목록"만 만든다 (tech/05 4장). 후보 화면이 비어 있어도 대회 입력에는 지장 없다.

### 7.5 제보 (A-004)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /reports` | OPV | `status[]`, 오래된 순, `overdue72h` 표시 |
| `GET /reports/{id}` | OPV | 전문, 제보자 닉네임(탈퇴 시 null), 대회 현재 값, 같은 대회 미처리 제보 |
| `POST /reports/resolve` | OP | 일괄 처리 |

```ts
// POST /reports/resolve
z.object({
  ids: z.array(Id).min(1).max(50),
  action: z.enum(['applied', 'rejected']),
  rejectReason: z.enum(['same_as_official', 'unverifiable', 'already_applied', 'other']).optional(), // rejected일 때 필수
  rejectText: z.string().trim().max(100).optional(),                                                  // other일 때 필수
})
// → { resolved: number }. 각 제보자에게 N-07a/N-07b (앱 내만). resolved_at·resolved_by·resolution_note 기록
```

### 7.6 공지 · 푸시 (A-008)
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /notices` | OPV | 목록 + 발송 통계 |
| `POST /notices` | OP | 작성 (draft) |
| `PUT /notices/{id}` | OP | 수정 (발송 전만) |
| `GET /notices/{id}/audience` | OP | 대상 수 (확인 모달) |
| `POST /notices/{id}/test` | OP | `{ userId }` 테스트 1건 |
| `POST /notices/{id}/approve` | O | 승인 → 즉시 발송 또는 예약. **owner가 작성한 공지는 작성자 본인이 바로 승인** (PRD 8.6, D-014) |
| `POST /notices/{id}/withdraw` | OP | 앱 내 공지 내리기 (발송 후 수정 불가, 내리기만). 이후 앱 `GET /notices/{id}`는 410 `NOTICE_WITHDRAWN` |

```ts
const NoticeInput = z.object({
  kind: z.enum(['notice', 'marketing']),
  title: z.string().trim().min(1).max(30),         // marketing은 서버가 "(광고) " 접두 (지울 수 없음)
  body: z.string().trim().min(1).max(500),
  sendPush: z.boolean(),
  link: z.discriminatedUnion('type', [
    z.object({ type: z.literal('notice') }),
    z.object({ type: z.literal('race'), raceId: Id }),
    z.object({ type: z.literal('race_list') }),
  ]),
  scheduledAt: DateTime.nullable(),                // null = 승인 즉시. marketing은 08:00~20:59 KST만 (400)
});
```

### 7.7 원격 설정
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /app-configs` | OPV | `app_configs` 전체 |
| `PUT /app-configs/{key}` | O | 최소 버전·점검 등 (`min_native_version_ios`, `min_native_version_android`, `maintenance`, `support_email`, `coverage_target`) |

## 8. 요청 제한 (rate limit)

Redis 슬라이딩 윈도우. 초과 시 429 `RATE_LIMITED` + `Retry-After`.

| 대상 | 한도 | 키 |
|---|---|---|
| 인증 API (`/auth/social`, `/auth/refresh`) | 20회/분 | IP + device |
| `/nicknames/availability` | 60회/분 | 가입 토큰 또는 사용자 |
| 일반 조회 | 300회/분 | 사용자 |
| 쓰기 (관심, 기록, 참가 예정 등) | 60회/분 | 사용자 |
| 예측 계산 (`/me/predictions*`) | 30회/분 | 사용자 |
| 제보 | 같은 대회 3건/일, 전체 10건/일 (KST) → 429 `REPORT_LIMIT_DAILY` | 사용자 |
| 관리자 로그인 | 5회 실패 → 15분 잠금 | 계정 |
| 관리자 `GET /geocode` | 30회/분 | 관리자 |

## 9. 서버가 강제하는 정책 매핑

| 정책 / PRD | 강제 위치 |
|---|---|
| 만 14세 미만 가입 불가 (P-ACC-01, 4.3) | `POST /auth/signup` 출생연도 판정. 미만이면 422 + 소셜 연결 해제 + 가입 세션 삭제, `users` 행 없음 |
| 필수 약관 동의 (4.2) | 가입 시 필수 2개 현재 버전 없으면 400. 새 버전 시행 후 403 `TERMS_REQUIRED` 게이트 |
| 마케팅 동의 이력 (4.14) | 설정 변경 시 `user_consents` append |
| 게시 대회만 노출 (4.5) | 앱 API 모든 대회 조회에 `publish_status = 'published'` 조건, hidden 410 |
| 출처 표시 (P-RACE-02, P-RACE-07) | 앱 응답에는 대표 출처(`is_primary`)만. 집계 사이트·제보·수집기 출처는 앱 응답 스키마에 필드 자체가 없음 |
| 도로 대회만 게시 (D-013) | `publish`에서 `raceType = road` 검사 |
| 접수 상태 알림 대상 (D-019) | 대상 확정 쿼리 (tech/03 7장 표). `missed` 생성 금지는 스키마 400 |
| 대회당 한 종목 (P-VER-04) | DB `UNIQUE (user_id, race_id)` → 409 `ALREADY_PLANNED` |
| 취소·지난 대회 참가 예정 추가 불가 (P-RACE-06) | `POST /races/{id}/registration` 409 |
| 개수 한도 (기록 500, 관심 200, 미래 참가 예정 30, 예측 기록 5) | 각 API 422 `LIMIT_EXCEEDED` |
| 제보 한도 | 429 `REPORT_LIMIT_DAILY` |
| 닉네임 7일 1회·금칙어·대소문자 무시 중복 | `PATCH /me/profile` + `lower(nickname)` 유니크 |
| 출생연도 수정 불가 | `PATCH /me/profile` strict 스키마 |
| 예측 면책 (P-PRED-01) | 앱 표시 의무. 서버는 `Prediction`에 면책 필요 여부를 따로 두지 않음 (항상 표시) |
| 마케팅 야간 금지 (P-NOTI-02) | 공지 예약 시각 검증 + DB CHECK + 발송 시 재확인 |
| 탈퇴 즉시 파기 (4.15) | `DELETE /me` 한 트랜잭션 |
| 관리자 감사 로그 | 관리자 API 쓰기 미들웨어 |

## 10. 앱 화면 ↔ API 매핑

| 화면 | 호출 |
|---|---|
| S-001 스플래시 | `GET /app-config` → `POST /auth/refresh` → `GET /me`(pendingTerms) |
| S-002 로그인 | `POST /auth/social` |
| S-003 약관 | `GET /terms/current` (동의 저장은 S-004 완료 시 함께) |
| S-004 프로필 | `GET /nicknames/availability`, `POST /auth/signup` / 중단 `POST /auth/signup/abort` |
| S-005 기록 입력 | `POST /me/records` × n |
| S-006 알림 권한 | `PUT /me/device` |
| S-010 홈 | `GET /home/next-race`, `GET /home/deadlines`, `GET /home/recommended`, `GET /me/notifications/unread-count` |
| S-011 알림 | `GET /me/notifications`, `POST /me/notifications/read`, `GET /notices/{id}` |
| S-020 대회 | `GET /races`, `GET /races/calendar`, `PUT/DELETE /races/{id}/interest` |
| S-021 검색·필터 | `GET /races?q=`, `GET /races/count` |
| S-022 상세 | `GET /races/{id}`, 관심 PUT/DELETE, 접수 상태 시트·복귀 질문 `PATCH /registrations/{id}` |
| S-023 참가 예정 추가·수정 | `POST /me/predictions/preview`(target=race_event), `POST /races/{id}/registration`, `GET/PATCH/DELETE /registrations/{id}` |
| S-024 제보 | `POST /races/{id}/reports` |
| S-030 기록 홈 | `GET /me/predictions?limit=3`, `GET /me/records` |
| S-031 기록 추가/수정 | `POST/PATCH/DELETE /me/records` |
| S-032 예측 | `GET /me/predictions/candidates`, `GET /me/races?tab=upcoming`, `POST /me/predictions` |
| S-033 결과·전략 | `GET /me/predictions/{id}` 또는 `GET /registrations/{id}/strategy`, [이 기록을 목표로] `PATCH /registrations/{id}` |
| S-060 마이 | `GET /me` |
| S-061 내 대회 | `GET /me/races?tab=`, 배지 탭 → `PATCH /registrations/{id}` (entryStatus) |
| S-062 프로필 수정 | `PATCH /me/profile` |
| S-063 설정 | `POST /auth/logout` |
| S-064 알림 설정 | `GET/PATCH /me/notification-settings` |
| S-065 개인정보·약관 | `GET /me/consents`, 마케팅 토글은 `PATCH /me/notification-settings` |
| S-066 탈퇴 | `DELETE /me` |

## 11. PRD 반영 이력

v1에서 `[PRD 변경 대기]`로 표시했던 4건은 PRD v1.2에 모두 반영되어 표시를 지웠다.

| # | PRD v1.2 위치 | 내용 |
|---|---|---|
| 1 | 4.7 | Phase 1은 다크 모드에서도 기본(밝은) 지도. 커스텀 다크 스타일은 비용 확인 후 (Q-18) |
| 2 | 8.4.2 | 최종 확인일·대표 출처 확인 일시: 신규 작성 = 오늘 자동, 복제 초안 = 비움 |
| 3 | 8.4.4 | 날짜 이동 = +364일(52주) |
| 4 | 4.6 | 참가비 경계값은 낮은 구간에 포함 |

v1.1에서 PRD v1.2 대조 요청(handoff `20261021-planner-developer-api-v1-prd-v1.2-gaps.md`) 5건을 반영했다: 공지 상세 앱 화면·410 `NOTICE_WITHDRAWN`, 예측 미지원 거리 `TARGET_DISTANCE_UNSUPPORTED`·`predictionUnavailableReason`, 추천 대회 조건, 유효 접수 기간 규칙, 종목별 접수 기간 검증.

---
## 변경 이력
- 2026-10-21: v1 초안 작성 (T-011). PRD v1.1 기준 앱 API·관리자 API·에러·페이지네이션·요청 제한. 스키마 보완은 `04-db-schema.md` 변경 이력 참조
- 2026-10-21: v1.1 — PRD v1.2 대조 반영 (handoff `20261021-planner-developer-api-v1-prd-v1.2-gaps.md`). 공지 상세: 웹뷰 URL 삭제, `link` 필드, 내린 공지 410 `NOTICE_WITHDRAWN`. 예측 미지원 거리: 422 `TARGET_DISTANCE_UNSUPPORTED`, strategy `predictionUnavailableReason`, `RegistrationBrief.predictionSupported`·`eventDistanceM`, 스플릿 거리 무제한. 추천 대회 조건 명시. 유효 접수 기간 규칙(종목 기간 집계, 마감 없음 = 대회 전날까지, 참가자 N-03 종목 마감). 관리자 종목별 접수 기간 검증. `[PRD 변경 대기]`·`[PRD 확인]` 표시 정리
- 2026-10-21: T-016 구현 반영 — 공유 패키지 이름 `packages/shared`, 예측 `recordIds` 6개 이상은 스키마 400이 아니라 422 `LIMIT_EXCEEDED`로 통일, 예측 검사 순서·`NO_ELIGIBLE_RECORDS` 사유 판정·`recordIds` fieldErrors 코드, fieldErrors 코드 목록, Fastify 요청 오류 매핑. 구현 엔드포인트: `GET /health`(인증 없음, `/v1` 밖), `POST /me/predictions`, `POST /me/predictions/preview`
- 2026-10-21: v1.2 — D-019 반영 (handoff `20261021-planner-developer-entry-status.md`). `EntryStatus`·`EntryStatusSource`, `RegistrationBrief`·`Registration`에 `entryStatus`·`entryStatusUpdatedAt`, `POST /races/{id}/registration` 접수 상태 입력·서버 기본값, `PATCH /registrations/{id}` 접수 상태 변경(대회 당일까지), 409 `ALREADY_REGISTERED` → `ALREADY_PLANNED`, 1장 이름 규칙(내부 이름 `registration` 유지 근거). 설명 문장의 "참가 등록" → "참가 예정"
- 2026-10-21: v1.3 — PRD v1.5 반영. `GET /home/deadlines` 대상을 관심만 ∪ 참가 예정 `not_registered`로 변경 (오픈·마감 행 모두, N-01~N-03과 같은 규칙, 마감 행 시각은 N-03과 같은 기준). 응답 스키마 변경 없음. 대회 당일 변경 가능·앱의 `entryStatus` 항상 전송은 기존 명세와 같음을 표기
- 2026-10-21: T-018 구현 반영 — 대회 목록·상세 캐시 `no-store`(사용자별 `my` 포함), 목록 쿼리 불리언·메모리 필터 메모, 가입 201·중단 멱등, 참가 예정 서버 기본값일 때 접수 상태 시각·경로 null, `predictionId`·추가 전용 필드 의미, fieldErrors 코드 추가. 요청 스키마의 `.and(GoalInput)`은 같은 계약을 평평한 객체 + 검사로 구현 (`packages/shared/src/registrations.ts`). 구현 엔드포인트 목록은 README
- 2026-10-21: T-019 — PRD v1.6 반영: `PATCH /me/records/{id}` `confirmDuplicate`·409 `DUPLICATE_RECORD`, `POST /auth/social` `logged_in.reactivated`
- 2026-10-21: T-019 — 알림 목록 항목의 문구 출처(워커가 발송 시 렌더링해 payload에 저장) 메모
- 2026-10-21: T-020 구현 반영 — 알림 목록 정렬·표시 시각 `scheduled_at`, 에러 `RACE_IN_USE`, 관리자 API 구현 메모(세션·잠금 429·CSRF·감사 로그·If-Match·슬러그·종목 삭제·대표 출처·N-06c 요약·N-07)
- 2026-10-23: T-021 구현 반영 — `GET/PATCH /me/privacy`·`DELETE /me/device` 추가, 알림 설정 GET의 `marketingChangedAt`, 탈퇴 통계·연결 해제 작업 메모, next-race·recommended·관심·제보·예측 후보·strategy 구현 메모
- 2026-10-23: T-022 — `GET /home/next-race` missed 제외 (PRD v1.9)
- 2026-10-23: T-023 — 알림 kind `dormancy_notice`, refresh 회전 = 접속·휴면 계정 refresh 거절
- 2026-10-23: T-024 — `GET /auth/me` 응답에 `csrfToken` 추가
