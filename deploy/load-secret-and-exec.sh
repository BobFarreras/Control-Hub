#!/bin/sh
set -eu

variable_name="$1"
file_variable_name="${variable_name}_FILE"
file_path="$(printenv "$file_variable_name" || true)"
direct_value="$(printenv "$variable_name" || true)"

if [ -n "$file_path" ] && [ -n "$direct_value" ]; then
  echo "${variable_name}: SECRET_SOURCE_CONFLICT" >&2
  exit 1
fi

if [ -n "$file_path" ]; then
  if [ ! -f "$file_path" ] || [ -L "$file_path" ]; then
    echo "${variable_name}: SECRET_FILE_UNREADABLE" >&2
    exit 1
  fi
  direct_value="$(cat "$file_path")"
fi

if [ -z "$direct_value" ]; then
  echo "${variable_name}: SECRET_SOURCE_MISSING" >&2
  exit 1
fi

export "$variable_name=$direct_value"
unset "$file_variable_name" direct_value file_path
shift
exec "$@"
