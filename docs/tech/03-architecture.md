# 03. 시스템 아키텍처

- 담당: 개발자
- 상태: v1.1 — D-005~D-008 반영 (2026-10-21)
- 관련: `02-tech-stack.md`, `04-db-schema.md`, `../planning/04-policies.md`

---

## 1. 전체 구조

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  모바일 앱     │   │  응원 웹 (W)   │   │  관리자 웹     │
│  Expo / RN   │   │  Next.js     │   │  Next.js     │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │ HTTPS / WSS       │ WSS (토큰)        │ HTTPS (관리자 인증)
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│                 API Gateway / ALB                         │
└──────┬─────────────────────┬─────────────────────┬───────┘
       ▼                     ▼                     ▼
┌──────────────┐   ┌───────────────────┐   ┌──────────────┐
│  Core API    │   │  Live Service     │   │  Admin API   │
│  (Fastify)   │   │  위치 수신·정책 적용  │   │              │
│  계정/대회/    │   │  ·구독 배포         │   │              │
│  예측/소셜     │   └──┬──────────┬─────┘   └──────────────┘
└──┬───────┬───┘      │          │
   │       │          ▼          ▼
   │       │   ┌───────────┐  ┌──────────────────┐
   │       │   │  Redis    │  │ 위치 확인자료 로그   │
   │       │   │ 최신 위치  │  │ (location_access_ │
   │       │   │ Pub/Sub   │  │  logs)           │
   │       │   └───────────┘  └──────────────────┘
   ▼       ▼
┌────────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ PostgreSQL+PostGIS │   │ Worker (BullMQ)  │   │ S3               │
│ (RDS)              │◀──│ 푸시 발송, 파기 배치 │   │ 배번 사진, 코스 파일 │
└────────────────────┘   │ 대회 수집, 예측 갱신 │   └──────────────────┘
                         └──────────────────┘
```

## 2. 서버 구성 요소

| 구성 요소 | 책임 | 단계 |
|---|---|---|
| Core API | 인증, 사용자, 대회, 참가 예정(접수 상태 포함), 기록, 예측, 소셜 | 1~ |
| Admin API | 대회 관리, 제보·신고·인증 처리 | 1~ |
| Worker | 푸시 발송 큐, 접수 오픈 알림 스케줄, **데이터 파기 배치**, 대회 데이터 수집 | 1~ |
| Live Service | 위치 수신, 정책 적용(P-LOC), 시청자별 데이터 가공, 실시간 배포 | 3 |

> 초기에는 Core API, Admin API, Worker를 **하나의 코드베이스(모듈 분리)** 로 운영한다. Live Service는 대회 당일 부하 특성이 다르므로 **별도 프로세스**로 배포한다.

## 3. 실시간 위치 파이프라인 (Phase 3)

> D-007: 업로드는 **HTTPS 배치로 확정**. 시청 배포는 **WebSocket(Fastify + Redis Pub/Sub)으로 시작**하고, MQTT(AWS IoT Core) 전환은 백그라운드 위치 PoC·부하 테스트 후 Phase 2 종료 전에 결정한다. 아래 채널 이름은 전송 방식과 무관하다.

```
[러너 앱]
  │ 1) 5초마다 GPS 수집 → 로컬 버퍼(SQLite)
  │ 2) 10~15초마다 배치 POST /live/sessions/{id}/points
  ▼
[Live Service]
  │ 3) 검증: 세션 활성? 본인? 대회 시간 창 안? (P-LOC-03)
  │ 4) 정확도 필터, 좌표 → 코스 진행 거리 변환 (PostGIS)
  │ 5) 코스 반경 밖이면 → 저장만 하고 배포하지 않음 (P-LOC-04)
  │ 6) 자동 종료 조건 검사 (P-LOC-32)
  │ 7) Redis 최신 상태 갱신 + 원본은 location_points에 비동기 적재
  │ 8) 채널별 발행
  ▼
[채널 — 시청자에 따라 다른 데이터]
  · session:{id}:precise  → 승인한 친구, 응원 링크 소지자 : 좌표, 거리, 페이스, 예상 도착
  · race:{eventId}:coarse → L1 인증 참가자            : 닉네임, 1km 구간, 페이스 그룹 (좌표 없음)
  ▼
