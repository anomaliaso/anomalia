-- Vendored verbatim from supabase/supabase (docker/volumes/db/realtime.sql), tag v1.26.08, Apache-2.0.
-- Required init script for the official supabase/postgres image — do not hand-edit, replace on upgrade.

\set pguser `echo "$POSTGRES_USER"`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
