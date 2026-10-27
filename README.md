# BeRun (가칭)

러닝 대회를 중심으로 "찾고 → 목표를 세우고 → 함께 달리는" 대회 참가자용 소셜 앱. 프로젝트 규칙은 [`CLAUDE.md`](CLAUDE.md), 설계 문서는 [`docs/`](docs/)에 있다.

## 구조

```
.
├── app/                 모바일 앱 (Expo SDK 58 + Expo Router, D-005, T-025) — 웹(react-native-web)으로도 실행
├── infra/               AWS CDK (staging·prod 스택, 배포는 수동 — docs/tech/07)
├── admin/               관리자 웹 (Next.js 15, A-001~A-004·A-008, tech/03 9-0-1)
├── packages/shared/     앱·서버·관리자 웹 공유 Zod 스키마·타입 (@berun/shared, tech/06)
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

시드 개발 사용자는 PRD 5.7 예시 1과 같은 10K 기록 3개와 `[개발] 한강 가을 하프마라톤` 하프 참가 등록(`0199f000-0000-7000-8000-000000000301`)을 갖고 있어, 하프 예측 결과가 2:03:22로 나온다. 알림 목록에는 개발용 공지 2개(보낸 공지 `…0501`, 내린 공지 `…0502` → 상세가 410)가 있다.

### 구현된 API (T-016, T-018)

| 영역 | 엔드포인트 |
|---|---|
| 상태 | `GET /health` |
| 앱 설정 | `GET /v1/app-config` |
| 인증·가입 | `POST /v1/auth/social`, `POST /v1/auth/signup`, `POST /v1/auth/signup/abort`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/terms/current`, `GET /v1/nicknames/availability` |
| 내 정보·설정 | `GET /v1/me`, `PATCH /v1/me/profile`, `GET·PATCH /v1/me/privacy`, `GET·PATCH /v1/me/notification-settings`, `GET·POST /v1/me/consents`, `PUT·DELETE /v1/me/device`, `DELETE /v1/me` (탈퇴) |
| 대회 | `GET /v1/races`, `GET /v1/races/count`, `GET /v1/races/calendar`, `GET /v1/races/{raceId}`, `PUT·DELETE /v1/races/{raceId}/interest`, `POST /v1/races/{raceId}/reports` |
| 참가 예정·접수 상태 | `POST /v1/races/{raceId}/registration`, `GET·PATCH·DELETE /v1/registrations/{id}`, `GET /v1/me/races?tab=` |
| 홈 | `GET /v1/home/next-race`, `GET /v1/home/deadlines`, `GET /v1/home/recommended` |
| 기록 | `GET·POST /v1/me/records`, `PATCH·DELETE /v1/me/records/{id}` |
| 예측 | `POST /v1/me/predictions`, `POST /v1/me/predictions/preview`, `GET /v1/me/predictions/candidates`, `GET /v1/me/predictions`, `GET /v1/me/predictions/{id}`, `GET /v1/registrations/{id}/strategy` |
| 알림 목록·공지 | `GET /v1/me/notifications`, `GET /v1/me/notifications/unread-count`, `POST /v1/me/notifications/read`, `GET /v1/notices/{id}` |
| 관리자 (`/api/admin/v1`) | 인증 `POST /auth/login`·`/auth/mfa`·`/auth/logout`, `GET /auth/me` / 계정 `GET·POST /admins`, `PATCH /admins/{id}` / 대회 `GET·POST /races`, `GET·PUT·DELETE /races/{id}`, `POST /races/{id}/publish·unpublish·hide·clone`, `GET /races/duplicates`, `GET /races/{id}/impact` / 제보 `GET /reports`, `GET /reports/{id}`, `POST /reports/resolve` / 원격 설정 `GET /app-configs`, `PUT /app-configs/{key}` |

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

### 관리자 웹 (T-024)

```bash
# .env에 TOKEN_ENC_KEY가 있어야 개발용 관리자가 시드된다 (없으면: openssl rand -base64 32 결과를 넣고)
pnpm db:seed
pnpm dev:admin       # API http://localhost:3000 + 관리자 웹 http://localhost:3100
```

브라우저에서 **http://localhost:3100** 을 열고 로그인한다.

- **개발용 로그인 계정** (로컬 전용, 시드 `server/src/db/seed.ts`의 `DEV_ADMIN`): 이메일 `dev-owner@example.com`, 비밀번호 `dev-owner-password-local-only`. 운영 첫 owner는 배포 시 별도로 만든다.
- **2단계 인증 코드**: 다른 터미널에서 `pnpm dev:admin-totp` → 6자리 코드(30초 유효). 개발용 TOTP 시드 비밀값은 시드 파일에 고정되어 있어 인증 앱에 등록하지 않아도 된다.
- 개발용 계정 시드와 TOTP 스크립트는 `NODE_ENV=production`이면 에러로 멈춘다. 운영에서 동작하는 로그인 우회는 없다.
- 관리자 웹은 같은 출처의 `/api/admin/*`를 API로 프록시한다 (`next.config.ts` rewrites, API 주소를 바꾸려면 `ADMIN_API_ORIGIN`). 세션 쿠키·CSRF는 관리자 API 그대로다.
- 화면: 로그인(A-001), 대시보드(A-002, API가 있는 대회·제보 수만), 대회 목록·등록·수정(A-003), 오류 제보(A-004), 공지·푸시(A-008, 자리만).
- 대회 폼 빠른 입력: 날짜 `20270315`·`0315`, 시각 `1000`·`9`, 종목 프리셋(하프+풀 등), 공통값 적용, `⌘/Ctrl+S` 저장, `⌘/Ctrl+Enter` 저장하고 새 대회(지역·종류 유지), 새 대회 30초 임시 저장, 복제.

