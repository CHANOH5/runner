# 접수 상태 기록 + 용어 "참가 예정" (D-019, T-017) — DB·API 변경 요청

- From: planner
- To: developer
- 종류: 요청
- 관련 ID: D-019, F-015, F-014, S-010, S-022, S-023, S-061, N-01~N-05, `race_registrations`, `notification_schedules`, `tech/06-api.md`
- 상태: 답변됨

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

(developer, 2026-10-21 — 설계 문서만 반영. 코드는 고치지 않았다. `tech/04-db-schema.md`·`tech/06-api.md` v1.2·`tech/03-architecture.md` 7장, 각 변경 이력 기록)

1. **용어 — 반영, 내부 이름은 유지.**
   - tech/03·04·06의 설명 문장에서 "참가 등록"을 모두 "참가 예정"으로 바꿨다 (변경 이력 줄 제외). "참가 등록 취소"는 "참가 예정 해제"로 바꿨다.
   - `race_registrations`·`/registrations`·`registration*`은 유지한다. 근거는 06 1장 "이름 규칙"에 적었다.
     - 화면에 노출되지 않는 계약 이름이다.
     - 이미 구현된 예측 API·공유 스키마·테스트·시드가 쓰고 있다.
     - PRD 4.10이 유지를 허용한다.
   - 단, 새 이름에는 `registered`를 '참가 예정' 뜻으로 쓰지 않는다. 그래서 에러 코드 **`ALREADY_REGISTERED` → `ALREADY_PLANNED`** 로 바꿨다. `entryStatus = 'registered'`(접수 완료)와 헷갈리기 때문이다. 앱 문구 매핑에 반영해 달라.
2. **DB — 반영.** `entry_status` 등 3개 컬럼을 요청대로 추가했다 (CHECK 포함). 알림 대상 확정용 `(race_id, entry_status)` 인덱스도 추가했다.
   - `entry_status_updated_at`: 생성 시 앱이 값을 보내면 `created_at`과 같은 시각, 서버 기본값을 쓰면 null이다. 이후 값이 실제로 바뀔 때만 갱신한다.
   - 기존 행은 `not_registered`다.
3. **API — 반영.** 요청 표의 6개 항목을 그대로 넣었다.
   - `entryStatusSource`는 PATCH에서 `entryStatus`를 보낼 때 필수다. POST에서는 선택이고 기본값은 `form`이다.
   - 같은 값으로 다시 PATCH하면 시각을 바꾸지 않는다 (멱등).
   - `missed`로 바꿔도 행은 남는다. "참가 예정에서 뺄까요?" → [해제]를 고르면 앱이 이어서 DELETE를 호출한다.
4. **알림 대상 — 반영.** `tech/03` 7장에 kind별 대상 표와 SQL 조건을 넣었다.
   - 참가 예정이 있으면 관심 여부와 무관하게 **접수 상태로만** 판정한다. 그래서 `registered`인 사람이 관심도 켜 두었어도 N-03을 받지 않는다.
   - 대상 확정(−30분) 뒤에 상태를 바꾸면, 발송 직전 확인에서 같은 규칙으로 다시 걸러 낸다.
   - N-04 본문 변형도 발송 직전 값으로 판정한다.
5. 분석 이벤트 — 확인. 서버 변경 없음.
6. **인앱 브라우저 체류 감지 — 가능, 플랫폼별로 방법이 다르다.**
   - iOS: `WebBrowser.openBrowserAsync`의 promise가 사용자가 닫을 때 `{type: 'cancel'}`로 끝난다 [확인: Expo 문서]. 연 시각과 닫힌 시각의 차이로 10초를 판정한다.
   - Android: Custom Tabs는 promise가 열리는 순간 `{type: 'opened'}`로 끝나서 닫힘을 알 수 없다 [확인]. 대안으로 **연 시각을 기록하고 `AppState`가 `active`로 돌아온 시점**과의 차이로 판정한다. Custom Tab이 열리면 앱이 background가 되기 때문이다.
   - Android 한계: 사용자가 브라우저에서 다른 앱으로 갔다가 돌아와도 "돌아옴"으로 잡힌다. 체류 시간이 길게 잡히는 쪽이라 시트가 조금 더 자주 뜰 수 있다. 24시간·3회 제한이 있어 수용 가능하다고 본다.

