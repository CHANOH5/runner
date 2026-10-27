#!/usr/bin/env bash
# 매일 DB 백업 (서버에서, systemd 타이머 berun-backup.timer가 실행): pg_dump → 검사 → S3.
#   s3://$BACKUP_BUCKET/postgres/daily/berun-<UTC 시각>.dump  (pg_dump custom 형식)
#   버킷은 저장 암호화(SSE-S3)·TLS만·공개 차단, 수명 주기 규칙이 35일 지난 백업을 지운다 (P-RET-02, infra single-stack)
#   S3 업로드는 서버 인스턴스 역할로 한다 (액세스 키 없음)
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

: "${BACKUP_BUCKET:?deploy/.env에 BACKUP_BUCKET}"
WORK=$(mktemp -d /var/tmp/berun-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
FILE="$WORK/berun-$(date -u +%Y%m%dT%H%M%SZ).dump"

log "pg_dump 시작"
dc exec -T postgres pg_dump -U berun -d berun --format=custom --no-owner >"$FILE"

# 잘린 덤프를 올리지 않도록 목차를 읽어 본다
dc exec -T postgres pg_restore --list >/dev/null <"$FILE"
SIZE=$(wc -c <"$FILE" | tr -d ' ')
if ((SIZE < 1024)); then
  log "덤프가 너무 작습니다 (${SIZE}B) — 업로드하지 않음" >&2
  exit 1
fi

KEY="postgres/daily/$(basename "$FILE")"
aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/$KEY" --only-show-errors
log "백업 완료: s3://$BACKUP_BUCKET/$KEY (${SIZE}B)"