[시청자 구독 시] 권한 확인 → 구독 허용 → location_access_logs 기록 (P-LOC-43)
```

### 정책을 강제하는 지점
| 정책 | 강제 위치 |
|---|---|
| P-LOC-01, 02 기본 OFF, 수동 시작 | 세션 생성 API: `location_consents`에 해당 대회 동의가 없으면 거부 |
| P-LOC-03 시간 창 | 세션 생성·포인트 수신 시 대회 시간 검사 |
| P-LOC-11, 12 공개 범위 | 구독 시 권한 검사. coarse 채널에는 좌표 필드가 **아예 없음** |
| P-LOC-14 차단 | 구독 권한 검사 + coarse 데이터 발행 시 시청자별 필터 |
| P-LOC-31 즉시 중지 | 중지 API → Redis 키 삭제 → 채널에 `ended` 이벤트 → 구독 종료 |
| P-LOC-43 확인자료 | 구독 허용과 응원 링크 접속 시 자동 기록 |
| P-RET 파기 | Worker 일일 배치: 7일 지난 `location_points` 파티션 삭제 |

## 4. 인증 · 보안

| 항목 | 방식 |
|---|---|
| 사용자 인증 | 소셜 로그인 → 서버 자체 JWT 발급 (access 15분, refresh 30일, 회전). 신규 가입은 Redis 가입 세션(30분)을 거친다 (8장) |
| 응원 링크 | 128비트 랜덤 토큰, DB에는 해시만 저장 |
| 관리자 | 별도 계정, 2단계 인증, 접속 IP 제한, 작업 감사 로그 |
| 저장 데이터 암호화 | RDS·S3 저장 시 암호화, 배번 사진은 비공개 버킷 + 5분 서명 URL |
| 전송 구간 | TLS 1.2 이상 |
| 개인정보 접근 | 운영자 DB 직접 접근 금지, 관리자 도구로만 조회하고 조회 기록을 남김 |

## 5. 기록 예측 모듈

```
입력: 사용자 기록 목록, 목표 종목(거리), 대회 코스 정보(선택)
 1) 기록 선택: 최근 6개월, 목표 거리와 가까운 순 가중치
 2) 기본 예측: Riegel  T2 = T1 × (D2/D1)^1.06
 3) 여러 기록 → 가중 평균, 분산으로 범위 계산
 4) 보정 (Phase 2): 누적 상승 고도, 기온
 5) 신뢰도: 거리 비율, 기록 개수, 기록 최신성으로 높음/보통/낮음
출력: { 예상 기록, 범위(min~max), 신뢰도, 평균 페이스, 구간 스플릿 }
```
- 결과는 `predictions` 테이블에 입력값 스냅샷과 함께 저장한다. 결과 입력(Phase 4) 후 예측 오차를 분석해 모델을 개선한다.
- 구현: `server/src/modules/predictions/` — `model.ts`(버전별 상수 묶음), `engine.ts`(DB와 무관한 순수 계산), `service.ts`(대상 확인·기록 조회·저장), `index.ts`(라우트). 직접 고른 기록도 신뢰도는 각 기록의 거리 비율·최신성으로 판정한다.
- 상수·가중치는 `planning/05-prd-phase1.md` 5장 (D-010 `riegel-1.06-v1`). 상수 묶음은 `model_version`별 서버 설정으로 두고, 05 문서 5.7 예시 3개를 단위 테스트 기대값으로 고정한다 (예측일 2026-10-21).

## 6. 앱 지도 구조 (D-008)

Phase 1 사용처: 대회 상세(S-022)의 대회장 위치 지도. 코스 지도는 Phase 1에 앱 내 표시하지 않고 `races.course_url` 링크로 대신한다.

```
app/src/components/map/
├── MapView.tsx          ← 화면은 이것만 import (SDK 독립 props)
├── types.ts             ← LatLng, MapMarker, MapPolyline, CameraPosition, MapViewProps
├── naver/NaverMapView.tsx   ← @mj-studio/react-native-naver-map 구현 (현재)
└── (google/GoogleMapView.tsx ← 교체 시 추가)
```

| 원칙 | 내용 |
|---|---|
| SDK 격리 | 화면·훅은 네이버 SDK 타입·컴포넌트를 직접 쓰지 않는다. ESLint `no-restricted-imports`로 `map/` 밖에서의 SDK import 금지 |
| 최소 props | Phase 1은 `center`, `zoom`, `markers`, `onPressMarker`, `liteMode`(정적 표시)만. 폴리라인(코스)·사용자 위치는 Phase 3에 추가 |
| 좌표 | 앱·서버 모두 WGS84 `{ lat, lng }`. DB는 `geography(Point, 4326)` (`races.venue_point`) |
| 비용 관리 | 대회 상세 진입 시 지도는 화면에 보일 때만 마운트(지연 로딩). 리스트·캘린더에는 지도를 쓰지 않는다 (지도 로드 수 = 과금 단위) |
| 키 관리 | NCP Maps Client ID는 config plugin(`app.config.ts`)에 환경별로 주입. 관리자 웹의 Geocoding은 서버 측 키로만 호출 (앱에 넣지 않음) |
| 대체 표시 | `venue_point`가 없거나 지도 로드 실패 시 주소 텍스트 + "지도 앱에서 보기"(네이버 지도 앱 URL Scheme / 웹) |

관리자 웹(A-003): 장소 주소 입력 → 서버가 NCP Geocoding 호출 → 후보 선택 → `venue_point` 저장. 실패하면 위·경도 수동 입력 (국내 범위 검증).

## 7. 알림 파이프라인 (Phase 1, F-014)

```
[관리자 대회 저장] ──▶ notification_schedules 재계산 (대회 단위 N-01~N-05 예약 몇 줄)
                       │  상태 취소/연기/일정 변경 → N-06 즉시 발송 + 미발송 예약 cancelled
                       ▼
