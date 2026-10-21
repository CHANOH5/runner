# T-016 개발 기초 완료 — 검토·병합 요청

- From: developer
- To: orchestrator
- 종류: 전달 (+ 병합 승인 요청)
- 관련 ID: T-016, D-005, D-006, D-010, D-017
- 상태: 열림

## 내용

브랜치 `claude/dev-foundation-a441ef`(워크트리)에 T-016을 끝냈다. push·main 병합은 하지 않았다. 사용자 승인 후 병합해 달라.

**만든 것**
- pnpm 모노레포: `server/`, `packages/shared`(공유 Zod 스키마), `app/`(자리). TS strict, ESLint, Prettier, `.nvmrc`(22), 루트 스크립트 `dev/build/lint/typecheck/test`
- `docker-compose.yml`: PostgreSQL 16 + PostGIS 3.5, Redis 7 (호스트 포트 55432/56379), `.env.example`
- DB: Phase 1 테이블 27개 Drizzle 스키마 + 마이그레이션 3개(PostGIS 확장 / 테이블 / 공간 컬럼 raw SQL), 개발 시드(약관 4종, 대회 5개·종목 9개, 개발 사용자·기록·참가 등록)
- Fastify 서버 골격: env 검증, pino 로깅, tech/06 형식 에러 처리, `/health`, 모듈 폴더 8개, JWT(ES256) 검증 골격
- 기록 예측 `riegel-1.06-v1` + `POST /v1/me/predictions`, `POST /v1/me/predictions/preview`
- 테스트 33개 통과 (예측 단위 16 — PRD 5.7 예시 3개 포함, 통합 17 — `/health` 4, 예측 API 13)

**보드 갱신 요청**: T-016 → `검토` (또는 병합 후 `완료`).

**알아 둘 것 (결정 필요 없음, tech 문서에 반영함)**
1. `tech/04` 도메인 표에서 `race_courses`, `registration_verifications`를 Phase 2로 고쳤다. PRD 9장(코스 경로·참가 인증은 Phase 2)과 맞추기 위해서다. 이번 마이그레이션에 두 테이블은 없다.
2. 예측 API에서 기록 6개 이상 선택은 `tech/06`의 두 기술(스키마 max 400 / 422 `LIMIT_EXCEEDED`)이 겹쳐 있어 422로 통일했다.
3. 로컬 PostGIS 이미지는 arm64 지원 때문에 `imresamu/postgis:16-3.5`(PostGIS Docker 관리자의 멀티 아키텍처 빌드)를 쓴다. 운영은 RDS라 영향 없음.

**다음 작업 제안**
1. 소셜 로그인·가입·토큰 발급(`/auth/*`) + 약관 재동의 게이트·최소 앱 버전 공통 미들웨어
2. 대회 조회 API(`/races`, 유효 접수 기간 계산, 커서 페이지네이션) + 기록 CRUD(`/me/records`) — 앱 첫 화면에 필요
3. 예측 나머지(`candidates`, 목록·상세) + 요청 제한·멱등 키
4. CI(GitHub Actions: lint·typecheck·test + PostGIS 서비스 컨테이너)

## 기대하는 결과물 / 답변 형식
병합 승인 여부, 보드 갱신, 다음 작업 배정.

## 답변 (받는 쪽이 작성)
