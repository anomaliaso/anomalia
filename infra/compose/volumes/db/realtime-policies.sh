#!/bin/sh

set -eu

attempt=0
while [ "$attempt" -lt 60 ]; do
  if [ "$(psql --no-psqlrc --tuples-only --no-align --command "select to_regclass('realtime.messages')")" = 'realtime.messages' ]; then
    psql --no-psqlrc --set ON_ERROR_STOP=on \
      --command 'begin' \
      --command 'create table if not exists app_schema_migrations (filename text primary key, applied_at timestamptz not null default now())' \
      --file /0226_realtime_brand_channel_policies.sql \
      --command "insert into app_schema_migrations (filename) values ('0226_realtime_brand_channel_policies.sql') on conflict (filename) do nothing" \
      --command 'commit'
    exit 0
  fi

  attempt=$((attempt + 1))
  sleep 1
done

echo 'realtime.messages did not become available' >&2
exit 1
