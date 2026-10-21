# T-018 서버 Phase 1 API 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-018, D-016, D-019, F-001~F-004, F-010~F-015
- 상태: 열림

## 내용

브랜치 `claude/dev-phase1-api`(main `7d0930a` 기준)에 T-018을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**구현한 것**
- 마이그레이션 `0003_entry_status.sql`: 접수 상태 컬럼 3개, `goal_source`, 인덱스
- 인증·가입: `/auth/social`, `/auth/signup`, `/auth/signup/abort`, `/auth/refresh`, `/auth/logout`, `GET /terms/current`, `GET /nicknames/availability`. 함께 만든 것:
  - provider별 verifier
  - JWT 발급·회전
  - 만 14세 판정
  - 연결 해제 작업 큐 자리
- 공통 미들웨어: 약관 재동의 게이트, 최소 앱 버전. `GET /me`, `POST /me/consents`, `GET /app-config`
- 대회: `GET /races`, `GET /races/{id}`
- 참가 예정: 추가·조회·수정(접수 상태 포함)·해제, `GET /me/races`
- 홈: `GET /home/deadlines`
- 기록: `/me/records` CRUD
- 테스트 104개 통과

**보드 갱신 요청**: T-018 → `검토` (또는 병합 후 `완료`).

**명세와 다르게 한 것** (tech 문서에 반영함, 결정 필요 없음)
1. 대회 목록·상세 캐시를 `no-store`로 했다 (명세: `private, max-age=60` + ETag).
   - 응답에 사용자별 `my`가 있어서, 참가 예정 추가 직후 기기 캐시가 오래된 값을 보여 줄 수 있다.
2. `race_registrations.goal_source` 컬럼을 추가했다. 응답 `goalSource`를 저장할 곳이 없었다.

**사용자 확인이 필요한 것**
- 소셜 로그인 실제 동작은 provider 키 발급 후 확인해야 한다. 필요한 값은 `.env.example`의 `KAKAO_APP_ID`, `GOOGLE_CLIENT_IDS`, `APPLE_*`다. 카카오·Google·Apple 콘솔 앱 등록이 필요하다.

**다음 작업 제안**
1. 알림 워커(BullMQ): `notification_schedules` 계산, 대상 확정(공용 조건 사용), Expo Push 발송, 연결 해제 워커
2. 남은 앱 API: 홈 next-race·recommended, 관심 PUT/DELETE, `/races/count`·`/calendar`, 프로필·알림 설정·기기·탈퇴, 예측 candidates·목록·strategy
3. 요청 제한(Redis)·멱등 키, CI(GitHub Actions + PostGIS)

## 기대하는 결과물 / 답변 형식
병합 승인 여부, 보드 갱신, 다음 작업 배정.

## 답변 (받는 쪽이 작성)
