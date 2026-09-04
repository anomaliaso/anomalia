-- Due tipi in più: la strategia concordata e il workspace che li tiene tutti dietro un link solo.
--
-- Questo check è UNA delle quattro porte che una cosa deve attraversare per diventare pubblica —
-- il contratto (`SHARED_VIEW_TYPES`), il builder (`SNAPSHOT_BUILDERS`, che TypeScript esige
-- completo), questo vincolo e la pagina che la disegna. Nessuna è automatica, ed è il punto: una
-- pagina aggiunta sotto /app/[brand] il mese prossimo non attraversa nessuna delle quattro, quindi
-- non diventa pubblica per distrazione.
--
-- Questa riga e `SHARED_VIEW_TYPES` sono le due che possono divergere in silenzio: TypeScript non
-- legge SQL, e la divergenza si presenta in produzione come un 23514 che nessuno sa leggere. È già
-- successo con `dashboard`. Ora un test le confronta (`shared-views.test.ts`, "il vincolo SQL su
-- view_type dice esattamente quello che dice il contratto") e la suite diventa rossa prima del
-- deploy.
--
-- Niente tocca le righe esistenti: i link già consegnati valgono, col loro snapshot e la loro
-- versione.
alter table public.shared_views
  drop constraint if exists shared_views_view_type_check;

alter table public.shared_views
  add constraint shared_views_view_type_check
  check (view_type in ('calendar', 'dashboard', 'monthly_report', 'strategy', 'workspace'));
