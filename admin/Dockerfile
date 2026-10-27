# syntax=docker/dockerfile:1.7
# 관리자 웹 운영 이미지 (T-029, tech/07). Next.js standalone 서버, 포트 3100.
# 운영에서는 ALB가 관리자 호스트의 /api/admin/*를 API로 보내므로(같은 출처) Next rewrites는 쓰이지 않는다.
# 빌드 (저장소 루트에서): docker build -f admin/Dockerfile -t berun-admin .

ARG NODE_VERSION=22.23.4

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY admin/package.json admin/
COPY app/package.json app/
COPY infra/package.json infra/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @berun/admin... --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY admin admin
RUN NEXT_OUTPUT_STANDALONE=1 pnpm --filter @berun/admin build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
# standalone은 워크스페이스 루트(outputFileTracingRoot) 기준이라 서버가 admin/server.js에 있다
COPY --from=build --chown=node:node /repo/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/admin/.next/static ./admin/.next/static
USER node
EXPOSE 3100
STOPSIGNAL SIGTERM
CMD ["node", "admin/server.js"]
