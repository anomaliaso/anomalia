-- 0208 brand_job_optouts.actor — CHI ha spento il lavoro, quando non è stato un utente.
--
-- Il watchdog dei fallimenti consecutivi dell'autopilot ora spegne il producer scrivendo un
-- opt-out nel roster (visibile, riaccendibile con un toggle) invece di flippare il booleano
-- invisibile `brands.autopilot_enabled`. `disabled_by` è un FK a auth.users e il watchdog non è
-- un utente: serve una colonna testuale per l'attore di sistema ('watchdog', domani altri).
-- NULL = spento da una persona (disabled_by dice chi).
--
-- Il codice scrive questa colonna in modo best-effort e ritenta senza se non esiste ancora
-- (i deploy non applicano le migration): vedi recordSystemJobOptOut in job-roster.ts.
alter table public.brand_job_optouts
  add column if not exists actor text;
