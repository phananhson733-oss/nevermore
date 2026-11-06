#!/bin/sh
# @input  -- TASKS_DATABASE_URL; the numbered NNNN_name.sql files beside this script
# @output -- every file not yet listed in task_center.schema_migrations applied once, each in its own transaction
# @pos    -- the only thing that changes the gengrowth_tasks schema; deploy.sh and the SQL tests both run it
# 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
#
#   TASKS_DATABASE_URL=postgres://... apps/marketing/db/tasks/migrate.sh
#
# Safe to run again: a file already recorded is skipped. A file that fails is
# rolled back whole and stops the run, so the next run retries it. Applied
# files are never edited; a change is a new, higher-numbered file.
set -eu

dir=$(cd "$(dirname "$0")" && pwd)
: "${TASKS_DATABASE_URL:?TASKS_DATABASE_URL is required}"

# Keeps "already exists, skipping" notices out of every deploy log.
PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
export PGOPTIONS

run() { psql "$TASKS_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

run -c "create schema if not exists task_center" \
    -c "create table if not exists task_center.schema_migrations (
          filename    text        primary key,
          applied_at  timestamptz not null default now()
        )"

for file in "$dir"/[0-9]*.sql; do
  [ -e "$file" ] || continue
  name=$(basename "$file")
  # The name is spliced into SQL below, so only this shape is accepted.
  case $name in
    *[!a-z0-9_.]*) echo "migrate: refusing file name $name" >&2; exit 1 ;;
    [0-9][0-9][0-9][0-9]_*.sql) ;;
    *) echo "migrate: refusing file name $name" >&2; exit 1 ;;
  esac
  applied=$(run -tA -c "select 1 from task_center.schema_migrations where filename = '$name'")
  [ "$applied" = 1 ] && continue
  run -1 -f "$file" -c "insert into task_center.schema_migrations (filename) values ('$name')"
  echo "migrate: applied $name"
done