관리자 API만 직접 부를 때: `POST /api/admin/v1/auth/login` → `{ mfaToken }` → `POST /auth/mfa { mfaToken, totp }` → 세션 쿠키 + `csrfToken`. 쓰기 요청에는 `X-CSRF-Token`, 대회 수정에는 `If-Match: {updatedAt}`.

### 모바일 앱 (T-025)

이 Mac에는 Xcode·Android SDK가 없어도 된다. **Expo 웹(react-native-web)** 으로 같은 앱을 브라우저에서 띄워 로컬 서버에 붙는다.

```bash
# .env에 DEV_LOGIN=true가 있어야 개발 전용 로그인이 된다 (.env.example 기본값)
pnpm dev:app         # API http://localhost:3000 + 앱(웹) http://localhost:8081
```

브라우저에서 **http://localhost:8081** 을 연다 (휴대폰 크기로 보려면 개발자 도구의 기기 모드).

- **개발 전용 로그인**: 로그인 화면 아래 "개발 전용 로그인" 카드에 이름(영문·숫자·`_`·`-` 1~40자)을 넣고 [개발 계정으로 로그인]. 서버가 소셜 provider를 부르지 않고 `dev:{이름}`을 그 provider의 사용자로 받는다 — 처음이면 약관·프로필 가입부터, 같은 이름이면 같은 계정이다. 카드는 개발 번들(`__DEV__`)에만 보이고, 서버는 `DEV_LOGIN=true` + `NODE_ENV≠production`일 때만 받는다 (운영이면 서버가 시작하지 않음, tech/03 8장).
- 웹은 같은 출처 `/v1/*`를 Metro 개발 서버가 API로 넘긴다 (`app/metro.config.js`, 주소를 바꾸려면 `BERUN_API_ORIGIN=http://localhost:3001`). 서버에 CORS를 열지 않는다.
- 3000 포트를 다른 서버가 쓰고 있으면: `PORT=3001 pnpm dev` + `BERUN_API_ORIGIN=http://localhost:3001 pnpm --filter @berun/app dev`.
- **웹에서 안 되는 것** (웹용 대체 구현): 토큰 저장은 SecureStore 대신 localStorage, 푸시 알림 권한·토큰 등록 없음(권한은 항상 '미결정'으로 보여 안내 화면만 확인), 지도는 자리 표시(D-008 확정 전, 네이티브도 같음), [길찾기]는 지도 앱 대신 네이버·Google 지도 웹, 인앱 브라우저 대신 새 탭.
- 실제 기기·시뮬레이터: Development Build 설정(`app/app.json`, `app/eas.json`)만 있고 빌드는 아직 하지 않았다. 빌드 후 `pnpm --filter @berun/app start`(dev client)로 붙고, API 주소는 `EXPO_PUBLIC_API_BASE_URL`로 준다 (실기기는 Mac의 LAN IP).
- 앱 구조·테스트: `app/README.md`

## 스크립트 (루트)

| 명령 | 내용 |
|---|---|
| `pnpm dev` | 서버 개발 모드 (tsx watch) |
| `pnpm dev:admin` | 서버(:3000) + 관리자 웹(:3100) 함께 |
| `pnpm dev:admin-totp` | 개발용 관리자 2단계 인증 코드 출력 (운영에서는 거부) |
| `pnpm dev:app` | 서버(:3000) + 모바일 앱 웹(:8081) 함께 |
| `pnpm build` | 전체 빌드 (`packages/shared` → `server`, `admin`) |
| `pnpm lint` | ESLint + Prettier 검사 (`pnpm format`으로 정리) |
| `pnpm typecheck` | 전체 `tsc --noEmit` |
| `pnpm test` | 전체 테스트 (서버·관리자 웹·공유 Vitest, 앱 Jest). 서버 통합 테스트는 `pnpm db:up`이 먼저 필요 |
| `pnpm db:up` / `db:down` | 로컬 DB·Redis 켜기·끄기 |
| `pnpm db:migrate` / `db:seed` | 마이그레이션 / 시드 |
| `pnpm db:generate` | Drizzle 스키마 변경 → 마이그레이션 SQL 생성 |

## DB 마이그레이션 규칙

