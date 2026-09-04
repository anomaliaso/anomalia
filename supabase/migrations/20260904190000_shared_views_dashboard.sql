-- Un terzo tipo di vista condivisibile: la dashboard che il cliente finale apre.
--
-- Il vincolo su `view_type` è un'allowlist, non documentazione: senza questa riga un link di tipo
-- `dashboard` viene rifiutato da Postgres con un 23514 che nessuno sa leggere. La tabella dei tipi
-- vive in due posti che devono restare d'accordo — `SHARED_VIEW_TYPES` nel contratto e questo
-- check — e questo è il secondo.
--
-- Niente tocca le righe esistenti: i link già consegnati continuano a valere, con il loro snapshot
-- e la loro versione.
alter table public.shared_views
  drop constraint if exists shared_views_view_type_check;

alter table public.shared_views
  add constraint shared_views_view_type_check
  check (view_type in ('calendar', 'dashboard', 'monthly_report'));
