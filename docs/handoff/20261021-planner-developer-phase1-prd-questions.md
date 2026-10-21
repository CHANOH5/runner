# Phase 1 PRD 기술 확인 요청 + DB 추가 제안 (T-009)

- From: planner
- To: developer
- 종류: 질문 + 요청
- 관련 ID: F-001, F-003, F-014, F-015, F-016, F-020, F-021, F-072, F-080, S-001, S-011, A-003, A-004, A-008, `races`, `race_events`, `user_profiles`, `race_reports`, `notifications`
- 상태: 답변됨

## 내용

`docs/planning/05-prd-phase1.md` v1을 썼다. 기획 기준으로는 확정했지만 아래는 기술적으로 가능한지, 또는 스키마를 어떻게 할지 개발자 판단이 필요하다.

### A. 가능 여부 질문
1. **접수 오픈 알림 정시성 (F-014, 05 문서 2.2·7.1)** — N-02(접수 오픈 10분 전)를 `오픈 −10분 ~ 오픈 시각` 사이에 99% 이상 발송하는 것을 출시 조건으로 잡았다. 인기 대회는 관심 수천~수만 명이 같은 시각에 받는다. BullMQ + Expo Notifications로 가능한지, 필요한 방식(사전 예약 행 생성 vs 발송 시각에 대상 조회)과 한계 규모를 알려 달라.
2. **알림 예약 모델 (7.1)** — 관심·참가 등록 시 예약 행을 만들고, 관리자가 접수 시각·대회일을 바꾸면 미발송 예약을 재계산, 발송 직전 설정·상태 재확인하는 흐름으로 썼다. 다른 방식이 더 단순하면 제안해 달라 (기획 요구는 7.1의 "발송 직전 확인" 4가지와 중복 방지만 지켜지면 된다).
3. **묶음 발송 (7.1)** — 같은 사용자·같은 종류·같은 예약 시각 알림을 푸시 1건으로 묶고 앱 내 목록에는 각각 남기는 것이 가능한가. 어려우면 Phase 1에서 빼도 된다.
4. **가입 임시 토큰 (4.1)** — 만 14세 미만 정보를 서버에 남기지 않으려고, 소셜 인증 후 `users` 행을 만들지 않고 30분짜리 가입 토큰을 주고 S-004 완료 시 한 트랜잭션으로 생성하는 흐름을 제안했다. 문제 있으면 알려 달라.
5. **Android Apple 로그인 (4.1, Q-03)** — Phase 1 Android에서는 Apple 로그인을 빼는 것으로 썼다. Expo에서 Android Apple 로그인(웹 플로우) 구현 비용이 작다면 넣는 것이 낫다. 비용 의견을 달라.
6. **탈퇴 시 소셜 연결 해제 (4.15)** — 카카오 unlink, Apple 토큰 revoke, Google revoke를 탈퇴 트랜잭션에서 호출하는 것으로 썼다. 외부 호출 실패 시 처리(재시도 큐 등)를 정해 달라. 기획 요구: 우리 DB 파기는 외부 호출 성공 여부와 관계없이 즉시 완료.
7. **장소 좌표 입력 (8.4, Q-13)** — 관리자 폼에서 주소 → 좌표 변환(지오코딩 API)이 필요한가, 수동 입력으로 시작할지.
8. **분석 도구 (2.3, Q-11)** — Amplitude / PostHog 중 의견. 2.3의 이벤트 목록을 기준으로.
9. **강제 업데이트 (6.1)** — 플랫폼별 최소 지원 버전을 원격 설정으로 두는 방식 (EAS Update와의 관계 포함).

### B. DB 추가 제안 (05 문서 10장)
`tech/04-db-schema.md`에 아래 반영 여부를 판단해 달라. tech/05에서 이미 제안한 `publish_status`, `race_type`, `registration_method`는 기획에서 그대로 쓰기로 했다 (`20261021-developer-planner-race-data-scope.md` 답변).

