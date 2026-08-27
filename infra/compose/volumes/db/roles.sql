-- Vendored verbatim from supabase/supabase (docker/volumes/db/roles.sql), tag v1.26.08, Apache-2.0.
-- Required init script for the official supabase/postgres image — replace on upgrade.
-- Una riga in meno rispetto all'originale: supabase/postgres:17.6.1.136 non crea più
-- `supabase_functions_admin` (niente edge-runtime in questo stack) e l'ALTER faceva abortire
-- l'init, lasciando password e JWT mai applicati.

-- NOTE: change to your own passwords for production environments
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
