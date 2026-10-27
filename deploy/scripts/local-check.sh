#!/usr/bin/env bash
# 배포 전 로컬 확인 — 상시 staging 대신 (D-022, tech/07 7장).
# 운영 이미지와 compose.prod.yml을 이 컴퓨터에서 그대로 띄우고 경로·접근 제한을 점검한 뒤 지운다.
#   deploy/scripts/local-check.sh          # 이미지 빌드부터
#   SKIP_BUILD=1 KEEP=1 deploy/scripts/local-check.sh   # 빌드 생략, 끝나도 띄워 둠
# 운영과 다른 점: KMS가 없어 NODE_ENV=test + 일회용 평문 키, 도메인은 *.localhost(Caddy 내부 인증서), 포트 18080·18443·18081.
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$DEPLOY_DIR"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/berun-localcheck.XXXXXX")
PROJECT=berun-localcheck

# 값은 매번 새로 만들고 끝나면 버린다 (개발용, 커밋하지 않음)
cat >"$WORK/.env" <<EOF
NODE_ENV=test
IMAGE_TAG=local
API_HOST=api.localhost
ADMIN_HOST=admin.localhost
ACME_EMAIL=dev-only@example.com
ADMIN_ALLOW_CIDRS=
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
HTTP_PORT=18080
HTTPS_PORT=18443
ADMIN_TUNNEL_PORT=18081
APP_ENV_FILE=$WORK/.env.app
EOF
cat >"$WORK/.env.app" <<EOF
LOG_LEVEL=info
TOKEN_ENC_KEY=$(openssl rand -base64 32)
PUSH_DRY_RUN=true
UNLINK_DRY_RUN=true
EOF

dc() { docker compose -p "$PROJECT" --env-file "$WORK/.env" -f compose.prod.yml "$@"; }
# shellcheck disable=SC2317,SC2329 # trap으로 호출 (shellcheck 0.9는 SC2317, 0.10+는 SC2329)
cleanup() {
  if [[ ${KEEP:-} == 1 ]]; then
    echo "띄워 둠 — 지우기: docker compose -p $PROJECT --env-file $WORK/.env -f $DEPLOY_DIR/compose.prod.yml down -v"
  else
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

dc config --quiet
[[ ${SKIP_BUILD:-} == 1 ]] || dc build
dc --profile ops run --rm migrate
dc up -d --wait --wait-timeout 120

FAIL=0
expect() { # 이름, 기대 상태 코드, curl 인자…
  local name=$1 want=$2
  shift 2
  local got
  got=$(curl -sk -o /dev/null -w '%{http_code}' "$@" || true)
  if [[ $got == "$want" ]]; then echo "ok   $name ($got)"; else
    echo "FAIL $name: 기대 $want, 실제 $got"
    FAIL=1
  fi
}
API=(--resolve api.localhost:18443:127.0.0.1)
ADMIN=(--resolve admin.localhost:18443:127.0.0.1)

expect 'API /health (HTTPS)' 200 "${API[@]}" https://api.localhost:18443/health
expect 'HTTP → HTTPS 리디렉션' 308 --resolve api.localhost:18080:127.0.0.1 http://api.localhost:18080/health
expect 'API 호스트의 관리자 API 차단' 404 "${API[@]}" https://api.localhost:18443/api/admin/v1/auth/me
expect '관리자 호스트: 허용 IP 비면 전부 차단' 403 "${ADMIN[@]}" https://admin.localhost:18443/login
expect '터널: 관리자 웹' 200 http://127.0.0.1:18081/login
expect '터널: 관리자 API(같은 출처, 미로그인)' 401 http://127.0.0.1:18081/api/admin/v1/auth/me
for svc in postgres redis; do
  if [[ -n $(docker port "$(dc ps -q "$svc")") ]]; then
    echo "FAIL $svc 포트가 호스트에 열려 있음"
    FAIL=1
  else echo "ok   $svc 포트 비공개"; fi
done
echo "메모리 (한도 대비):"
# shellcheck disable=SC2046 # 컨테이너 id 목록을 인자로 펼친다
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}' $(dc ps -q)

exit $FAIL
