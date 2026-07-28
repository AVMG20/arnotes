#!/bin/sh
set -eu

secret_file="/app/data/.auth-secret"

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  if [ ! -s "$secret_file" ]; then
    umask 077
    bun -e "console.log(crypto.randomUUID() + crypto.randomUUID())" > "$secret_file"
  fi
  BETTER_AUTH_SECRET="$(tr -d '\n' < "$secret_file")"
  export BETTER_AUTH_SECRET
fi

exec "$@"
