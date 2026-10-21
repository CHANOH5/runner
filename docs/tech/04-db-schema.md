# 04. DB 스키마

- 담당: 개발자
- 상태: v1 초안 (검토 대기)
- DB: PostgreSQL 16 + PostGIS (D-006 확정)
- 관련: `../planning/02-features.md`, `../planning/04-policies.md`

---

## 1. 도메인 구성

| 도메인 | 테이블 | 단계 |
|---|---|---|
| 계정 | `users`, `auth_identities`, `auth_sessions`, `user_profiles`, `privacy_settings`, `devices` | 1 |
| 동의 | `terms_versions`, `user_consents` | 1 |
| 대회 | `races`, `race_events`, `race_sources`, `race_candidates`, `race_reports` / `race_courses` | 1 / 2 (코스 경로는 PRD 9장에 따라 Phase 2) |
| 참가 | `race_interests`, `race_registrations` / `registration_verifications` | 1 / 2 (참가 인증은 Phase 2) |
| 기록·예측 | `run_records`, `predictions` | 1 |
| 소셜 | `friendships`, `blocks`, `pace_groups`, `pace_group_members`, `meetups`, `reports` | 2 |
| 라이브 | `location_consents`, `live_sessions`, `live_session_viewers`, `cheer_links`, `location_points`, `location_access_logs`, `cheers` | 3 |
| 알림 | `notification_settings`, `notification_schedules`, `notifications`, `notices` | 1 |
| 결제 | `subscriptions` | 4 |
| 운영 | `admin_users`, `admin_audit_logs`, `deletion_jobs`, `social_unlink_jobs`, `account_deletion_stats`, `app_configs` | 1 |

> **구현 (T-016)**: Phase 1 테이블 27개는 `server/src/db/schema/`(Drizzle)와 `server/src/db/migrations/`에 있다. 이 문서와 코드가 다르면 코드에 맞춰 이 문서를 고친다.
> - 마이그레이션: `0000` PostGIS 확장 → `0001` 테이블(drizzle-kit 생성) → `0002` 공간 컬럼(raw SQL, `races.venue_point`). 공간 컬럼은 Drizzle 스키마에 두지 않는다.
> - UUID v7은 애플리케이션이 만든다 (PostgreSQL 16에 `uuidv7()` 없음). 제약·인덱스 이름은 코드에 명시했다 (예: `user_profiles_nickname_lower_key`).
> - 이 문서 SQL에 없던 인덱스 1개 추가: `predictions (user_id, created_at DESC)` — 최근 예측 목록 정렬 (tech/06 4장).

## 2. ERD (핵심 관계)

```
users ─1:N─ auth_identities
  │ 1:1 user_profiles, privacy_settings
  │ 1:N user_consents ── terms_versions
  │
  ├─1:N─ race_interests ──N:1─┐
  ├─1:N─ race_registrations ──N:1── race_events ──N:1── races ──1:N── race_sources
  │          │ 1:N registration_verifications     │ 1:1 race_courses (PostGIS)
  │          │ 1:1 live_sessions (대회당)            │
  │          │        │ 1:N location_points        └─1:N── pace_groups ─1:N─ pace_group_members
  │          │        │ 1:N live_session_viewers / cheer_links / cheers
  │          │        │ 1:N location_access_logs
  │          └ 1:N predictions
  ├─1:N─ run_records
  ├─N:N─ friendships (users ↔ users)
  └─N:N─ blocks (users ↔ users)
```

## 3. 테이블 정의

> 공통 규칙: PK는 `uuid` (UUID v7, 시간 정렬), 모든 테이블에 `created_at`, `updated_at` (timestamptz). 삭제는 탈퇴 파기 정책(P-RET)에 따라 **실제 삭제(hard delete)** 를 원칙으로 하고, 보존 대상만 별도 테이블에 남긴다.

