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

## 테스트

- 단위 테스트: `server/src/**/*.test.ts` (예: 예측 엔진 — PRD 5.7 예시 3개를 그대로 검증)
- 통합 테스트: `server/test/*.test.ts`. 테스트 DB `berun_test`(docker 초기화 스크립트가 만든다)를 매 실행마다 비우고 마이그레이션을 처음부터 적용한다. Redis는 DB 1번.
- 다른 DB를 쓰려면 `TEST_DATABASE_URL`, `TEST_REDIS_URL`을 지정한다.

## 참고

- 운영 배포 시 마이그레이션은 `server/src/db/migrations`를 그대로 쓴다 (`pnpm db:migrate`, tsx 실행). 빌드 산출물(`dist`)에는 포함하지 않는다.
- `docker-compose.yml`의 PostGIS 이미지는 arm64 빌드가 있는 `imresamu/postgis:16-3.5`다 (공식 `postgis/postgis`는 amd64만).
