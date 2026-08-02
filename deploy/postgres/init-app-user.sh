#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$POSTGRES_APP_PASSWORD" <<-'SQL'
  create role control_hub_app login nosuperuser nocreatedb nocreaterole noinherit password :'app_password';
SQL