### 3.1 계정

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY,
  email           text,                         -- 소셜에서 받은 이메일, 비공개 (P-PRI-02)
  status          text NOT NULL DEFAULT 'active', -- active | dormant | suspended | deleted
  birth_year      smallint NOT NULL,            -- 만 14세 확인용 (P-ACC-01)
  last_login_at   timestamptz,
  records_changed_at timestamptz,              -- 기록 추가·수정·삭제 시각 → 예측 "기록이 바뀌었어요" 판단 (PRD 6.14)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        text NOT NULL,                -- kakao | apple | google
  provider_uid    text NOT NULL,
  revoke_token_enc bytea,                       -- Apple refresh token (암호화). 탈퇴 시 revoke용 (F-072). 카카오·Google은 null
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname        varchar(12) NOT NULL,
  nickname_changed_at timestamptz,              -- 7일 1회 변경 제한 (PRD 4.3)
  avatar_url      text,
  gender          text,                         -- male | female | null(미입력)
  region_code     text,                         -- 시·도 코드
  running_since   smallint,                     -- 러닝 시작 연도
  bio             varchar(100),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON user_profiles (lower(nickname)); -- "Runner" = "runner" 중복 (PRD 4.3)

-- 항목별 공개 범위 (P-PRI-03)
CREATE TABLE privacy_settings (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_visibility       text NOT NULL DEFAULT 'participants', -- public | participants | friends | private
  gender_visibility    text NOT NULL DEFAULT 'private',
  region_visibility    text NOT NULL DEFAULT 'participants',
  records_visibility   text NOT NULL DEFAULT 'friends',
  listed_in_participants boolean NOT NULL DEFAULT false,     -- 참가자 목록 노출 (P-PRI-04)
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL,                -- ios | android
  push_token      text,
  app_version     text,
  last_seen_at    timestamptz
);
CREATE UNIQUE INDEX ON devices (push_token) WHERE push_token IS NOT NULL;

