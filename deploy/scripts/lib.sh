# shellcheck shell=bash
# 운영 스크립트 공통 (source로 읽는다). deploy/ 폴더에서 .env를 읽고 compose 함수를 만든다.
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "deploy/.env가 없습니다 (.env.example 참고)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

dc() { docker compose -f compose.prod.yml "$@"; }

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