- 테이블·인덱스는 `server/src/db/schema/`를 고치고 `pnpm db:generate`로 SQL을 만든다. 만든 SQL은 커밋 전에 읽어 본다.
- **공간 컬럼(geography)은 Drizzle 스키마에 두지 않는다.** `pnpm --filter @berun/server exec drizzle-kit generate --custom --name=<이름>`으로 빈 마이그레이션을 만들고 raw SQL로 쓴다 (예: `0002_postgis_columns.sql`의 `races.venue_point`). 조회·저장도 `sql\`...\``로 한다.
- PK는 UUID v7을 애플리케이션에서 만든다 (PostgreSQL 16에 `uuidv7()` 없음).
- 이미 적용된 마이그레이션 파일은 고치지 않는다. 새 파일을 추가한다.

## 운영 배포 준비 (T-029, D-022)

AWS 리소스는 아직 없다. 코드와 순서만 있다 — **배포는 사용자가 [`docs/tech/07-deploy.md`](docs/tech/07-deploy.md) 순서로 직접** 한다.
출시 초기 운영은 **서버 1대**(EC2 t4g.small)에 Docker Compose로 API·워커·관리자 웹·PostgreSQL·Redis·Caddy를 띄운다 (월 약 $23 추정).

```bash
deploy/scripts/local-check.sh         # 배포 전 확인: 운영 이미지·compose를 로컬에서 띄우고 점검 후 정리 (staging 대신)
pnpm --filter @berun/infra synth      # CDK 템플릿 생성만 (AWS 자격 증명 불필요) → infra/cdk.out
docker build -f server/Dockerfile -t berun-server .   # API·워커·마이그레이션 공용 이미지
docker build -f admin/Dockerfile -t berun-admin .     # 관리자 웹 (Next.js standalone)
```

- `deploy/`: `compose.prod.yml`, `Caddyfile`(자동 HTTPS·관리자 IP 제한·SSH 터널), 서버 스크립트(`deploy.sh`·`backup.sh`·`restore.sh`·`restore-rehearsal.sh`), 매일 백업 타이머. 서버의 `.env`·`.env.app`은 커밋하지 않는다.
- `infra/`: `Berun-Single`(EC2·인스턴스 역할·KMS 토큰 키·ECR·백업 버킷 35일)을 배포한다. `Berun-{Stage}-Base`·`-App`(ECS·RDS·ALB·NAT)은 확장 단계용으로 synth·테스트만 유지한다.
- 저장 암호화 키: 로컬·테스트는 `TOKEN_ENC_KEY`, 운영은 KMS로 감싼 데이터 키(`TOKEN_ENC_KEY_KMS_CIPHERTEXT`). 운영에서 평문 키는 거부된다.
- 운영 첫 owner: `node dist/cli/create-owner.js --email ...` (로컬 확인: `pnpm --filter @berun/server admin:create-owner -- --email ...`). 활성 owner가 있으면 거부, 감사 로그를 남긴다.

## CI

`.github/workflows/ci.yml` — push·PR마다: install(`--frozen-lockfile`) → lint → typecheck → build → 테스트 DB 생성 → migrate → seed → test → `cdk synth`, 그리고 server·admin Docker 이미지 빌드(push 없음), 운영 compose·Caddy 설정·셸 스크립트 검사(`deploy-config`). PostGIS·Redis는 서비스 컨테이너(로컬과 같은 이미지·포트 55432/56379), Node는 `.nvmrc`. 비밀값은 쓰지 않는다.

로컬에서 같은 순서로 확인하려면 (새 DB 이름으로, Node 22):

```bash
docker compose exec -T postgres psql -U berun -d berun -c "CREATE DATABASE berun_ci OWNER berun"
```

그 뒤 깨끗한 clone에서 `DATABASE_URL=…/berun_ci`, `TEST_DATABASE_URL=…/berun_ci_test`로 워크플로의 `run:` 단계를 순서대로 실행한다 (`berun_ci_test`는 migrate 전에 같은 방법으로 만든다).

## 테스트

- 단위 테스트: `server/src/**/*.test.ts` (예: 예측 엔진 — PRD 5.7 예시 3개를 그대로 검증)
- 통합 테스트: `server/test/*.test.ts`. 테스트 DB `berun_test`(docker 초기화 스크립트가 만든다)를 매 실행마다 비우고 마이그레이션을 처음부터 적용한다. Redis는 DB 1번.
- 관리자 웹: `admin/src/**/*.test.tsx` (Testing Library + jsdom, API는 가짜 fetch — DB 불필요). 로그인, 대회 저장·게시(422 누락 항목), 에러 표시.
- 모바일 앱: `app/src/**/*.test.ts(x)` (jest-expo + React Native Testing Library, API는 가짜 — DB 불필요). API 클라이언트·토큰 갱신, 복귀 질문 규칙, 예측 화면 상태 등 단위 테스트와 주요 화면 렌더 테스트.
- 다른 DB를 쓰려면 `TEST_DATABASE_URL`, `TEST_REDIS_URL`을 지정한다.

## 참고

- 운영 배포 시 마이그레이션은 `server/src/db/migrations`를 그대로 쓴다 (`pnpm db:migrate`, tsx 실행). 빌드 산출물(`dist`)에는 포함하지 않는다.
- `docker-compose.yml`의 PostGIS 이미지는 arm64 빌드가 있는 `imresamu/postgis:16-3.5`다 (공식 `postgis/postgis`는 amd64만).
