#!/usr/bin/env bash
# 실제 복구 (서버에서): 운영 DB를 백업 시점으로 되돌린다. 백업 이후 데이터는 사라진다.
#   scripts/restore.sh s3://<버킷>/postgres/daily/berun-....dump
# 순서: 지금 상태를 한 번 더 덤프(안전망) → api·worker 정지 → DB 다시 만들기 → pg_restore → 마이그레이션 → 기동.
# 먼저 restore-rehearsal.sh로 같은 백업이 복원되는지 확인한다 (tech/07 6장).
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

SRC=${1:?사용: scripts/restore.sh s3://<버킷>/postgres/daily/<파일>.dump}
read -r -p "운영 DB를 $SRC 시점으로 되돌립니다. 계속하려면 restore 입력: " answer
[[ $answer == restore ]] || {
  echo "취소"
  exit 1
}

WORK=$(mktemp -d /var/tmp/berun-restore.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
aws s3 cp "$SRC" "$WORK/backup.dump" --only-show-errors

log "안전망: 현재 DB를 백업"
"$DEPLOY_DIR/scripts/backup.sh"

log "api·worker 정지"
dc stop api worker

log "DB 다시 만들기 → 복원"
dc exec -T postgres psql -U berun -d postgres -v ON_ERROR_STOP=1 \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'berun' and pid <> pg_backend_pid()" \
  -c 'drop database berun' -c 'create database berun owner berun template template0'
dc exec -T postgres pg_restore -U berun -d berun --no-owner --exit-on-error <"$WORK/backup.dump"

log "마이그레이션·기동"
dc --profile ops run --rm migrate
dc up -d api worker
log "복구 완료 — /health와 관리자 화면을 확인하세요"