[Worker: 매분 스캔] scheduled_at − 30분 도달한 예약
   1) 대상 확정: 그 시점의 관심·참가 예정·접수 상태로 kind별 대상 규칙(아래 표) 적용 → notifications 행 생성 (status=scheduled, 유니크로 중복 방지)
   2) push_group_key로 같은 사용자·같은 kind·같은 시각 묶음
                       ▼
[Worker: scheduled_at 정각] (N-02는 오픈 −10분 정각)
   3) 발송 직전 확인: 알림 설정 / 대회 상태 / 대상 유효(관심·참가 예정·접수 상태를 대상 규칙으로 다시 판정) / 시각 조건 → 불충족 행 cancelled
   4) Expo Push 전송: 요청당 100건, 초당 600건 이하로 토큰 버킷 제한
   5) 실패 1분 간격 3회 재시도 → 그래도 실패면 failed (앱 내 알림은 남음), 무효 토큰은 devices.push_token 삭제
   6) 15분 뒤 receipt 확인 (Expo 권장)
```
**kind별 대상 규칙** (D-019, PRD 4.10.1·7.2). "관심만" = 관심 있음 + 참가 예정 없음. 참가 예정이 있으면 관심 여부와 무관하게 **접수 상태로만** 판정한다.

| kind | 대상 | SQL 조건 요약 |
|---|---|---|
| `reg_open_d1`, `reg_open_soon` (N-01·02) | 관심만 ∪ 참가 예정 `not_registered` | `(i.user_id IS NOT NULL AND r.id IS NULL) OR r.entry_status = 'not_registered'` |
| `reg_close_d1` (N-03) | 관심만 ∪ 참가 예정 `not_registered` (`registered`·`missed` 제외). 참가 예정자는 고른 종목의 마감 기준 예약 행(`race_event_id`)으로, 관심만 한 사용자는 대회 단위 행으로 받는다. 유효 마감이 없으면 예약 행 자체를 만들지 않는다 | 위와 같음 + 예약 행의 `race_event_id`가 있으면 `r.race_event_id` 일치 |
| `race_d7` (N-04) | 참가 예정 `not_registered`·`registered` (`missed` 제외). `not_registered` + 유효 접수 기간 마감이면 본문 변형, 딥링크 `berun://races/{id}` | `r.entry_status <> 'missed'` |
| `race_d1` (N-05) | 참가 예정 `not_registered`·`registered` | `r.entry_status <> 'missed'` |
| `race_cancelled`·`race_postponed`·`race_schedule_changed` (N-06) | 관심 ∪ 참가 예정 (접수 상태 무관), 대회일 ≥ 오늘 | 변경 없음 |

