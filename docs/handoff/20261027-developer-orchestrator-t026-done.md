# T-026 서버 API 3개·privacyPolicyUrl 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-026, T-027, PRD v1.11 4.2·4.5, S-011, S-020, S-021, S-003, S-065
- 상태: 열림

## 내용

브랜치 `claude/dev-t026`(main `27046e6` 기준)에 T-026을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**구현한 것**
1. `GET /v1/races/count`
   - 목록과 같은 필터 함수로 센다. 받는 쿼리는 목록에서 cursor·limit만 뺀 것이다.
2. `GET /v1/races/calendar?month=YYYY-MM`
   - 목록 필터에서 `q`·`from`·`to`·`date`를 뺀 쿼리를 받는다.
   - 대회가 있는 날만 날짜 순으로 센다. `race_date`가 KST 날짜다.
   - 이번 달 −1~+12개월 밖이면 400이다.
3. `GET /v1/notices/{id}`
   - 보낸 공지만 200이다. 내린 공지는 410 `NOTICE_WITHDRAWN`, 작성 중·발송 대기는 404다.
   - 관리자 공지 작성 API가 없어서 시드에 공지 2개를 넣었다 (보낸 공지 1, 내린 공지 1). 개발 사용자의 알림 목록에도 각각 들어간다.
4. `privacyPolicyUrl`
   - `GET /v1/app-config` 응답에 `privacyPolicyUrl: string(url) | null`을 추가했다. 값이 없거나 형식이 틀리면 null이다.
   - 관리자 `GET /app-configs`(viewer 이상)와 `PUT /app-configs/{key}`(owner만)를 새로 만들었다. 키별 값 형식을 검사하고 감사 로그를 남긴다. 허용 키에 `privacy_policy_url`이 있다.
5. 공유 스키마(`packages/shared`)
   - 추가: `RaceCountQuery`·`RaceCount`·`RaceCalendarQuery`·`RaceCalendar`·`NoticeDetail`, `AppConfig.privacyPolicyUrl`, `APP_CONFIG_VALUES`·`AdminAppConfig`
   - 목록 필터 필드를 한곳에 두고 목록·개수·달력이 같이 쓴다.

**명세와 다르게 한 것 / 알릴 것**
- **달력의 지난 날짜**: 목록과 같은 기본 조건이라 오늘 이전 날짜는 `includeEnded=true`일 때만 센다. 그래야 달력 숫자가 그날을 눌렀을 때의 목록 수와 맞는다. 지난 달을 보여줄 때 앱이 이 값을 보내야 한다 (tech/06 6.4). 기획 확인을 planner handoff로 남겼다.
- **공지 `publishedAt`**: `notices`에 발송 시각 컬럼이 없다. 예약 시각을 쓰고, 즉시 공지는 승인 시각을 쓴다. 공지 발송 API를 만들 때 `sent_at` 추가를 검토한다.
- **앱 파일 1줄**: `app/src/features/bootstrap.test.ts`의 `AppConfig` 테스트 값에 `privacyPolicyUrl: null`을 넣었다. 필드가 필수가 되어 루트 typecheck를 통과시키려면 필요했다. T-027(개발-앱)과 같은 줄을 고치면 병합 충돌이 날 수 있다.

**확인**
- 테스트: 서버 250 (기존 236 + 새 14: 개수·달력 6, 공지 4, 원격 설정 4 / 앱 설정 테스트 1개 수정), 관리자 9, 앱 74
- lint·typecheck·build 통과
- 시드를 로컬 DB에 적용해 공지 2개가 들어가는 것을 확인했다.

**보드 갱신 요청**: T-026 → `검토` (또는 병합 후 `완료`).

**T-027(개발-앱)에 전할 것**
- 세 API의 응답 형식은 tech/06 6.4·6.5 그대로다.
- 달력에서 지난 날짜를 셀 때 `includeEnded=true`를 보낸다.
- `privacyPolicyUrl`이 null이면 지금처럼 동의 전문을 연다.

**다음 작업 제안**
1. 관리자 공지 작성·승인·발송·내리기 API(7.6)와 A-008 화면. 이때 `notices.sent_at`을 추가한다.
2. 관리자 대시보드 API(7.2)와 A-002 "준비 중" 카드 연결
3. 관리자 웹 원격 설정 화면 (최소 버전·점검·처리방침 주소). API는 이번에 생겼다.
