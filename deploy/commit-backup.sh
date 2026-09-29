#!/bin/sh
# Daily backup of Commit's state (installed as /usr/local/sbin/commit-backup, run by commit-backup.timer).
# Contents: a consistent snapshot of commit.sqlite (projects, payout ledger, reports, sessions, audit) plus the
# Pawns registry, fee ledger, metadata and uploads under solana/ and uploads/. Root-only, 14 days kept.
set -eu
DATA=${COMMIT_DATA_DIR:-/var/lib/commit}
DEST=${COMMIT_BACKUP_DIR:-/var/backups/commit/daily}
KEEP_DAYS=${COMMIT_BACKUP_DAYS:-14}
umask 077
mkdir -p "$DEST"
TS=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
node /usr/local/lib/commit/sqlite-snapshot.cjs "$DATA/commit.sqlite" "$WORK/commit.sqlite"
tar -czf "$DEST/commit-$TS.tar.gz.part" -C "$WORK" commit.sqlite \
  -C "$DATA" --exclude=./commit.sqlite --exclude=./commit.sqlite-wal --exclude=./commit.sqlite-shm .
tar -tzf "$DEST/commit-$TS.tar.gz.part" >/dev/null
mv "$DEST/commit-$TS.tar.gz.part" "$DEST/commit-$TS.tar.gz"
find "$DEST" -name 'commit-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'commit-*.tar.gz.part' -mmin +60 -delete
echo "commit backup ok: $DEST/commit-$TS.tar.gz ($(du -h "$DEST/commit-$TS.tar.gz" | cut -f1))"
