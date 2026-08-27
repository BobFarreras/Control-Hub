#!/bin/sh
set -eu

if [ -n "${POSTGRES_APP_PASSWORD_FILE:-}" ]; then
  if [ -n "${POSTGRES_APP_PASSWORD:-}" ]; then
    echo "POSTGRES_APP_PASSWORD: SECRET_SOURCE_CONFLICT" >&2
    exit 1
  fi
  POSTGRES_APP_PASSWORD="$(cat "$POSTGRES_APP_PASSWORD_FILE")"
fi
if [ -z "${POSTGRES_APP_PASSWORD:-}" ]; then
  echo "POSTGRES_APP_PASSWORD: SECRET_FILE_EMPTY" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$POSTGRES_APP_PASSWORD" <<-'SQL'
  create role control_hub_app login nosuperuser nocreatedb nocreaterole noinherit password :'app_password';
SQL
