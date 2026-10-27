# 08. 제품 분석 이벤트 (PostHog)

- 담당: 개발자
- 상태: v1 (T-030)
- 기준: `../planning/05-prd-phase1.md` 2.1·2.3, D-017, P-PRI-08

## 1. 원칙

| 항목 | 규칙 |
|---|---|
| 도구 | PostHog (D-017). SDK 대신 capture HTTP API(`POST {host}/capture/`)를 앱·관리자 웹이 직접 부른다 — 웹 미리보기와 네이티브가 같은 코드, 의존성 없음 |
| 식별자 | 앱: 로그인 뒤 내부 `user_id`(access token `sub`), 로그인 전은 실행마다 새 익명 UUID (기기 id·광고 id 안 씀). 관리자 웹: `admin:{admin_users.id}`, 로그인 전에는 보내지 않음. 로그아웃·탈퇴 시 `reset` |
| 보내지 않는 것 | **이메일·닉네임·좌표·주소·이름·전화** (P-PRI-08, D-017). 관리자 웹은 비밀번호·TOTP·토큰도 |
| 강제 | ① 이벤트별 허용 속성을 타입으로 정의(`AnalyticsEvents`) ② 보내기 직전 `sanitizeProps`: 금지 키(이메일·닉네임은 키 어디에 있어도, 좌표·주소·이름은 단어 단위 — `platform`·`registration_state` 같은 정상 키는 통과), 객체·배열 값, 이메일·좌표처럼 보이는 문자열 값을 뺀다. 테스트: `app/src/lib/analytics.test.ts`, `admin/src/lib/analytics.test.ts` |
| 켜기 | `EXPO_PUBLIC_POSTHOG_KEY`+`EXPO_PUBLIC_POSTHOG_HOST`(앱), `NEXT_PUBLIC_POSTHOG_KEY`+`NEXT_PUBLIC_POSTHOG_HOST`(관리자 웹). **없으면 no-op** — 개발·테스트·CI 기본값. 실제 키는 커밋하지 않는다. 호스트(미국·EU 클라우드 / 자체 호스팅)는 [미정] — 개인정보 국외 이전 기재와 함께 결정 (decisions 미결 질문) |
| 공통 속성 | 앱: `app_version`, `platform`(ios·android·web), `$lib = berun-app` / 관리자: `$lib = berun-admin` |
| 실패 | 전송 실패는 무시 (앱 동작에 영향 없음). 재시도·오프라인 큐는 없다 |

## 2. 앱 이벤트 (PRD 2.3)

| 이벤트 | 속성 | 보내는 곳 |
|---|---|---|
| `login_started` | provider, dev(개발 로그인 여부) | S-002 로그인 시도 |
| `signup_completed` | provider, region_code, has_gender, duration_sec(로그인 시작 → S-004 완료) | S-004 가입 성공 |
| `signup_blocked_underage` | — (식별자 없음, 익명 id) | 만 14세 미만 중단 |
| `notification_permission_result` | granted, source(`onboarding`·`first_interest`) | S-006, 첫 관심 시트 |
| `record_saved` | distance_category, kind, is_edit, source(`onboarding`·`records`) | S-005, S-031 |
| `race_list_viewed` | view(`list`·`calendar`), filter_count | S-020 보기 전환·진입 |
| `race_searched` | query_length, result_count | S-021 검색 결과 (검색어 자체는 안 보냄) |
| `race_viewed` | race_id, registration_status(접수 상태 또는 `none`), source | S-022 진입 1회 |
| `interest_toggled` | race_id, on, source(`card`·`race_detail`) | 하트 (성공 후) |
| `registration_saved` | race_id, race_event_id, has_goal, goal_source, is_edit, entry_status, source(`race_detail`·`return_prompt`) | S-023 저장 |
| `registration_cancelled` | race_id | S-023 해제, 접수 못 함 → 해제 |
| `entry_status_changed` | race_id, from, to, source(`form`·`return_prompt`·`race_detail`·`my_races`) | 상태 시트, 복귀 질문, S-023 수정 |
| `entry_prompt_shown` | race_id, has_registration | 복귀 질문 표시 |
| `entry_prompt_answered` | race_id, answer(`registered`·`not_yet`·`dismissed`) | 복귀 질문 응답 |
| `external_link_opened` | race_id, link_type(`official`·`registration`), registration_state | S-022 공식 링크 — KPI "접수 완료 기록률" 분모(`registration_state = open`) |
| `prediction_viewed` | target_distance_m, confidence, record_count, source(`prediction`·`registration`·`preview`) | S-033 |
| `strategy_tab_changed` | strategy(`even`·`negative`) | S-033 탭 |
| `notification_opened` | kind, race_id(딥링크가 대회면) | S-011 탭 (푸시 탭 처리는 Development Build 작업에서 같은 이벤트로) |
| `race_report_submitted` | race_id, field | S-024 |
| `directions_opened` | race_id, app(`naver`·`kakao`·`apple`·`google`·`web`) | [길찾기] 앱 선택 |
| `account_deleted` | reason_code | S-066 (탈퇴 직후 reset) |

- `venue_map_opened`(전체 화면 지도)는 지도 SDK(D-008) 연동 때 붙인다 — 지금은 자리 표시라 진입 화면이 없다.
- KPI 계산(PRD 2.1) 중 "주간 활성 참가 예정 수"·"목표 기록 입력률"·"접수 상태 확정률"은 DB 집계로, "N-02 열람률"은 `notification_opened`(kind = `reg_open_soon`) + 서버 발송 수로 본다.

## 3. 관리자 웹 이벤트

| 이벤트 | 속성 |
|---|---|
| `admin_logged_in` | role |
| `admin_notice_saved` | notice_id, kind, send_push, scheduled, is_edit |
| `admin_notice_approved` | notice_id, kind, recipients, scheduled |
| `admin_notice_withdrawn` | notice_id, status |
| `admin_notice_test_sent` | notice_id (테스트 사용자 id는 안 보냄) |
| `admin_reports_resolved` | count, action |

---
## 변경 이력
- 2026-10-27: v1 (T-030) — 앱·관리자 웹 분석 래퍼, PRD 2.3 이벤트 정의, 개인정보 거름망
