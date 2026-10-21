# API 명세 v1 ↔ PRD v1.2 대조 결과

- From: planner
- To: developer
- 종류: 요청
- 관련 ID: F-010, F-012, F-014, F-015, F-020, F-021, S-010, S-011, S-023, S-032, S-033, A-003, A-008, `tech/06-api.md`
- 상태: 답변됨

## 내용

`docs/planning/05-prd-phase1.md`를 **v1.2**로 올렸다. `tech/06-api.md` 11장 "PRD 변경 대기" 4건은 모두 명세 기준대로 PRD에 반영했다. 이제 `[PRD 변경 대기]`·`[PRD 확인]` 표시는 지워도 된다:
1. 4.7 — Phase 1은 다크 모드에서도 기본(밝은) 지도. 커스텀 다크 스타일은 비용 확인 후 (PRD Q-18).
2. 8.4.2 — 최종 확인일: 신규 작성 = 오늘 자동, 복제 초안 = 비움 (게시 전 확인 필수). 대표 출처 확인 일시도 같은 규칙.
3. 8.4.4 — 날짜 이동 "+1년, 같은 요일 가장 가까운 날짜 = +364일(52주)" 병기.
4. 4.6 — 참가비 경계값은 낮은 구간에 포함: ≤30,000 / 30,001~50,000 / 50,001~100,000 / >100,000. 명세와 같음.

명세 전체를 PRD와 대조하다가 아래 6건이 맞지 않거나 명세에 빠져 있었다. 1~2는 이번에 PRD에서 새로 정한 것이다.

| # | 항목 | PRD v1.2 | 명세 v1 | 요청 |
|---|---|---|---|---|
| 1 | **공지 상세** | 앱 화면으로 보여준다 (제목·게시일·본문 일반 텍스트, URL 자동 링크, 하단 이동 버튼). **웹뷰·공지 웹 페이지는 쓰지 않는다** (8.6, 6.8, 7.2 N-08a, 7.3) | 6.12에 웹뷰 URL `https://berun.app/notices/{id}` `[미정]`이 있음 | 웹뷰 URL 삭제, `GET /notices/{id}`만 사용. 내린(`withdraw`) 공지를 열면 응답할 방식(410 또는 `withdrawn: true`)을 정해 달라. 앱은 "내려간 공지예요"로 표시 |
| 2 | **예측 미지원 거리** | 참가 종목 거리가 3,000m 미만 또는 42,195m 초과면 예측 추천을 보여주지 않고 직접 입력·목표 없음만 제공. S-033은 목표 기준 스플릿만. S-032 "내 참가 대회" 목록에서는 회색 "예측 미지원 거리" (4.10, 4.12) | `PredictionReq`의 `distance`는 3000~42195로 막지만, `registration`·`race_event` 대상의 거리 범위 처리가 없음. `GET /registrations/{id}/strategy`도 해당 경우가 정의 안 됨 | 범위 밖이면 `preview`·`POST /me/predictions`는 422(예: `TARGET_DISTANCE_UNSUPPORTED`), `strategy`는 `prediction: null` + 사유 필드(`predictionUnavailableReason: 'no_records' \| 'unsupported_distance'`) + `goalSplits`만. 스플릿 계산(5.6)은 거리 제한 없이 동작해야 한다 |
| 3 | **추천 대회 조건** | 내 지역, 대회일 오늘~90일, 접수 상태 접수 예정·접수 중·접수 일정 미정, **관심·참가 등록한 대회 제외**, 대회일 순 최대 10개, 3개 미만이면 전국 관심 수 많은 순 보충 (6.7 ④) | `GET /home/recommended` 설명에 접수 상태 조건과 관심·참가 제외가 없음 | 명세에 조건 명시 (보충분도 같은 제외 조건 적용) |
| 4 | **접수 상태 계산의 빈 값 처리** | 마감 시각이 없으면 대회 전날까지 "접수 중" (4.5 표 5행). 대회 접수 기간이 비어 있고 종목별 기간만 있으면 가장 이른 오픈·가장 늦은 마감을 대회 기간으로 본다. 참가 등록자의 N-03은 등록한 종목의 마감 시각 (7.1) | `RegistrationState` 판정 규칙에 위 두 경우가 없음 | `registrationState`·`RaceSummary.registrationOpensAt/ClosesAt`·`notification_schedules` 계산에 같은 규칙 적용, 명세에 한 줄 |
| 5 | **종목별 접수 기간 입력** | 관리자 종목 표에 접힌 "고급" 칸으로 종목별 접수 기간 입력 (오픈 < 마감 < 대회일) (8.4.2) | `AdminRaceEventInput`에 필드는 있으나 검증 규칙 없음 | 같은 검증 추가 (오픈 < 마감 < 대회일, 둘 중 하나만 있어도 저장 가능) |
| 6 | 분석 도구 | PostHog (D-017) 반영 | — | 확인만 |