### 기획 확인 요청 (3건)
- **a. 대회 당일 변경**: 4.10.1에 "상태는 **대회일 전날까지** 바꿀 수 있다"와 "**대회일이 지나면** 읽기 전용"이 함께 있어 당일 규칙이 모호하다. API는 기존 참가 예정 수정 규칙(4.10 "대회일이 지난 참가 예정은 수정·해제 불가")과 맞춰 **대회 당일까지 변경 가능**(`race_date < 오늘`이면 409)으로 썼다. 4.10.1 문구를 "대회일까지"로 맞춰 달라. 당일 잠금이 필요하면 알려 달라.
- **b. 홈 접수 임박의 "마감 D-n"**: 6.7 ③은 관심 ∪ 참가 예정 전체가 대상이다. 그래서 `접수 완료`·`접수 못 함`인 사람에게도 "마감 D-1" 행이 보인다. N-03과 같은 취지로 **마감 행은 관심만 ∪ `접수 전`에게만** 보이게 할지 정해 달라. 지금 API는 PRD대로 전체에게 보여준다.
- **c. KPI "7일 안 접수 완료 기록률"**: 서버 기본값으로 `registered`가 들어간 경우(마감 후 추가)는 `entry_status_updated_at`이 null이다. 이 경우를 KPI 분모·분자에서 뺄지 정해 달라. 앱이 항상 값을 보내면 실제로는 생기지 않는다.

### 구현 변경 목록 (개발-서버 다음 작업용)
**마이그레이션**
- [ ] `server/src/db/schema/participation.ts`의 `raceRegistrations`에 다음을 추가하고 `pnpm db:generate`로 새 마이그레이션(예: `0003_entry_status.sql`)을 만든다. 기존 0000~0002는 고치지 않는다 (README 규칙).
  - `entryStatus` text NOT NULL default `'not_registered'`
  - `entryStatusUpdatedAt` timestamptz
  - `entryStatusSource` text
  - `check()` 2개 (entry_status 값 3개, entry_status_source 값 4개)
  - 인덱스 `(race_id, entry_status)`
- [ ] 생성된 SQL을 확인한다: 기존 행 기본값 채움, CHECK 이름, 인덱스.

**공유 패키지 (`packages/shared`)**
- [ ] `errors.ts`: `ALREADY_REGISTERED` → `ALREADY_PLANNED`. 아직 사용처는 없다 (registrations 모듈이 빈 껍데기).
- [ ] `registrations.ts` 신규: `EntryStatus`, `EntryStatusSource`, `RegistrationBrief`, `Registration`, POST·PATCH 요청 스키마 (06 6.8).

**서버**
- [ ] `modules/registrations` 구현 (06 6.7·6.8):
  - 생성 시 기본값 = 유효 접수 기간 기준 `closed` → `registered`
  - `missed`로 생성하면 400
  - PATCH: `entryStatus`가 있으면 source 필수, 값이 바뀔 때만 시각 갱신
  - `race_date < 오늘`이면 409 `RACE_FINISHED`
  - 409 `ALREADY_PLANNED`
- [ ] "유효 접수 기간" 계산(06 5장)을 공용 함수 하나로 만들어 races·home·registrations·알림이 같이 쓴다.
- [ ] `GET /races/{id}`의 `my.registration`, `GET /me/races?tab=upcoming`, `GET /home/next-race` 응답에 `entryStatus`·`entryStatusUpdatedAt`를 넣는다.
- [ ] 알림 워커(구현 시): `tech/03` 7장 kind별 대상 규칙, 발송 직전 재판정, N-04 본문 변형·딥링크.
- [ ] `db/seed.ts`: 개발 참가 예정(`…0301`)에 `entryStatus: 'not_registered'`를 명시한다 (선택). 마감된 시드 대회에 `registered` 예시를 하나 추가하면 수동 확인에 좋다.

- [ ] **(PRD v1.5 추가)** `GET /home/deadlines` 대상 필터를 N-01~N-03 대상 조건과 같게 한다 (06 v1.3 6.5): 참가 예정이 있으면 `not_registered`일 때만, 없으면 관심 기준. 오픈·마감 행 모두 적용, 마감 행 시각은 N-03 기준. 대상 조건은 알림 워커와 **공용 함수** 하나로 둔다.

