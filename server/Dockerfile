# syntax=docker/dockerfile:1.7
# 서버 운영 이미지 (T-029, tech/07). API와 워커가 같은 이미지를 쓰고 ECS 서비스에서 명령만 다르다:
#   API:    node dist/server.js           (기본 CMD)
#   워커:   node dist/worker/index.js
#   마이그레이션: node dist/db/migrate.js  (배포 전 ECS 일회성 작업)
#   첫 owner:     node dist/cli/create-owner.js --email ...  (ECS Exec, tech/07)
# 빌드 (저장소 루트에서): docker build -f server/Dockerfile -t berun-server .

ARG NODE_VERSION=22.23.4

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /repo

# ---- 의존성 (매니페스트만 먼저 복사해 캐시) ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY admin/package.json admin/
COPY app/package.json app/
COPY infra/package.json infra/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @berun/server... --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
RUN pnpm --filter @berun/shared build \
 && pnpm --filter @berun/server build \
 # 마이그레이션 SQL은 tsc 산출물에 없으므로 dist 옆에 둔다 (migrate.ts는 dist/db/migrations를 읽는다)
 && cp -r server/src/db/migrations server/dist/db/migrations
# 운영 의존성만 담은 독립 폴더 (워크스페이스 패키지 @berun/shared는 dist 포함 복사)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @berun/server deploy --prod --legacy /out \
 && cp -r server/dist /out/dist

# ---- 실행 ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# root가 아닌 기본 사용자 node (uid 1000)
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]