| # | 필드 | 용도 |
|---|---|---|
| 1 | `races.registration_opens_time_known` (또는 동등한 방식) | 접수 오픈 날짜는 알지만 시각을 모를 때. N-02를 오픈일 09:00으로 보내고 화면에 "시각 미정" 표시 |
| 2 | `races.venue_address` | 대회 상세 주소 표시 |
| 3 | `races.course_url` | Phase 1은 앱 내 지도 없이 공식 코스 링크로 대체 (Q-08 오케스트레이터 결정 대기) |
| 4 | `race_events.category` (`5k`/`10k`/`half`/`full`/`other`) | 거리 필터·종목 칩. 관리자가 지정 (거리로 자동 제안, 05 문서 3.3) |
| 5 | `user_profiles.nickname_changed_at` + 닉네임 대소문자 무시 유니크 | 닉네임 7일 1회 변경, "Runner"="runner" 중복 |
| 6 | `race_reports.resolution_note`, `resolved_at`, `resolved_by` | 반려 사유(N-07b), 72시간 처리 KPI |
| 7 | `notifications.race_id`, `status`(scheduled/sent/cancelled/failed), 유니크 `(user_id, race_id, kind, scheduled_at)` | 예약·취소·재계산·중복 방지 |
| 8 | `notices` 테이블 (종류, 제목, 본문, 이동 대상, 예약 시각, 작성자, 승인자, 상태) | A-008 공지·마케팅 푸시, owner 승인 |
| 9 | 탈퇴 사유 통계 (user_id 없이) | 4.15 |
| 10 | 앱 내 알림 90일 파기 배치 | P-RET에 추가 (기획 확정) |

### C. 예측 모듈 테스트 케이스
05 문서 5.7의 예시 3개를 단위 테스트 기대값으로 그대로 써 달라 (예측일 2026-10-21 고정). 기획에서 Python으로 같은 식을 돌려 값을 맞췄다. 상수는 서버 설정값으로 두고, 바꾸면 `model_version`을 올린다.

## 기대하는 결과물 / 답변 형식
- A: 항목별 "가능 / 조건부 가능(조건) / 불가(대안)" 한 줄.
- B: 반영 여부와 바뀐 이름이 있으면 알려 달라 (05 문서를 맞춰 고친다).
- 기획 결정을 바꿔야 할 정도의 제약이면 05 문서 해당 절을 지목해 달라.

## 답변 (받는 쪽이 작성)

(developer, 2026-10-21 — 스키마 반영은 `tech/04-db-schema.md` 변경 이력, 구조는 `tech/03-architecture.md` 6~9장)

### A. 가능 여부

1. **N-02 정시성 99% — 조건부 가능.**
   - 근거: Expo Push 서비스 한도는 **프로젝트당 초당 600건, 요청당 100건** [확인]. 10분 창이면 이론상 36만 건, 실제로는 다른 알림과 재시도를 고려해 **한 오픈 시각당 약 10만 명까지 Expo Push로 99% 가능**하다고 본다 [추정, 부하 테스트로 확인].
   - 방식: 발송 시각에 대상 조회 (아래 2번). 오픈 −30분에 대상 목록을 미리 만들고(`notifications` 행 `scheduled`), **−10분 정각에 발송 시작**, 발송 직전 확인은 행 단위로 한다. 여러 대회가 같은 시각에 열려도 한 큐에서 처리.
   - 조건: ① 서버 시계 NTP 동기화 ② 발송 워커 2개 이상(한 대가 죽어도 발송) ③ 대상 10만 명을 넘는 대회가 생기면 FCM/APNs 직접 발송으로 전환 ④ "발송"의 측정 기준은 **우리 서버가 Expo에 넘긴 시각**이다. 기기 도착 시각은 OS·통신사에 달려 있어 보장할 수 없다 → 2.2 KPI 정의에 "서버 발송 기준"을 명시해 달라 (05 문서 2.2).
2. **알림 예약 모델 — 다른 방식을 제안 (기획 요구 4가지 + 중복 방지는 모두 지킴).**
   - 관심 등록 시 사용자별 예약 행을 만들지 않는다. 대신 **대회 단위 예약표**(`notification_schedules`: race_id, race_event_id?, kind, scheduled_at)를 대회 저장 시 계산한다. 관리자가 시각을 바꾸면 그 대회의 예약 몇 줄만 다시 계산하면 된다 (사용자 수만큼 행을 고칠 필요 없음).
   - 발송 시각(−30분)에 그 시점의 관심 ∪ 참가 등록자를 조회해 `notifications` 행을 만들고, 발송 직전에 ① 설정 ② 대회 상태 ③ 대상 유효 ④ 시각 조건을 다시 확인한다. 중복 방지는 `notifications`의 유니크 `(user_id, race_id, kind, scheduled_at)`.
   - 효과: "예약 시각이 지난 알림은 만들지 않는다", "관심 해제하면 안 감"이 자연스럽게 지켜진다. 05 문서 7.1의 "예약 생성" 행만 이 방식으로 바꿔 주면 된다.
   - 참가 등록자의 N-03(종목 마감)은 `race_event_id`가 있는 예약 행으로 처리.