-- refresh token (회전). 기기당 1개 세션, 재사용 감지 시 family 전체 폐기 (tech/06 인증)
CREATE TABLE auth_sessions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES devices(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,                -- 최초 로그인 시 생성, 회전해도 유지
  token_hash      bytea NOT NULL UNIQUE,        -- refresh token SHA-256
  expires_at      timestamptz NOT NULL,         -- 30일
  rotated_at      timestamptz,                  -- 새 토큰으로 교체된 시각 (재사용 감지)
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_sessions (user_id);
```

### 3.2 동의

```sql
CREATE TABLE terms_versions (
  id              uuid PRIMARY KEY,
  kind            text NOT NULL,   -- service | privacy | location | marketing | night_push
  version         text NOT NULL,
  required        boolean NOT NULL,
  content_url     text NOT NULL,
  effective_at    timestamptz NOT NULL,
  UNIQUE (kind, version)
);

-- 동의·철회 이력은 행을 추가하는 방식(append-only)으로 남긴다
CREATE TABLE user_consents (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,              -- 탈퇴 후 법정 보존 대상이므로 FK 없이 보관 [확인 필요]
  terms_version_id uuid NOT NULL REFERENCES terms_versions(id),
  action          text NOT NULL,              -- agree | withdraw
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON user_consents (user_id, terms_version_id, created_at DESC);
```

### 3.3 대회

```sql
CREATE TABLE races (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  organizer       text,
  region_code     text NOT NULL,
  venue_name      text,
  venue_address   text,
  venue_point     geography(Point, 4326),       -- 관리자 웹에서 NCP Geocoding으로 채움, 수동 수정 가능 (D-008)
  race_date       date NOT NULL,
  timezone        text NOT NULL DEFAULT 'Asia/Seoul',
  registration_opens_at  timestamptz,
  registration_opens_time_known boolean NOT NULL DEFAULT true, -- false면 opens_at은 오픈일 00:00 KST, 시각 미정 (N-02는 09:00)
  registration_closes_at timestamptz,
  course_url      text,                         -- 공식 코스 안내 링크 (코스 지도는 Phase 1 앱 내 표시 안 함)
  status          text NOT NULL DEFAULT 'scheduled', -- scheduled | postponed | cancelled | finished (P-RACE-06)
  publish_status  text NOT NULL DEFAULT 'draft',     -- draft | published | hidden (검수 전 비공개, P-RACE-04 숨김)
  race_type       text NOT NULL DEFAULT 'road',      -- road | trail | ultra | track | virtual. Phase 1은 road만 게시 (D-013, 서버에서 게시 거부)
  registration_method text NOT NULL DEFAULT 'unknown', -- first_come | lottery | unknown
  dedupe_key      text NOT NULL,                     -- 정규화 대회명 + 대회일 (중복 경고용. 저장은 허용 — PRD 8.4)
  official_url    text,
  registration_url text,
  last_verified_at timestamptz,                 -- 최종 확인일 (P-RACE-02). 신규 작성 시 now(), 복제 초안은 null. 게시 시 필수
  cloned_from     uuid REFERENCES races(id) ON DELETE SET NULL, -- 복제 원본 (PRD 8.4.4)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (publish_status <> 'published'
         OR (official_url IS NOT NULL AND last_verified_at IS NOT NULL)) -- 게시 조건 일부. 종목·출처·도로 대회 한정(D-013)은 서버 검사
);
CREATE INDEX ON races (race_date);
CREATE INDEX ON races (region_code, race_date);
CREATE INDEX ON races (registration_opens_at);
CREATE INDEX ON races (dedupe_key);

-- 종목 (5K / 10K / Half / Full ...)
CREATE TABLE race_events (
  id              uuid PRIMARY KEY,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  name            text NOT NULL,                -- "하프코스"
  category        text NOT NULL,                -- 5k | 10k | half | full | other (PRD 3.3, 관리자 지정)
  distance_m      integer NOT NULL,             -- 21097
  start_at        timestamptz,
  time_limit_min  integer,                      -- 제한 시간 (P-LOC-03, 32 계산용)
  fee_krw         integer,
  capacity        integer,
  registration_opens_at  timestamptz,           -- 종목별 접수 기간이 대회와 다를 때만 (null이면 races 값 사용)
  registration_closes_at timestamptz
);
CREATE INDEX ON race_events (race_id);

-- 코스 (PostGIS)
CREATE TABLE race_courses (
  race_event_id   uuid PRIMARY KEY REFERENCES race_events(id) ON DELETE CASCADE,
  route           geography(LineString, 4326) NOT NULL,
  finish_point    geography(Point, 4326) NOT NULL,
  elevation_gain_m integer,
  share_radius_m  integer NOT NULL DEFAULT 1000, -- 노출 허용 반경 (P-LOC-04)
  source          text                           -- gpx 업로드 | 주최사 | 수동
);
CREATE INDEX ON race_courses USING gist (route);

CREATE TABLE race_sources (
  id              uuid PRIMARY KEY,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  source_kind     text NOT NULL,                -- official | organizer | aggregator | news | user_report | manual (05-race-data-sourcing.md)
  source_name     text NOT NULL,                -- "공식 홈페이지" | 수집기 이름 | "제보"
  source_url      text,
  external_id     text,                         -- 출처 쪽 식별자 (예: 집계 사이트 글 번호)
  is_primary      boolean NOT NULL DEFAULT false, -- 앱에 "출처"로 표시할 대표 출처 (P-RACE-02)
  content_hash    text,                         -- 마지막으로 가져온 본문 해시 (변경 감지용, 원문은 저장하지 않음)
  fetched_at      timestamptz,                  -- 확인 일시. null = 아직 확인 안 함 (복제 초안). 게시 시 대표 출처는 필수
  last_checked_at timestamptz,
  last_changed_at timestamptz
);
CREATE UNIQUE INDEX ON race_sources (race_id) WHERE is_primary;

-- 수집기·주최사·운영자가 올린 신규/변경 후보. 승인되어야 races에 반영 (T-012)
CREATE TABLE race_candidates (
  id              uuid PRIMARY KEY,
  race_id         uuid REFERENCES races(id) ON DELETE CASCADE, -- null이면 신규 대회 후보
  origin          text NOT NULL,                -- crawler | organizer | admin
  source_url      text,
  proposed        jsonb NOT NULL,               -- 추출한 사실 필드만 (대회명, 일시, 장소, 종목, 참가비, 접수기간)
  diff            jsonb,                        -- 기존 값과 달라진 필드
  status          text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | duplicate
  reviewed_by     uuid,                         -- admin_users.id
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON race_candidates (status, created_at);

CREATE TABLE race_reports (                     -- 정보 오류 제보 (F-016)
  id              uuid PRIMARY KEY,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  field           text,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'open', -- open | applied | rejected
  resolution_note text,                         -- 반려 사유 템플릿 코드 또는 직접 입력 (N-07b)
  resolved_by     uuid,                         -- admin_users.id
  resolved_at     timestamptz,                  -- 72시간 처리 KPI (PRD 2.2)
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.4 참가

```sql
CREATE TABLE race_interests (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, race_id)
);

CREATE TABLE race_registrations (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  race_event_id   uuid NOT NULL REFERENCES race_events(id) ON DELETE CASCADE,
  goal_time_sec   integer,
  goal_pace_sec_per_km integer,                    -- 앱 서버가 goal_time_sec와 종목 거리로 계산해 저장
  goal_source     text NOT NULL DEFAULT 'none',    -- prediction | manual | none (API Registration.goalSource). CHECK: none ⇔ goal_time_sec IS NULL
  verification_level smallint NOT NULL DEFAULT 0, -- 0: 자가 | 1: 배번 | 2: 공식 (P-VER)
  finish_time_sec integer,                         -- Phase 4 결과 입력
  status          text NOT NULL DEFAULT 'planned', -- planned | finished | dns | dnf
  -- 접수 상태: 사용자가 기록하는 공식 접수 여부 (D-019, PRD 4.10.1). 참가 인증(verification_level)과 별개
  entry_status    text NOT NULL DEFAULT 'not_registered'
                  CHECK (entry_status IN ('not_registered', 'registered', 'missed')),
  entry_status_updated_at timestamptz,             -- 상태를 바꾼 시각 (생성 시 기본값이면 null). KPI "7일 안 접수 완료 기록률"
  entry_status_source text
                  CHECK (entry_status_source IN ('form', 'return_prompt', 'race_detail', 'my_races')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, race_id)                        -- 대회당 한 종목 (P-VER-04)
);
CREATE INDEX ON race_registrations (race_event_id, goal_pace_sec_per_km);
CREATE INDEX ON race_registrations (race_id, entry_status);  -- 알림 대상 확정 (03-architecture 7장)
```
> **이름 규칙 (D-019)**: `race_registrations`는 화면 용어로 **참가 예정**이다 (앱에서 "이 대회 종목에 나간다"는 표시). 실제 대회 접수 여부는 `entry_status`로 따로 기록한다. `races.registration_opens_at` 등 `races`의 `registration_*`은 **공식 접수 기간**이다. 내부 이름을 바꾸지 않는 이유는 `06-api.md` 1장 "이름 규칙" 참고.
>
> `entry_status` 기본값: 생성 요청에 값이 없으면 서버가 대회 유효 접수 기간이 마감(`closed`)이면 `registered`, 그 외 `not_registered`로 정한다 (PRD 4.10 3-1). 생성 시 `missed`는 받지 않는다. 생성 시 값은 `entry_status_updated_at = created_at`, `entry_status_source = 'form'`으로 기록하고, 서버 기본값을 쓴 경우만 둘 다 null로 둔다.
> `goal_pace_sec_per_km`는 종목 거리(`race_events.distance_m`)가 다른 테이블에 있어 생성 컬럼으로 만들 수 없다. 그래서 목표 기록을 저장할 때 애플리케이션이 계산한다. 페이스 그룹 배정(F-032)에 쓰인다.

```sql
CREATE TABLE registration_verifications (
  id              uuid PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES race_registrations(id) ON DELETE CASCADE,
  method          text NOT NULL,                -- bib_photo | official
  photo_s3_key    text,                         -- 인증 후 30일 파기 (P-PRI-06)
  status          text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.5 기록 · 예측

```sql
CREATE TABLE run_records (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance_m      integer NOT NULL,
  duration_sec    integer NOT NULL,
  run_date        date NOT NULL,
  category        text NOT NULL,                -- 5k | 10k | half | full | other (PRD 3.3)
  kind            text NOT NULL,                -- race | training
  race_registration_id uuid REFERENCES race_registrations(id) ON DELETE SET NULL,
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON run_records (user_id, run_date DESC);

CREATE TABLE predictions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_registration_id uuid REFERENCES race_registrations(id) ON DELETE SET NULL,
  target_distance_m integer NOT NULL,
  predicted_sec   integer NOT NULL,
  range_min_sec   integer NOT NULL,
  range_max_sec   integer NOT NULL,
  confidence      text NOT NULL,                -- high | medium | low (P-PRED-02)
  model_version   text NOT NULL,                -- "riegel-1.06-v1"
  input_snapshot  jsonb NOT NULL,               -- 사용한 기록·가중치, 예측일, 신뢰도 사유, 범위 단위 등 (server modules/predictions/service.ts PredictionSnapshot)
  splits          jsonb,                        -- 구간 스플릿
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON predictions (user_id, created_at DESC);
```

### 3.6 소셜 (Phase 2)

```sql
CREATE TABLE friendships (
  requester_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending', -- pending | accepted (P-COM-01)
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE TABLE blocks (
  blocker_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX ON blocks (blocked_id);

CREATE TABLE pace_groups (
  id              uuid PRIMARY KEY,
  race_event_id   uuid NOT NULL REFERENCES race_events(id) ON DELETE CASCADE,
  pace_min_sec    integer NOT NULL,             -- 330 (5'30")
  pace_max_sec    integer NOT NULL,             -- 344 (5'44")
  UNIQUE (race_event_id, pace_min_sec)
);

CREATE TABLE pace_group_members (
  pace_group_id   uuid NOT NULL REFERENCES pace_groups(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pace_group_id, user_id)
);

CREATE TABLE meetups (                           -- 출발 전 만남 제안 (F-035, P-COM-05)
  id              uuid PRIMARY KEY,
  pace_group_id   uuid NOT NULL REFERENCES pace_groups(id) ON DELETE CASCADE,
  host_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_code       text NOT NULL,                -- 대회장 지정 지점만 (자유 주소 불가)
  meet_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id              uuid PRIMARY KEY,
  reporter_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id  uuid NOT NULL,
  reason          text NOT NULL,                -- spam | harassment | impersonation | fake_entry | profile | stalking
  detail          text,
  status          text NOT NULL DEFAULT 'open', -- open | actioned | dismissed
  priority        smallint NOT NULL DEFAULT 0,  -- stalking = 최우선 (P-COM-04)
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.7 라이브 (Phase 3) — 가장 민감한 영역

```sql
-- 대회별 위치 공유 설정 (P-LOC-01, 10)
CREATE TABLE location_consents (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_registration_id uuid NOT NULL REFERENCES race_registrations(id) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT 'friends', -- private | friends | friends_participants
  allowed_friend_ids uuid[] NOT NULL DEFAULT '{}', -- 이번 대회에 정확 위치를 볼 친구 (P-LOC-11)
  agreed_at       timestamptz NOT NULL,
  withdrawn_at    timestamptz,
  UNIQUE (race_registration_id)
);

CREATE TABLE live_sessions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_registration_id uuid NOT NULL REFERENCES race_registrations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'active', -- active | ended
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  end_reason      text,     -- user_stop | finish_detected | time_limit | left_course | permission_revoked | account_deleted
  last_point_at   timestamptz,
  last_distance_m integer
);
CREATE UNIQUE INDEX ON live_sessions (user_id) WHERE status = 'active'; -- 동시에 한 세션만

-- 응원 링크 (P-LOC-20~23)
CREATE TABLE cheer_links (
  id              uuid PRIMARY KEY,
  live_session_id uuid,                          -- 세션 시작 전에 미리 만들 수 있음
  race_registration_id uuid NOT NULL REFERENCES race_registrations(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,         -- 원본 토큰은 저장하지 않음
  label           text,                          -- "엄마", "회사 동료"
  view_count      integer NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 위치 원본: 시간 기준 파티션, 7일 후 파티션 단위 삭제 (P-RET)
CREATE TABLE location_points (
  live_session_id uuid NOT NULL,
  recorded_at     timestamptz NOT NULL,
  point           geography(Point, 4326) NOT NULL,
  accuracy_m      real,
  course_distance_m integer,                     -- 코스 진행 거리 (서버 계산)
  in_share_radius boolean NOT NULL,              -- false면 시청자에게 배포 안 함 (P-LOC-04)
  PRIMARY KEY (live_session_id, recorded_at)
) PARTITION BY RANGE (recorded_at);
-- 일 단위 파티션 생성은 Worker가 담당 (pg_partman 검토)

-- 실시간 시청 기록 (친구·참가자)
CREATE TABLE live_session_viewers (
  live_session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  viewer_user_id  uuid,                          -- 응원 링크 시청이면 null
  cheer_link_id   uuid REFERENCES cheer_links(id) ON DELETE CASCADE,
  access_level    text NOT NULL,                 -- precise | coarse
  first_viewed_at timestamptz NOT NULL,
  last_viewed_at  timestamptz NOT NULL
);

-- 위치정보 이용·제공 사실 확인자료 (P-LOC-43) — 좌표를 넣지 않음, append-only
CREATE TABLE location_access_logs (
  id              bigserial PRIMARY KEY,
  subject_user_id uuid NOT NULL,                 -- 위치정보 주체 (탈퇴 후에도 법정 보존 [확인 필요])
  recipient_type  text NOT NULL,                 -- friend | cheer_link | participant | system
  recipient_ref   text,                          -- 사용자 id 또는 cheer_link id
  purpose         text NOT NULL,                 -- live_share | coarse_share | finish_detection
  provided_at     timestamptz NOT NULL DEFAULT now(),
  live_session_id uuid
);
CREATE INDEX ON location_access_logs (subject_user_id, provided_at DESC);

CREATE TABLE cheers (                            -- 응원 메시지 (F-046, P-COM-06)
  id              uuid PRIMARY KEY,
  live_session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  from_user_id    uuid,
  cheer_link_id   uuid,
  preset_code     text NOT NULL,                 -- 정해진 문구만
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.8 알림 · 결제 · 운영

```sql
CREATE TABLE notification_settings (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  registration_alerts boolean NOT NULL DEFAULT true,
  dday_alerts     boolean NOT NULL DEFAULT true,
  social_alerts   boolean NOT NULL DEFAULT true,
  marketing       boolean NOT NULL DEFAULT false,  -- 별도 동의 (P-NOTI-01)
  night_marketing boolean NOT NULL DEFAULT false
);

-- 대회 단위 알림 예약표 (N-01~N-05). 대회 저장 시 계산, 사용자별 행은 발송 30분 전에 만든다 (03-architecture 6장)
CREATE TABLE notification_schedules (
  id              uuid PRIMARY KEY,
  race_id         uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  race_event_id   uuid REFERENCES race_events(id) ON DELETE CASCADE, -- 종목별 마감(N-03 참가 예정자)일 때만
  kind            text NOT NULL,                -- reg_open_d1 | reg_open_soon | reg_close_d1 | race_d7 | race_d1
  scheduled_at    timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | materialized | done | cancelled
  UNIQUE NULLS NOT DISTINCT (race_id, race_event_id, kind)
);
CREATE INDEX ON notification_schedules (scheduled_at) WHERE status = 'pending';

CREATE TABLE notifications (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id         uuid REFERENCES races(id) ON DELETE CASCADE,  -- 공지(N-08)면 null
  notice_id       uuid,                          -- N-08이면 notices.id
  kind            text NOT NULL,
  payload         jsonb NOT NULL,
  scheduled_at    timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled', -- scheduled | sent | cancelled | failed
  push_group_key  text,                          -- 묶음 발송 키 (user_id + kind + scheduled_at)
  sent_at         timestamptz,                   -- 서버가 Expo에 넘긴 시각 (D-018). 앱 내만(기기 없음)이면 null
  attempt_count   smallint NOT NULL DEFAULT 0,   -- 푸시 실패 횟수 (1분 간격 최대 3회 재시도)
  next_attempt_at timestamptz,                   -- 다음 시도 시각 / 워커 임대 만료 시각
  last_error      text,                          -- 마지막 실패 사유, 앱 내만이면 no_device (A-002 집계)
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON notifications (user_id, race_id, kind, scheduled_at) WHERE race_id IS NOT NULL; -- 중복 방지 (PRD 7.1)
CREATE INDEX ON notifications (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX ON notifications (user_id, created_at DESC);

-- 공지·마케팅 푸시 (A-008, N-08)
CREATE TABLE notices (
  id              uuid PRIMARY KEY,
  kind            text NOT NULL,                 -- notice | marketing
  title           varchar(30) NOT NULL,          -- marketing은 "(광고) " 자동 접두
  body            varchar(500) NOT NULL,
  send_push       boolean NOT NULL DEFAULT false,
  link_type       text NOT NULL,                 -- notice | race | race_list
  link_race_id    uuid REFERENCES races(id) ON DELETE SET NULL,
  scheduled_at    timestamptz,                   -- null = 승인 즉시
  status          text NOT NULL DEFAULT 'draft', -- draft | approved | sent | withdrawn
  created_by      uuid NOT NULL,                 -- admin_users.id (operator)
  approved_by     uuid,                          -- admin_users.id (owner)
  approved_at     timestamptz,
  sent_count      integer,
  failed_count    integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'marketing' OR scheduled_at IS NULL
         OR (scheduled_at AT TIME ZONE 'Asia/Seoul')::time BETWEEN '08:00' AND '20:59:59') -- P-NOTI-02
);

-- 탈퇴 시 외부 소셜 연결 해제 재시도 큐 (F-072). 성공·최종 실패 시 즉시 삭제, 최대 7일 [확인 필요]
CREATE TABLE social_unlink_jobs (
  id              bigserial PRIMARY KEY,
  provider        text NOT NULL,                 -- kakao | apple
  provider_uid    text NOT NULL,
  revoke_token_enc bytea,                        -- Apple만
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 탈퇴 사유 통계 — user_id·시각 없이 날짜만 (PRD 4.15)
CREATE TABLE account_deletion_stats (
  id              bigserial PRIMARY KEY,
  reason_code     text,                          -- no_races | too_many_alerts | bad_prediction | other_app | privacy | other
  reason_text     varchar(200),
  deleted_on      date NOT NULL
);

-- 원격 설정 (강제 업데이트 등). owner만 수정
CREATE TABLE app_configs (
  key             text PRIMARY KEY,              -- min_native_version_ios | min_native_version_android | ...
  value           jsonb NOT NULL,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (                     -- Phase 4
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan            text NOT NULL,                 -- runner_pro | race_pass | crew
  store           text NOT NULL,                 -- app_store | play_store
  store_tx_id     text NOT NULL UNIQUE,
  status          text NOT NULL,
  current_period_end timestamptz
);

CREATE TABLE admin_users (
  id              uuid PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  role            text NOT NULL,                 -- owner | operator | viewer
  password_hash   text NOT NULL,                 -- argon2id
  totp_secret_enc bytea NOT NULL,                -- TOTP 필수 (PRD 8.2)
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until    timestamptz,                   -- 5회 실패 시 15분
  disabled_at     timestamptz,
  mfa_enabled     boolean NOT NULL DEFAULT true
);

CREATE TABLE admin_audit_logs (
  id              bigserial PRIMARY KEY,
  admin_id        uuid NOT NULL,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  memo            text,                          -- 예: "주최 측 요청", 복제 원본 id (PRD 8.4)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deletion_jobs (                     -- 파기 배치 실행 기록 (P-RET-01)
  id              bigserial PRIMARY KEY,
  job_name        text NOT NULL,
  deleted_count   integer NOT NULL,
  ran_at          timestamptz NOT NULL DEFAULT now()
);
```

## 4. Redis 키 (라이브)

| 키 | 값 | TTL |
|---|---|---|
| `live:session:{id}:latest` | 최신 좌표, 거리, 페이스, 예상 도착 | 세션 종료 시 즉시 삭제, 안전장치로 TTL 6시간 |
| `live:event:{raceEventId}:coarse` | Hash: userId → {닉네임, 구간 km, 페이스 그룹} | 대회 종료 + 1시간 |
| 채널 `session:{id}:precise` | 정확 위치 배포 | — |
| 채널 `race:{raceEventId}:coarse` | 대략 구간 배포 (좌표 없음) | — |

## 5. 파기 배치 (Worker, 매일 04:00)

| 대상 | 조건 | 정책 |
|---|---|---|
| `location_points` 파티션 | 7일 경과 | P-RET |
| `registration_verifications.photo_s3_key` | 승인·반려 후 30일 | P-PRI-06 |
| `cheer_links` | 만료 후 30일 | P-RET |
| `live_session_viewers` | 30일 경과 | P-RET |
| `location_access_logs` | 법정 보존 기간 경과 [확인 필요] | P-LOC-43 |
| 휴면 계정 | 1년 미접속 (30일 전 안내) | P-RET-03 |
| `notifications` | 생성 후 90일 | P-RET (PRD 7.1) |
| `notification_schedules` | `done`·`cancelled` 후 90일 | — |
| `social_unlink_jobs` | 생성 후 7일 (성공 시 즉시 삭제) | F-072 [확인 필요] |

---
## 변경 이력
- 2026-10-21: v1 초안 작성
- 2026-10-21: T-012 반영 — `races`에 `publish_status`, `race_type`, `registration_method`, `dedupe_key` 추가 / `race_events`에 종목별 접수 기간 추가 / `race_sources`에 출처 종류·대표 출처·변경 감지 컬럼 추가 / `race_candidates`(수집 검수 대기열) 신규. 근거: `05-race-data-sourcing.md` 5장
- 2026-10-21: Phase 1 PRD 요청 반영 (handoff `20261021-planner-developer-phase1-prd-questions.md` B) — `races`: `venue_address`, `registration_opens_time_known`, `course_url` 추가, `dedupe_key` 유니크 해제(중복은 경고만) / `race_events.category` / `user_profiles.nickname_changed_at` + `lower(nickname)` 유니크 / `race_reports` 처리 컬럼 / `auth_identities.revoke_token_enc` / `notifications` 확장 + `notification_schedules`, `notices`, `social_unlink_jobs`, `account_deletion_stats`, `app_configs` 신규 / 파기 배치 3건 추가
- 2026-10-21: 관리자 빠른 입력 반영 (handoff `20261021-planner-developer-venue-map-admin-input.md`) — `races.last_verified_at`, `race_sources.fetched_at` nullable(게시 시 필수), `races.cloned_from` 추가, `races`에 게시 조건 CHECK 추가
- 2026-10-21: API 명세(T-011) 작성 중 보완 — `auth_sessions`(refresh token 회전) 신규, `users.records_changed_at`, `run_records.category`·`updated_at`, `devices.push_token` 유니크, `admin_users` 인증 컬럼, `admin_audit_logs.memo`
- 2026-10-21: T-016 구현 반영 — `race_courses`·`registration_verifications`를 Phase 2로 표시(PRD 9장과 정합), 구현 위치·마이그레이션 순서 메모, `predictions (user_id, created_at DESC)` 인덱스 추가, `input_snapshot` 내용 명시
- 2026-10-21: D-019 반영 (handoff `20261021-planner-developer-entry-status.md`) — `race_registrations`에 `entry_status`(CHECK, 기본 `not_registered`)·`entry_status_updated_at`·`entry_status_source`(CHECK) 추가, `(race_id, entry_status)` 인덱스. 설명 문장의 "참가 등록" → "참가 예정". 테이블 이름은 유지 (이름 규칙 메모 추가)
- 2026-10-21: T-018 구현 — 마이그레이션 `0003_entry_status.sql`로 `entry_status`·`entry_status_updated_at`·`entry_status_source`·`(race_id, entry_status)` 인덱스 적용. API 응답 `Registration.goalSource`를 저장할 곳이 없어 **`goal_source` 컬럼 추가** (CHECK: 값 3개 + `none` ⇔ 목표 없음). 기존 행은 목표가 있으면 `manual`로 채움
- 2026-10-21: T-019 — `notifications`에 `attempt_count`·`next_attempt_at`·`last_error` 추가 (마이그레이션 `0004_notification_delivery.sql`). `payload`에 렌더링한 `title`·`body`·`deepLink`, `scheduleId`, `raceEventId`, `registrationId`, 푸시 티켓 요약을 둔다
