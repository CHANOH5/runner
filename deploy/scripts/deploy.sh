#!/usr/bin/env bash
# 배포 (서버에서): scripts/deploy.sh <이미지 태그>
#   ECR 로그인 → 이미지 받기 → 마이그레이션 → api·worker·admin 교체 → /health 확인.
#   /health가 실패하면 직전 태그로 되돌린다 (마이그레이션은 되돌리지 않는다 — 항상 이전 코드와 호환되게 쓴다, tech/07 5장).
# 롤백도 같은 명령: scripts/deploy.sh <이전 태그>  (태그 기록: deploy/.deploy-history)
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

TAG=${1:?사용: scripts/deploy.sh <이미지 태그>}
PREV=${IMAGE_TAG:-}

REGISTRY=${SERVER_IMAGE%%/*}
if [[ $REGISTRY == *.amazonaws.com ]]; then
  # 서버 인스턴스 역할로 로그인 (액세스 키 없음)
  aws ecr get-login-password --region ap-northeast-2 |
    docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
fi

export IMAGE_TAG=$TAG
log "이미지 받기: $TAG"
dc pull api admin

log "마이그레이션"
dc --profile ops run --rm migrate

log "서비스 교체"
dc up -d --remove-orphans

healthy() {
  for _ in $(seq 1 30); do
    if dc exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if healthy; then
  sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env && rm -f .env.bak
  echo "$(date -u +%FT%TZ) $TAG" >>.deploy-history
  log "배포 완료: $TAG (이전: ${PREV:-없음})"
else
  log "/health 실패 — 로그: docker compose -f compose.prod.yml logs --tail=100 api"
  if [[ -n $PREV ]]; then
    log "직전 태그로 되돌림: $PREV"
    IMAGE_TAG=$PREV dc up -d
  fi
  exit 1
fi
