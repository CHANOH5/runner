# 접수 상태 기록 + 용어 "참가 예정" (D-019, T-017) — DB·API 변경 요청

- From: planner
- To: developer
- 종류: 요청
- 관련 ID: D-019, F-015, F-014, S-010, S-022, S-023, S-061, N-01~N-05, `race_registrations`, `notification_schedules`, `tech/06-api.md`
- 상태: 열림

## 내용

PRD를 **v1.4**로 올렸다 (`docs/planning/05-prd-phase1.md` 4.10, **4.10.1 신설**, 7.2, 2.1·2.3, 10장 #14). 와이어프레임도 반영했다 (S-010, S-022, S-023, S-061).

### 1. 용어
- 화면 문구 "참가 등록" → **"참가 예정"** (버튼 [참가 예정 추가] / [참가 예정 · {종목}] / [참가 예정 해제]).
- **DB 테이블 `race_registrations`와 API 경로 `/registrations`, `registration*` 필드명은 바꾸지 않아도 된다** (내부 이름). 단, 앱 화면 문구·에러 문구 매핑·푸시 문구에는 "참가 등록"을 쓰지 않는다. `tech/03·04·06` 문서의 설명 문장은 "참가 예정"으로 맞춰 주면 좋다 (예: "참가 등록 취소" → "참가 예정 해제").

### 2. DB (`race_registrations`)
| 컬럼 | 타입 | 규칙 |
|---|---|---|
| `entry_status` | text NOT NULL DEFAULT `'not_registered'` | `not_registered`(접수 전) / `registered`(접수 완료) / `missed`(접수 못 함). CHECK 제약 |
| `entry_status_updated_at` | timestamptz NULL | 상태를 바꾼 시각 (KPI "7일 안 접수 완료 기록률") |
| `entry_status_source` | text NULL | `form` / `return_prompt` / `race_detail` / `my_races` (KPI·분석용) |

- 기존 행 마이그레이션: 모두 `not_registered`. (아직 운영 데이터가 없으면 무관)
- 복귀 질문의 "24시간 안 다시 묻지 않음 / 누적 3회" 제한은 **기기 저장**이다. 서버 컬럼 필요 없음.

### 3. API
| 엔드포인트 | 변경 |
|---|---|
| `POST /races/{raceId}/registration` | 요청에 `entryStatus: 'not_registered' \| 'registered'` (선택, 없으면 서버 기본값). **서버 기본값**: 대회 유효 접수 기간 기준 `closed`면 `registered`, 그 외 `not_registered` (PRD 4.10 3-1. 앱도 같은 기본값을 미리 선택해 보내지만 서버가 최종 결정). `missed`로 생성은 400 |
| `PATCH /registrations/{id}` | `entryStatus` (3개 값 모두) + `entryStatusSource`. 대회일(KST) 이후면 409 `RACE_FINISHED` (기존 규칙과 같음). 상태만 바꾸는 요청도 이 엔드포인트로 |
| `Registration`, `RegistrationBrief` 응답 | `entryStatus`, `entryStatusUpdatedAt` 추가 |
| `GET /races/{raceId}` → `my.registration` | 위 필드 포함 (S-022 내 참가 예정 카드, 복귀 질문 조건 ③) |
| `GET /me/races?tab=upcoming` | 항목 `registration.entryStatus` (S-061 배지). 정렬 변경 없음 |
| `GET /home/next-race` | `registration.entryStatus` + 대회 `registrationClosesAt`(유효 기간 기준) — "아직 접수 전이에요 · 마감 {M.D}" 표시용 |

### 4. 알림 대상 (대상 확정 시점 = 발송 30분 전, 그 시점 상태로 판정)
| kind | 대상 |
|---|---|
| `reg_open_d1`, `reg_open_soon` | 관심만 한 사용자(참가 예정 없음) ∪ 참가 예정 `entry_status = not_registered` |
| `reg_close_d1` | 관심만 한 사용자 ∪ 참가 예정 `not_registered` (**`registered`·`missed` 제외**) |
| `race_d7` | 참가 예정 `not_registered`·`registered` (`missed` 제외). **`not_registered`이면서 유효 접수 기간이 이미 마감**이면 본문 변형 + 딥링크 `berun://races/{id}` (PRD 7.2 N-04 행) |
| `race_d1` | 참가 예정 `not_registered`·`registered` (`missed` 제외) |
| `race_cancelled` / `race_postponed` / `race_schedule_changed` | 변경 없음 (관심 ∪ 참가 예정, 상태 무관) |

### 5. 분석 이벤트 (앱 → PostHog)
`entry_status_changed` {race_id, from, to, source}, `entry_prompt_shown` {race_id, has_registration}, `entry_prompt_answered` {race_id, answer: registered / not_yet / dismissed} (PRD 2.3). 서버 변경 없음.

### 6. 앱 동작 참고 (서버 무관)
- 복귀 질문: S-022에서 [접수하러 가기]·[공식 홈페이지] 인앱 브라우저를 닫고 돌아왔을 때, 브라우저 체류 10초 이상 + 대회 `registrationState`가 `open` 또는 `unscheduled` + (참가 예정 없음 또는 `not_registered`) + 기기 제한(24시간 / 누적 3회) 통과 시 바텀시트. 인앱 브라우저 체류 시간·닫힘 감지가 Expo(`expo-web-browser`)에서 가능한지 확인 부탁 — 어렵다면 대안(예: 앱 포그라운드 복귀 이벤트 + 링크 연 시각 비교)을 알려 달라.

## 기대하는 결과물 / 답변 형식
- 1~4 항목별 "반영 / 다른 방식(설명)". 스키마·API 변경은 `tech/04`, `tech/06` 변경 이력에 남겨 달라.
- 6번 인앱 브라우저 체류 감지 가능 여부 한 줄.

## 답변 (받는 쪽이 작성)