- 같은 N-01~N-03 대상 조건을 홈 접수 임박(`GET /home/deadlines`, tech/06 6.5)도 쓴다 — 한 함수로 둔다.
- 대상 확정 쿼리는 `race_interests i FULL JOIN race_registrations r ON (user_id, race_id)`를 대회 하나에 대해 돈다. `(race_id, entry_status)` 인덱스 사용 (tech/04).
- 접수 상태를 바꾼 시점이 대상 확정(−30분) 뒤면 행은 이미 만들어져 있으므로, 3) 발송 직전 확인에서 같은 규칙으로 다시 걸러 `cancelled` 처리한다.
- N-04 본문 변형 판정(`not_registered` + 마감)도 발송 직전 값으로 한다 (렌더링을 발송 시점에 다시 함).

- 정시성 KPI(N-02 99%)의 측정 기준은 **서버가 Expo Push에 넘긴 시각**. 대회 하나에 대상 약 10만 명까지 10분 창 안에 처리 가능 [추정 — 부하 테스트로 확인]. 넘으면 FCM/APNs 직접 발송으로 전환.
- 발송 워커는 2개 이상, BullMQ 반복 작업 + 분산 락. 서버 시계는 NTP 동기화.

**구현 (T-019, `server/src/modules/notifications/`, `server/src/worker/`)**

| 단계 | 구현 |
|---|---|
| 예약표 | `schedule.ts` `computeSchedules`(순수 함수) + `recalculateSchedules`. N-01 오픈 전날 19:00 / N-02 오픈 −10분(시각 미정이면 오픈일 09:00) / N-03 마감 전날 19:00 — 대회 단위 행 + **종목 마감이 따로 있는 종목마다 종목 행** / N-04 D-7 12:00 / N-05 전날 19:00. 지난 시각·취소·종료·미게시 대회는 만들지 않는다. 재계산: 시각이 같으면 그대로(보낸 것 재발송 없음), 바뀌면 확정된 미발송 알림 취소 후 새 시각으로 `pending`, 필요 없어진 행은 `cancelled` |
| 대상 | `audience.ts` 한 쿼리를 대상 확정과 발송 직전 재확인이 같이 쓴다. 공통 `users.status = 'active'`(휴면·정지 제외, P-RET-03), 해당 알림 설정 ON(행이 없으면 기본 ON). N-03 대회 단위 행 = 관심만 + 종목 마감이 따로 없는 접수 전 참가 예정자, 종목 행 = 그 종목의 접수 전. N-06 = 관심 ∪ 참가 예정(설정 무관) |
| 대상 확정 | `materializeDue`: `scheduled_at − 30분 ≤ 지금`인 `pending` 행을 `FOR UPDATE SKIP LOCKED`로 집어 `notifications` 생성(유니크로 중복 방지), 행은 `materialized` |
| 발송 | `sendDue`: 예약 시각이 된 알림을 임대(`next_attempt_at` = +5분)로 집는다 → 발송 직전 확인 → 그 시점 값으로 문구 렌더링(`render.ts`) → 그룹(`push_group_key` = 사용자·kind·예약 시각) 2건 이상이면 묶음 푸시(`berun://notifications`) → Expo 100건 배치 + 토큰 버킷 |
| 발송 직전 시각 조건 | 문구가 사실과 달라지면 보내지 않는다: N-01은 오픈 전날까지·오픈 전, N-03은 마감 전날까지·마감 전, N-02는 오픈 전(시각 미정이면 오픈일까지), N-04는 예약 시각부터 24시간 안, N-05는 대회 전날까지. 워커가 멈췄다 늦게 돈 경우도 같은 규칙 |
| 결과 | 성공 → `sent`, `sent_at` = Expo에 넘긴 시각(D-018). 기기 토큰 없음 → `sent`(앱 내만, `sent_at` null, `last_error = no_device`). `DeviceNotRegistered` → 토큰 삭제, 모든 기기가 무효면 `failed`. 그 밖의 실패 → 1분 뒤 재시도, 3회 재시도 후에도 실패면 `failed`(앱 내 알림은 남음). 처리가 끝난 예약 행은 `done` |
| N-06 | `handleRaceUpdated(raceId, { notify, changeSummary })` = 재계산 + 즉시 알림 생성. 관리자 API는 BullMQ `race-updated` 작업으로 넣는다(`enqueueRaceUpdated`) |
| 야간 | `canSendAt`: 마케팅만 08:00~20:59, 서비스 알림은 야간에도 (P-NOTI-05). 마케팅 발송(N-08)은 공지 작업에서 |
| 워커 | BullMQ 큐 `notifications`(prefix `berun`), 1분 `tick` = 대상 확정 + 발송. `pnpm --filter @berun/server worker`. `PUSH_DRY_RUN`(운영 외 기본 true)이면 Expo로 보내지 않는다. 여러 워커는 행 잠금·임대로 한 번만 처리(임대 만료 뒤 재처리 = 최소 1회 전달) |