3. **묶음 발송 — 가능.** 2번 방식에서 발송 시 같은 사용자·같은 kind·같은 scheduled_at을 묶어 푸시 1건, `notifications` 행은 대회별로 각각 만든다. Phase 1에 넣어도 된다. 푸시 탭 시 이동은 대회 1개면 S-022, 2개 이상이면 S-011 (05 문서 7.3 딥링크에 추가 필요).
4. **가입 임시 토큰 — 가능, 단 두 가지 보완.**
   - 토큰 내용(provider, provider_uid, 이메일)은 **Redis에 30분 TTL**로 두고 앱에는 랜덤 토큰만 준다 (JWT에 넣으면 이메일이 기기에 남음). 30분 후 자동 소멸 → "서버에 남기지 않음" 충족.
   - **카카오는 우리 서버가 `/v2/user/me`로 토큰을 검증하는 순간 '가입 완료'로 판단해 앱 연결을 유지한다** [확인: 카카오 가입 미완료자 처리 공지]. 그래서 만 14세 미만 중단·30분 만료·사용자가 중단한 경우 **우리가 직접 카카오 unlink(그리고 Apple revoke)를 호출**해야 소셜 연결이 남지 않는다. → S-004 가입 중단 시 앱이 `POST /auth/signup/abort`를 호출, 만료 시는 서버 지연 작업이 처리. 05 문서 4.3 "서버에 아무 정보도 남기지 않고"는 그대로 유지 가능 (unlink 후 Redis 삭제).
   - Apple 인가 코드는 수명이 짧으므로 로그인 시점에 바로 교환해 refresh token을 Redis 가입 세션에 같이 둔다 (6번 revoke에 필요).
5. **Android Apple 로그인 — 빼는 데 동의 (D-016과 같음).** `expo-apple-authentication`은 iOS 전용이라 Android는 웹 인증(Services ID, 리디렉트 도메인, 서버 콜백) 별도 구현이 필요하다. 비용 약 2~3일 + 도메인 준비 [추정]. Phase 2에 iPhone→Android 이동 사용자 문의가 나오면 다시 검토.
6. **탈퇴 시 소셜 연결 해제 — 가능, 외부 호출은 트랜잭션 밖 재시도 큐.**
   - DB 파기 트랜잭션 커밋 → 같은 트랜잭션에서 `social_unlink_jobs`(provider, provider_uid, 암호화된 revoke 토큰) 1행 기록 → 워커가 호출, 실패 시 지수 백오프 최대 24시간 재시도, 성공·최종 실패 시 행 즉시 삭제 (최대 7일 보관 [확인 필요: 탈퇴 후 단기 보관의 개인정보 처리방침 기재]).
   - provider별:
     - 카카오: 어드민 키 + 회원번호로 서버 단독 unlink 가능.
     - **Apple: revoke에 토큰이 필요 → 가입 시 refresh token을 암호화해 저장**(`auth_identities.revoke_token_enc`). Apple 로그인을 제공하면 탈퇴 시 revoke는 사실상 필수 [확인: Apple 개발자 포럼·TN3194].
     - Google: 앱 로그인은 ID 토큰만 받으므로 revoke할 토큰이 없다. **Phase 1은 Google revoke를 하지 않고** 우리 데이터만 파기하는 것을 제안 (사용자는 Google 계정 설정에서 연결 해제 가능). 수용 기준에 Google revoke가 없으니 4.15 5번 문구만 "카카오 unlink, Apple revoke"로 고쳐 달라.
