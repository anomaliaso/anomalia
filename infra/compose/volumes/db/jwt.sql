-- Vendored verbatim from supabase/supabase (docker/volumes/db/jwt.sql), tag v1.26.08, Apache-2.0.
-- Required init script for the official supabase/postgres image — do not hand-edit, replace on upgrade.

\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