- 남은 것: Expo receipt 확인(15분 뒤), 알림 90일 파기 배치, N-07 제보 결과, N-08 공지·마케팅, 알림 목록 API(`GET /me/notifications` — `payload.title/body/deepLink`를 그대로 쓰면 된다).
- 공지·마케팅(N-08, `notices`): owner 승인 → 예약 시각에 대상(전체 / 마케팅 동의자) 조회 후 같은 발송 경로. 마케팅은 08:00~20:59만 (DB CHECK + 발송 시 재확인).

## 8. 가입 · 탈퇴의 외부 연동 (F-001, F-072)

**가입 (만 14세 미만 정보 미보관)**
```
소셜 SDK 인증 → POST /auth/social  → provider 토큰 검증
   ├ 기존 계정 → JWT 발급
   └ 신규 → Redis signup:{랜덤 토큰} (TTL 30분): provider, provider_uid, email, Apple refresh token(암호화)
             → 앱은 랜덤 토큰만 보유 → S-003 → S-004
             → POST /auth/signup (토큰) → users 외 6개 테이블 한 트랜잭션 생성 → Redis 삭제
   중단(만 14세 미만·사용자 취소) → POST /auth/signup/abort → 카카오 unlink / Apple revoke → Redis 삭제
   만료(30분)                  → 지연 작업이 같은 연결 해제 수행
```
- 카카오는 우리 서버가 사용자 정보 API로 토큰을 검증하는 순간 앱 연결을 "가입 완료"로 유지하므로, 가입을 끝내지 않은 사용자는 **우리가 직접 unlink**해야 한다.
- Apple 인가 코드는 수명이 짧아 로그인 즉시 refresh token으로 교환한다. 가입 완료 시 `auth_identities.revoke_token_enc`에 암호화 저장 (KMS).

구현 (T-018, `server/src/modules/auth/`):
- provider 검증은 `SocialVerifier` 인터페이스(`verifiers.ts`). 카카오(토큰 정보로 앱 id 확인 → 사용자 정보), Google(ID 토큰 JWKS 검증, audience = `GOOGLE_CLIENT_IDS`), Apple(identity token JWKS 검증 + 인가 코드 교환). 실제 키로는 아직 확인하지 않았다 — 키 발급 후 수동 확인 필요. 통합 테스트는 가짜 verifier를 주입한다.
- 연결 해제 작업(`social_unlink_jobs`)은 **신규 소셜 로그인 시점에 "가입 만료 + 1분"으로 미리 넣는다**. Redis 만료에는 훅이 없어서다. 가입 중단·만 14세 미만이면 실행 시각을 지금으로 당기고, 가입이 끝나면 같은 소셜 계정의 대기 작업을 모두 지운다. Google은 작업을 만들지 않는다. 워커(다음 작업)는 해제 직전 `auth_identities`에 같은 계정이 없는지 다시 확인한다.
- Apple refresh token은 `TOKEN_ENC_KEY`(AES-256-GCM)로 암호화해 가입 세션·`auth_identities.revoke_token_enc`에 둔다. 운영은 KMS 데이터 키로 바꾼다.
- 기기: `X-Device-Id`를 `devices.id`로 쓴다. 다른 사용자가 쓰던 기기면 소유자를 바꾸고 푸시 토큰을 비운다. 같은 기기의 이전 세션은 로그인 시 폐기한다.

