# BeRun (가칭)

러닝 대회를 중심으로 "찾고 → 목표를 세우고 → 함께 달리는" 대회 참가자용 소셜 앱. 프로젝트 규칙은 [`CLAUDE.md`](CLAUDE.md), 설계 문서는 [`docs/`](docs/)에 있다.

## 구조

```
.
├── app/                 Expo 앱 (자리만, D-005)
├── packages/shared/     앱·서버 공유 Zod 스키마·타입 (@berun/shared, tech/06)
├── server/              API 서버 (Node 22 + TypeScript + Fastify + Drizzle)
│   ├── src/
│   │   ├── app.ts           buildApp(의존성 주입) — 테스트도 이걸 쓴다
│   │   ├── server.ts        실행 진입점
│   │   ├── config/env.ts    환경 변수 Zod 검증
│   │   ├── db/              schema/ (Drizzle), migrations/, migrate.ts, seed.ts
│   │   ├── lib/             에러, 검증 에러 변환, KST 날짜
│   │   ├── plugins/         에러 핸들러, 인증(JWT 검증)
│   │   └── modules/         health, auth, users, races, registrations,
│   │                        records, predictions, notifications, admin
│   ├── scripts/         dev-keys, dev-token
│   └── test/            통합 테스트 (로컬 DB·Redis 사용)
├── docker-compose.yml   PostgreSQL 16 + PostGIS, Redis 7
└── docs/
```

## 로컬 실행

필요한 것: Node 22 (`.nvmrc`), pnpm 10, Docker.

```bash
# pnpm이 없으면: corepack enable  (또는 npm i -g pnpm@10)
pnpm install
cp .env.example .env

pnpm db:up        # docker compose up -d --wait (Postgres :55432, Redis :56379)
pnpm db:migrate   # 마이그레이션 적용
pnpm db:seed      # 개발용 시드 (여러 번 실행해도 됨)
pnpm dev          # http://localhost:3000
```

```bash
curl localhost:3000/health
# {"status":"ok","checks":{"db":"ok","redis":"ok"}}
```

### 인증이 필요한 API 호출해 보기

로그인(소셜) 연동 전이라 개발용 키와 토큰을 직접 만든다.

```bash
pnpm --filter @berun/server dev:keys   # 출력된 JWT_PUBLIC_KEY / JWT_PRIVATE_KEY 두 줄을 .env에 넣고 dev 서버 재시작
TOKEN=$(pnpm --filter @berun/server -s dev:token)   # 시드 개발 사용자의 access token (12시간)

curl -X POST localhost:3000/v1/me/predictions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"target":{"type":"distance","distanceM":21097},"recordIds":null}'
```

시드 개발 사용자는 PRD 5.7 예시 1과 같은 10K 기록 3개와 `[개발] 한강 가을 하프마라톤` 하프 참가 등록(`0199f000-0000-7000-8000-000000000301`)을 갖고 있어, 하프 예측 결과가 2:03:22로 나온다.

### 구현된 API (T-016, T-018)

