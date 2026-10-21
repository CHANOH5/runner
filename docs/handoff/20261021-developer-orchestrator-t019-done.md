# T-019 수정 2건 + 알림 발송 워커 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-019, D-018, D-019, F-004, F-001, F-014, P-NOTI, P-RET-03
- 상태: 종료

## 내용

브랜치 `claude/dev-notifications`(main `a5be617` 기준)에 T-019를 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**구현한 것**
1. `PATCH /me/records/{id}` 중복 확인: `confirmDuplicate`, 409 `DUPLICATE_RECORD`. 자기 자신은 제외하고, 제목·구분만 바꾸면 확인하지 않는다 (PRD v1.6 4.4).
2. `POST /auth/social`의 `logged_in.reactivated`: 이번 로그인으로 휴면이 풀렸을 때만 true (PRD v1.6 4.1).
3. 알림 발송 워커 (BullMQ + Expo Push)
   - 예약표 계산·재계산
   - 발송 30분 전 대상 확정: 관심·접수 상태·알림 설정·active 사용자
   - 발송 직전 재확인, 문구 렌더링 (PRD 7.2), 묶음 푸시
   - 배치·초당 한도, 1분 간격 3회 재시도, 무효 토큰 삭제
   - `sent_at` = Expo에 넘긴 시각 (D-018)
   - N-06 대회 변경 알림
   - 마이그레이션 `0004_notification_delivery.sql`
4. 테스트 141개 통과. 시간 관련은 고정 시계로 검증했다.

**보드 갱신 요청**: T-019 → `검토` (또는 병합 후 `완료`).

**알아 둘 것**
- 실제 푸시는 보내지 않았다. 테스트는 가짜 Expo 클라이언트를 쓰고, 로컬 워커는 `PUSH_DRY_RUN=true`가 기본이다.
- 실제 발송 확인에는 EAS 프로젝트와 실기기 Expo push token이 필요하다. 앱 작업 이후에 확인한다.
- 기획 질문 4건: `20261021-developer-planner-notification-copy.md`
  - 묶음 문구
  - 긴 대회명 규칙과 30자 제한 충돌
  - 늦은 실행 시 취소 규칙
  - 휴면 계정에 N-06을 보낼지

**다음 작업 제안**
1. 알림 목록 API(`GET /me/notifications`, unread-count, read)와 알림 90일 파기 배치
2. 관리자 API: 대회 등록·수정·게시. 저장 시 `enqueueRaceUpdated`를 호출해 N-06과 재계산을 연결한다
3. 소셜 연결 해제 워커, Expo receipt 확인, 공지·마케팅(N-08)
4. CI (GitHub Actions + PostGIS·Redis 서비스 컨테이너)

## 기대하는 결과물 / 답변 형식
병합 승인 여부, 보드 갱신, 다음 작업 배정.

## 답변 (받는 쪽이 작성)
- (orchestrator, 2026-10-21) 사용자 승인으로 main에 병합. lint·typecheck·테스트 141개 재실행 통과, 비밀값·실제 토큰 미포함 확인. 기획 질문 4건은 기획자에게 전달. 다음 작업은 사용자 지시 후 배정.
