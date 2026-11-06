#!/usr/bin/env bash
# @input  -- a git ref; the clone and the two env files under /srv/gengrowth-marketing; pick's deploy/saas
# @output -- image gengrowth-marketing:<sha>, the task center schema migrated, the container running it, and pick's Caddy serving our site file
# @pos    -- gengrowth.ai's manual deploy on pick's Tencent VM, in place of Vercel's Git deploys
# 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
#
#   /srv/gengrowth-marketing/repo/apps/marketing/deploy/deploy.sh origin/main
#
# It prints the sha it replaced; passing that sha back is the rollback, and it
# skips the build because the image is still on the machine. Recreating the
# container cuts requests in flight and leaves a gap of about two seconds.
set -euo pipefail

root=${MARKETING_ROOT:-/srv/gengrowth-marketing}
pick=${PICK_SAAS:-/srv/pick-workbench/deploy/saas}
repo=$root/repo
env_file=$root/marketing.env
tasks_env=$root/tasks-db.env

die() { echo "deploy: $*" >&2; exit 1; }

# A KEY's value in an env file (marketing.env unless named), without the
# quotes `vercel env pull` adds.
env_value() {
  sed -n "s/^$1=//p" "${2:-$env_file}" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Compose expands $NAME inside double-quoted and bare env_file values, which
# would quietly change a secret; $$ is its escape for a literal $.
refuse_bare_dollars() {
  local names
  names=$(sed 's/\$\$//g' "$1" | grep -E "^[A-Za-z_][A-Za-z0-9_]*=([^']|\$)" | grep -F '$' | cut -d= -f1 | tr '\n' ' ' || true)
  [ -z "$names" ] || die "compose would expand the \$ in: ${names}(write each \$ as \$\$ in $1)"
}

# Brings the task center's tables up to date before the new image starts. A
# migration only adds, so the image still running keeps working against the
# new schema, and a failure here stops the deploy with that image still
# serving. A rollback to a sha from before the task center has no migrations
# and skips this.
migrate_tasks() {
  local dir=$repo/apps/marketing/db/tasks url
  [ -f "$dir/migrate.sh" ] || return 0
  url=$(env_value TASKS_DATABASE_URL "$tasks_env")
  [ -n "$url" ] || die "$tasks_env has no TASKS_DATABASE_URL; see apps/marketing/deploy/README.md"
  # Handed over through the environment rather than argv, so ps never shows it.
  TASKS_DATABASE_URL=$url docker run --rm --network drama -e TASKS_DATABASE_URL \
    -v "$dir:/migrations:ro" postgres:17.6 sh /migrations/migrate.sh
  echo "deploy: task center schema up to date"
}

caddy() { "$pick/platform.sh" exec -T caddy caddy "$@"; }

# Copy our site file into pick's Caddy and reload it, only when it changed.
# A broken file would fail the reload for every site on the machine, so it is
# validated first and put back if that fails.
install_site() {
  local src=$repo/apps/marketing/deploy/gengrowth-marketing.caddy
  local dst=$pick/state/sites/gengrowth-marketing.caddy
  cmp -s "$src" "$dst" && return 0
  local backup=
  if [ -e "$dst" ]; then backup=$(mktemp) && cp "$dst" "$backup"; fi
  cp "$src" "$dst"
  local out
  if ! out=$(caddy validate --config /etc/caddy/Caddyfile 2>&1); then
    if [ -n "$backup" ]; then mv "$backup" "$dst"; else rm -f "$dst"; fi
    echo "$out" | tail -n 5 >&2
    die "Caddy rejected gengrowth-marketing.caddy; the previous file is back in place"
  fi
  rm -f "$backup"
  out=$(caddy reload --config /etc/caddy/Caddyfile 2>&1) || { echo "$out" | tail -n 5 >&2; die "caddy reload failed"; }
  echo "deploy: Caddy reloaded with the new site file"
}

# The whole run sits in a function so bash has read all of it before the
# checkout below rewrites this file.
main() {
  local ref=${1:?usage: deploy.sh <git ref>}
  [ -r "$env_file" ] || die "$env_file is missing; see apps/marketing/deploy/README.md"
  [ -r "$tasks_env" ] || die "$tasks_env is missing; see apps/marketing/deploy/README.md"

  # `vercel env pull` writes the literal [SENSITIVE] for every variable marked
  # Sensitive on Vercel; building or running with it would ship a broken site.
  local placeholders
  placeholders=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=("|'"'"')?\[SENSITIVE\]("|'"'"')?$' "$env_file" | cut -d= -f1 | tr '\n' ' ' || true)
  [ -z "$placeholders" ] || die "marketing.env still holds [SENSITIVE] placeholders for: ${placeholders}(fill them in from each provider)"
  local empty
  empty=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=(""|'"''"')?$' "$env_file" | cut -d= -f1 | tr '\n' ' ' || true)
  [ -z "$empty" ] || echo "deploy: warning, empty in marketing.env: $empty" >&2

  refuse_bare_dollars "$env_file"
  refuse_bare_dollars "$tasks_env"

  git -C "$repo" fetch --quiet origin
  git -C "$repo" checkout --quiet --detach "$ref"
  local sha image
  sha=$(git -C "$repo" rev-parse --short=12 HEAD)
  image=gengrowth-marketing:$sha

  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "deploy: $image already built"
  else
    # The Dockerfile refuses to build when one of these is empty.
    local args=() name
    for name in NEXT_PUBLIC_APP_URL NEXT_PUBLIC_GOOGLE_CLIENT_ID NEXT_PUBLIC_SUPABASE_URL \
      NEXT_PUBLIC_SUPABASE_ANON_KEY; do
      args+=(--build-arg "$name=$(env_value "$name")")
    done
    docker build -f "$repo/apps/marketing/Dockerfile" "${args[@]}" -t "$image" "$repo"
  fi

  migrate_tasks

  local previous
  previous=$(docker inspect --format '{{.Config.Image}}' gengrowth-marketing 2>/dev/null || true)
  if ! MARKETING_SHA=$sha MARKETING_ENV_FILE=$env_file TASKS_ENV_FILE=$tasks_env \
    docker compose -f "$repo/apps/marketing/deploy/compose.yml" up -d --wait --wait-timeout 180; then
    # The old container is already gone at this point, so the site is down.
    if [ -n "$previous" ]; then echo "deploy: roll back with $0 ${previous#gengrowth-marketing:}" >&2; fi
    die "$image did not start healthy; see docker logs gengrowth-marketing"
  fi
  install_site

  echo "deploy: live $image"
  if [ -n "$previous" ] && [ "$previous" != "$image" ]; then
    echo "deploy: rollback with $0 ${previous#gengrowth-marketing:}"
  fi
}

main "$@"
exit