**테스트**
- [ ] 영향 확인: `server/test/predictions.test.ts`는 `raceRegistrations`를 insert한다. 새 컬럼이 기본값을 가지므로 **수정 없이 통과해야 한다**. 마이그레이션 적용 후 돌려 확인한다. `engine.test.ts`는 무관하다.
- [ ] 신규 `server/test/registrations.test.ts`:
  - 접수 중 대회 생성 → `not_registered`
  - 마감 대회 생성(값 없음) → `registered`
  - 생성 시 `missed` → 400
  - PATCH 상태 변경 → 시각·source 저장, 같은 값 재전송 → 시각 불변
  - PATCH `entryStatus`만 있고 source 없음 → 400
  - 대회일 지난 참가 예정 PATCH·DELETE → 409
  - 같은 대회 두 번째 추가 → 409 `ALREADY_PLANNED`
- [ ] `GET /home/deadlines` 테스트 (PRD v1.5): 관심만 → 오픈·마감 행 포함 / 참가 예정 `not_registered` → 포함 / `registered`·`missed` → 둘 다 제외 / 관심 + `registered` → 제외 / 참가 예정자의 마감 행 시각 = 고른 종목 마감.
- [ ] 알림 대상 쿼리 단위 테스트 (워커 구현 시): kind별로 관심만 / `not_registered` / `registered` / `missed` / 관심 + `registered` 5가지 사용자의 포함 여부.

### 기획 확인 요청 답변 (planner, 2026-10-21 — PRD v1.5)
- **a. 대회 당일 변경 → 대회 당일까지 변경 가능.** API 현재 구현(`race_date < 오늘`이면 409)이 맞다. 당일 잠금은 필요 없다 (당일 아침에 "접수 못 함"으로 바꾸는 경우도 있다). PRD 4.10.1 문구를 "대회 당일까지(`race_date ≥ 오늘`, KST)"로 고치고 수용 기준 2개(당일 가능 / 다음 날 409)를 넣었다. **API 변경 없음.**
- **b. 홈 접수 임박 → 오픈·마감 행 모두 "관심만 ∪ 참가 예정 `접수 전`"에게만.** 접수 알림(N-01~N-03)과 같은 대상 규칙이다. `접수 완료`·`접수 못 함`인 대회는 오픈 행·마감 행 모두 빠진다. PRD 6.7 ③ 반영. **API 변경 있음: `GET /home/deadlines`의 대상 필터를 `tech/03` 7장 N-01~N-03 대상 조건(참가 예정이 있으면 `entry_status = not_registered`일 때만, 없으면 관심 기준)과 같게 바꿔 달라.** 응답 스키마는 그대로.
- **c. KPI null 처리 → `entry_status_updated_at`이 null인 행은 분자에서 뺀다 (분모에는 영향 없음).** KPI 분모는 "접수 중 대회의 공식 링크를 처음 연 (사용자, 대회) 쌍"이라 PostHog 이벤트 기준이고, 분자는 그 뒤 7일 안 `entry_status_changed`(to=registered) 또는 `registration_saved`(entry_status=registered) 이벤트다. DB로 교차 확인할 때 null(서버 기본값 `registered`)은 링크 열기와 시점을 비교할 수 없으므로 제외한다. 링크를 열기 전에 이미 `registered`였던 쌍은 분모에서 뺀다. 그리고 **앱은 POST에 항상 `entryStatus`를 보낸다**(PRD 4.10 ⑤)로 명시했으니 null은 사실상 생기지 않는다. **API 변경 없음.** 앱 분석 이벤트 `registration_saved`에 `entry_status`, `source`(`race_detail`/`return_prompt`) 속성을 추가했다 (PRD 2.3, 서버 무관).
- 참고: 에러 코드 `ALREADY_PLANNED` 반영 확인 — PRD 4.10 수용 기준에 코드명을 넣었다.

(developer, 2026-10-21 — 기획 답변 반영 확인)
- a: 06의 `PATCH /registrations/{id}`가 이미 `race_date < 오늘`이면 409(대회 당일까지 변경 가능)라 맞다. PRD v1.5 근거만 표기했다.
- b: `tech/06-api.md` v1.3에서 `GET /home/deadlines` 대상을 관심만 ∪ `not_registered`로 바꿨다. 응답 스키마는 그대로다. `tech/03` 7장에 알림과 공용 조건임을 적었다. 구현 변경 목록과 테스트 목록에도 추가했다.
- c: DB·API 변경 없음. 앱이 POST에 `entryStatus`를 항상 보낸다는 점을 06에 주석으로 남겼다. DB `entry_status_source`(form / return_prompt)와 분석 이벤트 `registration_saved.source`(race_detail / return_prompt)는 값 체계가 달라도 문제없다 — 앞쪽은 저장 경로, 뒤쪽은 진입 화면이다.
