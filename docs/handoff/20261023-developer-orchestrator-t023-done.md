# T-023 CI·D-020 정리·휴면 처리 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-023, D-020, P-RET-01, P-RET-03
- 상태: 종료

## 내용

브랜치 `claude/dev-ci-batches`(main `5c0c823` 기준)에 T-023을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**구현한 것**
1. CI `.github/workflows/ci.yml`
   - 순서: install → lint → typecheck → build → 테스트 DB 생성 → migrate → seed → test
   - PostGIS·Redis 서비스 컨테이너는 로컬과 같은 이미지·포트다.
   - 비밀값이 없고, dry-run 설정을 켜 둔다.
2. D-020: 일일 정리 배치에서 끝난 지 1년 지난 연결 해제 최종 실패 기록을 지운다. `deletion_jobs`에 `social_unlink_failed_1y`로 남긴다.
3. 휴면 처리 배치 (매일 10:00 KST)
   - 접속 후 335일에 안내하고, 365일 + 안내 후 30일이 지나면 `dormant`로 바꾼다.
   - 접속 = 소셜 로그인·토큰 회전이다.
   - 안내는 앱 푸시로 한다. 이메일은 인터페이스만 있다.
   - 마이그레이션 `0007`

**CI 로컬 검증**
- 브랜치를 새로 clone했다 (`.env` 없음).
- Node 22.23.4, pnpm 10.34.7, 새 DB(`berun_ci`, `berun_ci_test`)로 워크플로 단계를 같은 순서로 실행했다.
- 결과: lint 통과, typecheck 통과, build 통과, migrate·seed 성공, 테스트 23개 파일·228개 통과.
- 실제 GitHub 실행은 병합 후 확인이 필요하다. 첫 실행에서 서비스 이미지 pull·포트를 봐야 한다.

**보드 갱신 요청**: T-023 → `검토` (또는 병합 후 `완료`).

**결정·확인 요청**
- 휴면 안내 이메일 채널 결정: `20261023-developer-orchestrator-dormancy-channel.md`
- 안내 문구와 "접속" 기준 (planner): `20261023-developer-planner-dormancy-notice.md`

**다음 작업 제안**
1. 관리자 나머지: 대시보드(A-002, 알림·연결 해제·휴면 지표), 공지·마케팅(N-08, `GET /notices/{id}`), 원격 설정
2. `GET /races/count`, `GET /races/calendar`, 요청 제한(Redis), 멱등 키
3. 배포 준비: AWS CDK(ECS·RDS·ElastiCache), KMS, 첫 owner 시드, 비밀값 주입, CI에 배포 단계 추가
4. 앱(Expo) 작업 시작 — 서버 API가 Phase 1 화면을 거의 모두 덮는다

## 기대하는 결과물 / 답변 형식
병합 승인 여부, 보드 갱신, 다음 작업 배정.

## 답변 (받는 쪽이 작성)
- (orchestrator, 2026-10-23) 사용자 승인으로 main에 병합. lint·typecheck·테스트 228개 재실행 통과, 워크플로 비밀값 미사용 확인. GitHub Actions 첫 실행 결과는 push 후 확인. 기획 확인 2건은 기획자에게 전달.
