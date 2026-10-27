#!/usr/bin/env bash
# 복구 리허설: 백업을 운영 DB와 분리된 임시 PostgreSQL 컨테이너에 복원하고 기본 점검만 한 뒤 지운다.
# 운영 데이터는 건드리지 않는다. 월 1회 권장 (tech/07 6장).
#   scripts/restore-rehearsal.sh                 # S3의 가장 최근 백업 (서버에서, BACKUP_BUCKET 필요)
#   scripts/restore-rehearsal.sh s3://.../x.dump # 특정 백업
#   scripts/restore-rehearsal.sh ./x.dump        # 로컬 파일 (.env 없이도 된다)
set -euo pipefail

SRC=${1:-latest}
IMAGE=imresamu/postgis:16-3.5
NAME=berun-restore-rehearsal-$$
WORK=$(mktemp -d "${TMPDIR:-/tmp}/berun-rehearsal.XXXXXX")
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [[ $SRC == latest || $SRC == s3://* ]]; then
  if [[ $SRC == latest ]]; then
    DEPLOY_DIR=$(cd "$(dirname "$0")/.." && pwd)
    BACKUP_BUCKET=${BACKUP_BUCKET:-$(sed -n 's/^BACKUP_BUCKET=//p' "$DEPLOY_DIR/.env" 2>/dev/null)}
    : "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
    LATEST=$(aws s3 ls "s3://$BACKUP_BUCKET/postgres/daily/" | sort | tail -n 1 | awk '{print $4}')
    [[ -n $LATEST ]] || {
      echo "백업이 없습니다" >&2
      exit 1
    }
    SRC="s3://$BACKUP_BUCKET/postgres/daily/$LATEST"
  fi
  echo "내려받기: $SRC"
  aws s3 cp "$SRC" "$WORK/backup.dump" --only-show-errors
else
  cp "$SRC" "$WORK/backup.dump"
fi

# 네트워크 없는 임시 DB (비밀번호는 매번 새로 만들고 버린다)
docker run -d --name "$NAME" --network none \
  -e POSTGRES_USER=berun -e POSTGRES_DB=berun -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -v "$WORK:/backup:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U berun -d berun >/dev/null 2>&1 && break
  sleep 1
done

# PostGIS 이미지는 초기 DB에 확장을 미리 깔아 두므로, 빈 template0에서 만든 DB에 복원한다 (운영 restore.sh와 같은 방식)
docker exec "$NAME" createdb -U berun -T template0 restored
START=$(date +%s)
docker exec "$NAME" pg_restore -U berun -d restored --no-owner --exit-on-error /backup/backup.dump
echo "복원 시간: $(($(date +%s) - START))초"

q() { docker exec "$NAME" psql -U berun -d restored -tAc "$1"; }
echo "마이그레이션 수: $(q 'select count(*) from drizzle.__drizzle_migrations')"
echo "PostGIS: $(q 'select postgis_version()')"
echo "테이블별 행 수 (상위 10):"
q "select relname || ' ' || n_live_tup from pg_stat_user_tables where schemaname = 'public' order by n_live_tup desc limit 10" |
  sed 's/^/  /'
for t in users races race_events admin_users admin_audit_logs; do
  echo "  $t: $(q "select count(*) from $t" 2>/dev/null || echo '없음')"
done
echo "리허설 성공 — 임시 DB를 지웁니다"
