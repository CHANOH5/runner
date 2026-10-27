# T-030 관리자 공지·푸시 + 분석 이벤트 완료 — 검토·병합 요청 (T-028 다음)

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-030, A-008, N-08, S-011, D-017, P-NOTI-02, P-PRI-08
- 상태: 닫힘

## 내용

브랜치 `claude/t030` (`claude/app-t028` 기준). push·병합하지 않았다. T-028 다음에 병합해 달라.

**구현**
1. 서버 관리자 공지 API (tech/06 7.6 전부 + 편집용 `GET /notices/{id}`): 작성·수정(발송 전만)·대상 수·테스트 발송·승인(owner)·내리기. 쓰기 owner·operator, 승인 owner, 조회 viewer까지. 감사 로그 자동. 마케팅 "(광고) " 표기·수신 동의자만·08:00~20:59(저장·승인·게시·발송 네 번 확인), 푸시 본문 60자(마케팅은 수신 거부 안내 포함).
2. 발송: 워커 tick에 `materializeNotices` 추가 → 게시 시각이 된 공지를 대상자별 앱 내 알림으로 만들고, 푸시 동반이면 **기존 `sendDue` 경로**(임대·배치·재시도·무효 토큰·`sent_at`)로 보낸다. 내리면 미발송 푸시 취소, 앱 상세 410. 발송 통계는 알림 행 집계(테스트 제외).
3. 관리자 웹 A-008: 목록(발송·성공·실패·열람, 승인 대기, 내리기), 작성·수정(미리보기, 대상 수, 대회 검색 링크, 즉시·예약, 마케팅 야간 경고), 발송 확인 모달(대상 수·미리보기), 테스트 발송, 발송 결과.
4. 앱 공지 상세: T-028에서 `GET /notices/{id}` 연결 완료 — 확인만 (마케팅 제목 접두는 서버가 붙임).
5. PostHog (D-017): 앱·관리자 웹 분석 래퍼(키 없으면 no-op, capture HTTP API), PRD 2.3 앱 이벤트 21종 + 관리자 6종, 이메일·닉네임·좌표·주소 거름망과 테스트. 문서 `docs/tech/08-analytics.md (병합 때 07→08로 바뀜)`. env 이름만 `.env.example`.

**공지 모듈 밖에서 바꾼 서버 파일**
- `server/src/modules/admin/index.ts` — 공지 라우트 등록 (관리자 라우트 파일이라 불가피)
- `server/src/modules/notifications/delivery.ts` — `sendDue`가 kind `notice`·`marketing`도 집고 `prepare`가 공지 분기, `runTick`에 `materializeNotices` (기존 발송 경로 재사용)
- 새 파일: `server/src/modules/admin/notices-service.ts`, `server/test/notices-admin.test.ts`. 공지 모듈 `server/src/modules/notifications/notices.ts`는 확장
- DB 스키마·마이그레이션·`config/`·`infra/` 변경 없음 (개발-서버 세션 작업과 겹치지 않음)
- `packages/shared`: 새 파일 `admin-notices.ts` + `index.ts` export 한 줄

**확인**
- 관리자 웹(로컬 :3100 → API :3001, 워커 `PUSH_DRY_RUN=true`)에서 공지 작성 → 예약(2분 뒤) → 발송 확인 모달(대상 2명) → 승인 → 예약 시각에 워커가 게시·발송(dry-run) — 결과는 보고에 적음.
- 테스트: 서버 264 (기존 250 + 14), 관리자 18 (+9), 앱 101 (+5). lint·typecheck 통과.

**남은 것 / 결정 필요**
- 대시보드(A-002) 알림 발송·실패 카드: `GET /dashboard` API가 아직 없어 연결하지 않았다 (공지 통계는 A-008에 있음). 대시보드 API를 다음 서버 작업으로 배정할지.
- PostHog 호스트(미국·EU 클라우드 / 자체 호스팅)는 [미정] — 개인정보 국외 이전 기재(미결 법률 질문)와 함께 정해야 키를 넣을 수 있다.
- 앱 푸시 탭으로 열릴 때의 `notification_opened`·읽음 처리는 Development Build 작업에서 (지금은 S-011 탭만).

**보드 갱신 요청**: T-030 → `검토`.

## 답변

- (orchestrator, 2026-10-27) 사용자 승인으로 T-028 포함 main에 병합 (T-029보다 먼저). 분석 문서는 tech/07-deploy와 번호가 겹쳐 `tech/08-analytics.md`로 바꿈. 대시보드 API는 다음 서버 작업 후보로 보드에 올릴 예정, PostHog 호스트는 미결 질문에 기록. 상태: 닫힘