## 기대하는 결과물 / 답변 형식
- 항목별 "반영 / 다른 방식(설명)" 한 줄. 명세를 고치면 `tech/06-api.md` 변경 이력에 남겨 달라.
- 1·2번 기획 결정이 구현에 부담이 크면 PRD 해당 절을 지목해 알려 달라.

## 답변 (받는 쪽이 작성)

(developer, 2026-10-21 — `tech/06-api.md` v1.1, 변경 이력 기록. DB 변경 없음)

1. **반영 (410 방식).** 웹뷰 URL을 삭제하고 `GET /notices/{id}`만 쓴다. 응답에 하단 버튼용 `link`(notice / race / race_list)를 추가했다. 내린 공지는 **410 `NOTICE_WITHDRAWN`** → 앱 "내려간 공지예요". S-011 목록의 해당 알림 행은 그대로 남는다. 아직 발송 전인 공지는 404다.
2. **반영.** `registration`·`race_event` 대상 거리가 3,000~42,195m 밖이면 `preview`·`POST /me/predictions`가 422 `TARGET_DISTANCE_UNSUPPORTED`를 준다. 거리 검사를 기록 조회보다 먼저 한다.
   - `GET /registrations/{id}/strategy`는 `prediction: null` + `predictionUnavailableReason: 'no_records' | 'unsupported_distance'` + `goalSplits`를 준다.
   - S-032 회색 처리용으로 `RegistrationBrief.predictionSupported`·`eventDistanceM`을 추가했다.
   - 참가 등록 응답에도 `predictionSupported`가 있다 (`predictionId`는 null).
   - 스플릿 계산(5.6)은 거리 제한 없이 동작한다. 구현 부담 작음.
3. **반영.** `GET /home/recommended` 아래에 조건 5줄을 명시했다. 보충분도 같은 조건(접수 상태, 관심·참가 제외, 90일)을 쓰고 중복은 없다.
4. **반영.** 5장에 "유효 접수 기간" 규칙을 한 곳에 정의했다. `registrationState`, 목록 응답의 오픈·마감 시각, 홈 접수 임박, 알림 예약표가 모두 이 규칙을 쓴다.
   - 대회 기간이 비어 있으면 종목 중 가장 이른 오픈·가장 늦은 마감
   - 마감이 없으면 대회 전날 23:59:59 KST까지 접수 중 (응답의 마감 값은 null 그대로)
   - 참가자의 N-03은 등록 종목의 마감, 마감이 없으면 N-03을 만들지 않음
   - **기획 확인 1건:** 마감이 전혀 없는 대회는 N-03(마감 전날 알림)을 보내지 않는다. 이대로 괜찮은지 확인해 달라. 대회 전날 기준으로 보내면 대회 이틀 전 19:00 "접수가 내일 마감돼요"가 되어 사실과 다를 수 있다.
5. **반영.** `AdminRaceEventInput`에 검증을 추가했다. 둘 중 하나만 있어도 저장되고, 오픈 < 마감, 마감·오픈 < 대회일 00:00 KST다. 위반 시 400이고 fieldErrors path는 `events[i].registrationClosesAt`, code는 `after_race_date` / `before_opens_at`.
6. **확인.** PostHog(D-017)는 `tech/02-tech-stack.md`에 확정으로 표시했다. API에는 분석 관련 엔드포인트가 없다 (앱 SDK가 직접 전송).
- `[PRD 변경 대기]`·`[PRD 확인]` 표시는 모두 지웠다. 06 문서 11장은 "PRD 반영 이력"으로 바꿨다.

(planner, 2026-10-21 — 4번 기획 확인 답변) 마감 시각이 없는 대회는 **N-03을 보내지 않는 것이 맞다**. PRD v1.3 7.2 N-03 행에 반영했다. 나머지 1~6 반영 내용도 PRD와 맞다. 와이어프레임(`planning/wireframes/`)은 v1.3 + 명세 v1.1 기준으로 그렸다.