| 영역 | 엔드포인트 |
|---|---|
| 상태 | `GET /health` |
| 앱 설정 | `GET /v1/app-config` |
| 인증·가입 | `POST /v1/auth/social`, `POST /v1/auth/signup`, `POST /v1/auth/signup/abort`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/terms/current`, `GET /v1/nicknames/availability` |
| 내 정보·설정 | `GET /v1/me`, `PATCH /v1/me/profile`, `GET·PATCH /v1/me/privacy`, `GET·PATCH /v1/me/notification-settings`, `GET·POST /v1/me/consents`, `PUT·DELETE /v1/me/device`, `DELETE /v1/me` (탈퇴) |
| 대회 | `GET /v1/races`, `GET /v1/races/{raceId}`, `PUT·DELETE /v1/races/{raceId}/interest`, `POST /v1/races/{raceId}/reports` |
| 참가 예정·접수 상태 | `POST /v1/races/{raceId}/registration`, `GET·PATCH·DELETE /v1/registrations/{id}`, `GET /v1/me/races?tab=` |
| 홈 | `GET /v1/home/next-race`, `GET /v1/home/deadlines`, `GET /v1/home/recommended` |
| 기록 | `GET·POST /v1/me/records`, `PATCH·DELETE /v1/me/records/{id}` |
| 예측 | `POST /v1/me/predictions`, `POST /v1/me/predictions/preview`, `GET /v1/me/predictions/candidates`, `GET /v1/me/predictions`, `GET /v1/me/predictions/{id}`, `GET /v1/registrations/{id}/strategy` |
| 알림 목록 | `GET /v1/me/notifications`, `GET /v1/me/notifications/unread-count`, `POST /v1/me/notifications/read` |
| 관리자 (`/api/admin/v1`) | 인증 `POST /auth/login`·`/auth/mfa`·`/auth/logout`, `GET /auth/me` / 계정 `GET·POST /admins`, `PATCH /admins/{id}` / 대회 `GET·POST /races`, `GET·PUT·DELETE /races/{id}`, `POST /races/{id}/publish·unpublish·hide·clone`, `GET /races/duplicates`, `GET /races/{id}/impact` / 제보 `GET /reports`, `GET /reports/{id}`, `POST /reports/resolve` |

- 공통: 약관 재동의 게이트(403 `TERMS_REQUIRED`), `X-App-Version`·`X-Platform`이 있으면 최소 버전 검사(426).
- 소셜 로그인은 provider 키(`.env.example`의 `KAKAO_APP_ID` 등)가 있어야 동작한다. 키 없이 화면 흐름을 확인하려면 위 `dev:token`을 쓴다. 통합 테스트는 가짜 verifier를 쓴다.
- 로그인·가입·토큰 회전은 `JWT_PRIVATE_KEY`, Apple 로그인은 `TOKEN_ENC_KEY`도 필요하다 (`openssl rand -base64 32`).

### 알림 워커 (T-019)

```bash
pnpm --filter @berun/server notifications:recalc   # 게시된 예정 대회의 알림 예약표 다시 계산 (시드 후 1회)
pnpm --filter @berun/server worker                 # BullMQ 워커: 1분마다 대상 확정(발송 30분 전) + 발송
```

- `.env`의 `PUSH_DRY_RUN=true`(운영이 아니면 기본값)이면 Expo로 보내지 않고 로그만 남긴다. 실제 발송은 운영 환경에서만 끈다.
- 같은 워커가 **소셜 연결 해제**(카카오 unlink·Apple revoke, 1분마다), 정리(매일 04:20: 7일 지난 식별자, 1년 지난 실패 기록), **휴면 처리**(매일 10:00: 30일 전 안내 → 1년 미접속 휴면)도 돌린다. `UNLINK_DRY_RUN=true`(운영이 아니면 기본값)이면 provider를 호출하지 않고 성공으로 처리한다.
- 관리자 대회 저장 후에는 `enqueueRaceUpdated(queue, { raceId, notify? })`로 예약표 재계산·N-06을 넣는다 (`server/src/worker/queue.ts`).

### 관리자 API 로컬 확인 (T-020)

- `.env`에 `TOKEN_ENC_KEY`(`openssl rand -base64 32`)가 있으면 `pnpm db:seed`가 **개발용 owner** `dev-owner@example.com` / `dev-owner-password-local-only`를 만든다 (로컬 전용 값, 운영 첫 owner는 배포 시 별도 시드).
- 2단계 인증 코드: `pnpm --filter @berun/server dev:admin-totp`
- 순서: `POST /api/admin/v1/auth/login` → `{ mfaToken }` → `POST /auth/mfa { mfaToken, totp }` → 세션 쿠키 + `csrfToken`. 쓰기 요청에는 `X-CSRF-Token`, 대회 수정에는 `If-Match: {updatedAt}`.

## 스크립트 (루트)

| 명령 | 내용 |
|---|---|
| `pnpm dev` | 서버 개발 모드 (tsx watch) |
| `pnpm build` | 전체 빌드 (`packages/shared` → `server`) |
| `pnpm lint` | ESLint + Prettier 검사 (`pnpm format`으로 정리) |
| `pnpm typecheck` | 전체 `tsc --noEmit` |
| `pnpm test` | 전체 Vitest. 서버 통합 테스트는 `pnpm db:up`이 먼저 필요 |
| `pnpm db:up` / `db:down` | 로컬 DB·Redis 켜기·끄기 |
| `pnpm db:migrate` / `db:seed` | 마이그레이션 / 시드 |
| `pnpm db:generate` | Drizzle 스키마 변경 → 마이그레이션 SQL 생성 |

## DB 마이그레이션 규칙

- 테이블·인덱스는 `server/src/db/schema/`를 고치고 `pnpm db:generate`로 SQL을 만든다. 만든 SQL은 커밋 전에 읽어 본다.
- **공간 컬럼(geography)은 Drizzle 스키마에 두지 않는다.** `pnpm --filter @berun/server exec drizzle-kit generate --custom --name=<이름>`으로 빈 마이그레이션을 만들고 raw SQL로 쓴다 (예: `0002_postgis_columns.sql`의 `races.venue_point`). 조회·저장도 `sql\`...\``로 한다.
- PK는 UUID v7을 애플리케이션에서 만든다 (PostgreSQL 16에 `uuidv7()` 없음).
- 이미 적용된 마이그레이션 파일은 고치지 않는다. 새 파일을 추가한다.

## CI

`.github/workflows/ci.yml` — push·PR마다: install(`--frozen-lockfile`) → lint → typecheck → build → 테스트 DB 생성 → migrate → seed → test. PostGIS·Redis는 서비스 컨테이너(로컬과 같은 이미지·포트 55432/56379), Node는 `.nvmrc`. 비밀값은 쓰지 않는다.

로컬에서 같은 순서로 확인하려면 (새 DB 이름으로, Node 22):

```bash
docker compose exec -T postgres psql -U berun -d berun -c "CREATE DATABASE berun_ci OWNER berun"
```

그 뒤 깨끗한 clone에서 `DATABASE_URL=…/berun_ci`, `TEST_DATABASE_URL=…/berun_ci_test`로 워크플로의 `run:` 단계를 순서대로 실행한다 (`berun_ci_test`는 migrate 전에 같은 방법으로 만든다).

## 테스트

- 단위 테스트: `server/src/**/*.test.ts` (예: 예측 엔진 — PRD 5.7 예시 3개를 그대로 검증)
- 통합 테스트: `server/test/*.test.ts`. 테스트 DB `berun_test`(docker 초기화 스크립트가 만든다)를 매 실행마다 비우고 마이그레이션을 처음부터 적용한다. Redis는 DB 1번.
- 다른 DB를 쓰려면 `TEST_DATABASE_URL`, `TEST_REDIS_URL`을 지정한다.

## 참고

- 운영 배포 시 마이그레이션은 `server/src/db/migrations`를 그대로 쓴다 (`pnpm db:migrate`, tsx 실행). 빌드 산출물(`dist`)에는 포함하지 않는다.
- `docker-compose.yml`의 PostGIS 이미지는 arm64 빌드가 있는 `imresamu/postgis:16-3.5`다 (공식 `postgis/postgis`는 amd64만).
