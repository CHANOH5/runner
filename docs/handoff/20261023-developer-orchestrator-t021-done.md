# T-021 앱 남은 API 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-021, F-013, F-016, F-020, F-021, F-071, F-072, P-PRI-03, P-RET, P-ACC-04
- 상태: 종료

## 내용

브랜치 `claude/dev-app-apis`(main `fb5d47a` 기준)에 T-021을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**구현한 엔드포인트**
- 관심: `PUT/DELETE /races/{id}/interest`. 200개 한도는 하트로 켤 때만 검사하고, 자동으로 켜진 관심도 개수에 포함한다.
- 제보: `POST /races/{id}/reports`. 하루 같은 대회 3건·전체 10건이고, 관리자 제보 목록과 이어진다.
- 홈: `GET /home/next-race`, `GET /home/recommended`
- 프로필·설정:
  - `PATCH /me/profile`
  - `GET/PATCH /me/privacy`
  - `GET/PATCH /me/notification-settings` (마케팅 동의·철회 이력 포함)
  - `GET /me/consents`
  - `PUT/DELETE /me/device`
- 탈퇴: `DELETE /me`
  - 즉시 파기하고, 보존 항목은 남긴다. 사유 통계를 기록한다.
  - 카카오·Apple 연결 해제 작업을 큐에 넣는다. 실제 호출은 하지 않는다.
- 예측: `GET /me/predictions/candidates`, `GET /me/predictions`, `GET /me/predictions/{id}`, `GET /registrations/{id}/strategy`
- 테스트 202개 통과. 탈퇴는 파기 12개 테이블과 보존 2개 테이블을 테이블별로 확인한다.

**보드 갱신 요청**: T-021 → `검토` (또는 병합 후 `완료`).

**명세와 다르게 한 것** (tech/06 반영, 결정 필요 없음)
1. `GET/PATCH /me/privacy`를 새로 추가했다. 명세에 엔드포인트가 없었다. PRD에서 공개 범위 화면은 Phase 2라 값만 저장한다.
2. `DELETE /me/device`를 새로 추가했다. 푸시 토큰만 해제한다. 기기 행을 지우면 로그인 세션도 같이 지워지기 때문이다.
3. 홈 추천의 `regionCode`를 nullable로 했다. 프로필 지역이 없으면 전국 보충만 한다.
4. 관심 끄기는 숨김 대회에도 허용했다 (내 대회 정리용).

**기획 질문 3건**: `20261023-developer-planner-t021-questions.md`
- 홈 다음 대회에 `접수 못 함`을 포함할지
- 페이스 전략에서 기록이 바뀌었을 때 다시 계산할지
- 사유 없는 탈퇴 통계를 남길지

**다음 작업 제안**
1. 소셜 연결 해제 워커: 카카오 unlink, Apple revoke, 재시도, 7일 정리. 해제 직전에 같은 계정이 재가입했는지 확인한다.
2. 관리자 나머지: 대시보드(A-002), 공지·마케팅(N-08, `GET /notices/{id}` 포함), 원격 설정
3. `GET /races/count`, `GET /races/calendar`, 요청 제한(Redis), 멱등 키
4. CI·배포 준비 (KMS, 첫 owner 시드)

## 기대하는 결과물 / 답변 형식
병합 승인 여부, 보드 갱신, 다음 작업 배정.

## 답변 (받는 쪽이 작성)
- (orchestrator, 2026-10-23) 사용자 승인으로 main에 병합. lint·typecheck·테스트 202개 재실행 통과, 비밀값 미포함 확인. 명세 변경 4건 승인. 기획 질문 3건은 기획자에게 전달. 다음 작업은 사용자 지시 후 배정.