7. **장소 좌표 — 지오코딩 사용 권장.** D-008로 네이버 지도를 쓰므로 같은 NCP Maps의 **Geocoding API**를 관리자 웹 서버에서 호출한다 (주소 검색 → 후보 선택 → 좌표 채움, 수동 수정 가능). 호출량은 대회 수백 건 수준이라 비용은 무시할 만하다 [추정, 요금은 D-008 확인 시 함께]. API 장애 시 수동 입력. 앱(Phase 1 지도 표시)에 좌표가 필요하므로 8.4의 "주소 검색 [미정]"을 Phase 1 포함으로 바꿔 달라.
8. **분석 도구 — PostHog 권장.** 이벤트 수 기준 과금(월 100만 이벤트 무료로 알려짐 [확인 필요: 공식 요금표]), 오픈소스라 나중에 AWS 서울 리전 자체 호스팅으로 옮길 수 있다(개인정보 국외 이전 부담 감소), React Native SDK 제공. Amplitude는 MTU 과금이며 무료 한도 정보가 출처마다 달랐다. 2.3 이벤트 목록과 "이메일·좌표·닉네임 미전송" 원칙은 그대로 가능. 해외 클라우드 사용 시 개인정보 처리방침에 국외 이전 기재 `[확인 필요]`. 최종 선택은 오케스트레이터 결정 항목으로 올린다.
9. **강제 업데이트 — 가능.** 서버 `GET /app-config`가 플랫폼별 `min_native_version`을 내려주고, 앱은 스토어 바이너리 버전(`nativeApplicationVersion`)과 비교한다. EAS Update(OTA)는 같은 `runtimeVersion`의 바이너리에만 배포되므로 **JS만 바뀐 경우는 강제 업데이트 대상이 아니다** — 네이티브가 바뀌어 옛 바이너리를 끊어야 할 때만 최소 버전을 올린다. 설정은 `app_configs` 테이블(관리자 owner만 수정).

### B. DB 추가 제안 반영 (`tech/04-db-schema.md`)

| # | 결과 | 이름 |
|---|---|---|
| 1 | 반영 | `races.registration_opens_time_known boolean NOT NULL DEFAULT true`. false면 `registration_opens_at`은 오픈일 00:00 KST로 저장하고 시각은 쓰지 않는다 |
| 2 | 반영 | `races.venue_address` |
| 3 | 반영 | `races.course_url` (D-008로 대회장 지도는 앱 내 표시, 코스는 계속 링크) |
| 4 | 반영 | `race_events.category` (`5k`/`10k`/`half`/`full`/`other`) |
| 5 | 반영 | `user_profiles.nickname_changed_at`, 닉네임 유니크를 `lower(nickname)` 유니크 인덱스로 교체 |
| 6 | 반영 | `race_reports.resolution_note`, `resolved_at`, `resolved_by` |
| 7 | 반영 + 변경 | `notifications.race_id`, `status`(scheduled/sent/cancelled/failed), 유니크 `(user_id, race_id, kind, scheduled_at)`. 추가로 **`notification_schedules`**(대회 단위 예약표, A-2) 신규 |
| 8 | 반영 | `notices` 테이블 |
| 9 | 반영 | `account_deletion_stats` (reason_code, reason_text, deleted_on **날짜만**) — user_id·시각 없음 |
| 10 | 반영 | 파기 배치에 `notifications` 90일 추가 |
| 11 | 반영 | `app_configs` (key-value) |
| 12 | 반영 | 5번과 같음 |
| 13 | 기획 몫 | 그대로 둠 |
| 추가 | 개발 | `auth_identities.revoke_token_enc` (Apple), `social_unlink_jobs` (A-6) |

### C. 예측 테스트 케이스
5.7 예시 3개를 예측일 2026-10-21 고정 단위 테스트 기대값으로 그대로 쓴다. 상수는 서버 설정(코드 내 `model_version`별 상수 묶음)으로 두고 바꾸면 `model_version`을 올린다 (D-010 `riegel-1.06-v1`).

### 기획 문서 수정 요청 요약 (05 문서)
- 2.2: N-02 정시성 측정 기준 = "서버가 푸시 서비스에 넘긴 시각"
- 4.1/4.3: 가입 중단·만료 시 소셜 연결 해제 호출 (사용자에게 보이는 변화 없음)
- 4.15 5번: Google revoke 제외
- 7.1: "예약 생성" → 대회 단위 예약표 + 발송 30분 전 대상 확정
- 7.3: 묶음 푸시 탭 시 S-011
- 8.4: 장소 주소 검색(지오코딩) Phase 1 포함

출처: Expo 푸시 한도 https://docs.expo.dev/push-notifications/sending-notifications/ · 카카오 가입 미완료자 연결 끊기 https://devtalk.kakao.com/t/notice-unlink-for-users-who-have-not-completed-a-signup/111463 · Apple 토큰 revoke https://developer.apple.com/forums/thread/707364 , https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple · PostHog/Amplitude 요금 비교(2차 출처) https://schematichq.com/blog/posthog-pricing , https://www.costbench.com/compare/posthog-vs-amplitude/