**탈퇴**
```
DB 트랜잭션: 사용자 데이터 즉시 파기 + race_reports.user_id = null + social_unlink_jobs 1행 기록 → 커밋 → 앱에 완료 응답
Worker: social_unlink_jobs 처리 — 카카오 unlink(어드민 키 + 회원번호), Apple revoke(refresh token)
         실패 시 지수 백오프로 최대 24시간 재시도, 성공·최종 실패 시 행 즉시 삭제 (최대 7일 [확인 필요])
```
- Google은 앱 로그인에서 ID 토큰만 받으므로 revoke하지 않는다 (사용자가 Google 계정 설정에서 해제 가능).
- 탈퇴 사유는 `account_deletion_stats`에 user_id·시각 없이 날짜만 저장.

## 9-0. 서버 코드 구조 (T-016)

```
server/src/
├── app.ts            buildApp({ config, db, redis }) — 의존성 주입, 테스트도 같은 함수 사용
├── server.ts         실행 진입점 (종료 시 연결 정리)
├── config/env.ts     환경 변수 Zod 검증 (실패하면 시작하지 않음, 값은 출력하지 않음)
├── db/               Drizzle 스키마, 마이그레이션, migrate·seed
├── lib/              AppError, 검증 에러 → fieldErrors 변환, KST 날짜
├── plugins/          에러 핸들러(tech/06 3장 형식), 인증(access token 검증 → request.auth)
└── modules/          health, auth, users, races, registrations, records, predictions, notifications, admin
                      (각 모듈 index.ts = Fastify 플러그인. 앱 API는 /v1, 관리자는 /api/admin/v1)
```
- 모든 응답에 `X-Request-Id`(UUID v7, 요청 헤더가 있으면 그대로). 로그에서 `authorization`·`cookie`·`x-device-id`는 가린다.
- 공통 미들웨어 (T-018 구현): 약관 재동의 게이트 `app.termsGate`(인증 뒤, 게이트 예외 라우트에는 붙이지 않음. 요청마다 현재 필수 약관·동의 2쿼리), 최소 앱 버전 onRequest 훅(`X-App-Version`·`X-Platform`이 있을 때만 검사, `/health`·`/v1/app-config` 예외, `app_configs` 30초 캐시).
- 남은 공통 미들웨어: 요청 제한(Redis), 멱등 키, 관리자 감사 로그, 점검 모드(503).
- 공용 계산: 유효 접수 기간·접수 상태 `lib/registration-window.ts`, 접수 알림·홈 접수 임박 대상 조건 `lib/entry-alert-audience.ts` (알림 워커도 이것을 쓴다).

## 9. 앱 원격 설정 · 강제 업데이트

- `GET /app-config` (인증 불필요, CDN 캐시 5분): `min_native_version_{ios,android}` 등 `app_configs` 값.
- 앱은 스플래시(S-001)에서 스토어 바이너리 버전과 비교 → 미만이면 강제 업데이트 화면.
- EAS Update(OTA)는 같은 `runtimeVersion` 바이너리에만 배포되므로 **JS만 바뀐 경우는 강제 업데이트하지 않는다.** 네이티브 변경으로 옛 바이너리를 끊어야 할 때만 최소 버전을 올린다.

---
## 변경 이력
- 2026-10-21: v1 초안 작성
- 2026-10-21: D-005~D-008 반영 (v1.1) — 실시간 방식 메모, 지도 래퍼 구조(6장), 알림 파이프라인(7장), 가입·탈퇴 외부 연동(8장), 원격 설정·강제 업데이트(9장) 추가
- 2026-10-21: T-016 — 서버 코드 구조(9-0), 예측 모듈 구현 위치 추가
- 2026-10-21: D-019 반영 — 알림 kind별 대상 규칙(접수 상태 기준) 표와 대상 확정·발송 직전 재판정, 설명 문장 "참가 등록" → "참가 예정"
- 2026-10-21: 홈 접수 임박이 N-01~N-03 대상 조건을 공유함을 명시 (PRD v1.5)
- 2026-10-21: T-018 — 가입 외부 연동 구현 메모(8장: verifier, 연결 해제 작업 예약 방식, 암호화, 기기), 공통 미들웨어 구현 상태(9-0)
- 2026-10-21: T-019 — 알림 파이프라인 구현 메모(7장): 예약표·대상·발송·시각 조건·재시도·묶음·N-06·워커
