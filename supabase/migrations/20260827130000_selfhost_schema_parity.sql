-- Ciò che esiste in produzione, che il CODICE usa, e che nessuna migration ha mai creato: aggiunto
-- a mano sul database hosted e mai scritto in un file. Trovato confrontando le colonne di un
-- database appena migrato con quelle di produzione (sola lettura), non leggendo il codice.
--
-- Senza questo, su un'installazione da zero: il radar non ha né la cache condivisa delle fonti né
-- la coda dei lavori (il worker chiama un RPC che non esiste), le revisioni di un post non si
-- salvano, la traduzione di un articolo legge una colonna assente, e il reasoning della chat si
-- perde. Nessuno di questi guasti alza un errore a schermo: leggono null e vanno avanti.
--
-- Restano FUORI di proposito le colonne e le tabelle che in produzione ci sono ma che nessuna riga
-- di codice nomina — `ai_calls.cost_cents`, `ai_calls.steps`, `chat_threads.asset_project_id`,
-- `motion_videos.qc_rerender`, `motion_videos.qc_rewritten`, `posts.generation_alternatives`,
-- `asset_projects`, `asset_project_files`, `mcp_logs`: sono debito di produzione, non schema che
-- serva a far girare l'app. Ricrearli qui li renderebbe eterni.

-- ── Radar: la cache condivisa delle fonti ────────────────────────────────────────────────────
-- Una riga per fonte, non per brand: due brand che seguono lo stesso feed lo scaricano una volta.
create table if not exists public.radar_feed_cache (
  source_key text primary key,
  items jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.radar_feed_cache enable row level security;

-- ── Radar: la coda dei lavori e il claim atomico ─────────────────────────────────────────────
create table if not exists public.radar_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  tick_id text not null,
  status text not null default 'pending',
  result jsonb,
  error text,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_radar_jobs_pending on public.radar_jobs (created_at) where status = 'pending';
create unique index if not exists idx_radar_jobs_brand_tick on public.radar_jobs (brand_id, tick_id);

alter table public.radar_jobs enable row level security;

-- FOR UPDATE SKIP LOCKED: due worker sullo stesso tick non prendono lo stesso lavoro. Il secondo
-- ramo del WHERE ripesca chi è rimasto `running` oltre lo stallo — un processo morto a metà.
create or replace function public.claim_radar_jobs(p_limit integer, p_stall_iso timestamptz)
returns table(id uuid, brand_id uuid, tick_id text)
language plpgsql
as $$
begin
  return query
  update radar_jobs as rj
  set status = 'running', started_at = now(), attempts = rj.attempts + 1
  where rj.id in (
    select rj2.id from radar_jobs as rj2
    where (rj2.status = 'pending' or (rj2.status = 'running' and coalesce(rj2.started_at, '1970-01-01'::timestamptz) < p_stall_iso))
      and rj2.attempts < 2
    order by rj2.created_at
    limit greatest(1, p_limit)
    for update skip locked
  )
  returning rj.id, rj.brand_id, rj.tick_id;
end;
$$;

-- ── Le versioni di un post, che sopravvivono alla riapertura del dialogo ─────────────────────
create table if not exists public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  version integer not null,
  caption text,
  image_prompt text,
  media_url text,
  content_type text,
  feedback text,
  created_at timestamptz not null default now(),
  unique (post_id, version)
);

create index if not exists post_revisions_post_id_idx on public.post_revisions (post_id);

alter table public.post_revisions enable row level security;

-- Il brand del post decide: la scrittura passa dalla sessione dell'utente, non dal service role.
drop policy if exists "post_revisions via brand" on public.post_revisions;
create policy "post_revisions via brand" on public.post_revisions
  for all
  using (exists (select 1 from public.posts p where p.id = post_revisions.post_id and p.brand_id in (select public.auth_brand_ids())))
  with check (exists (select 1 from public.posts p where p.id = post_revisions.post_id and p.brand_id in (select public.auth_brand_ids())));

-- ── Le colonne ───────────────────────────────────────────────────────────────────────────────
alter table public.brand_articles add column if not exists source text not null default 'manual';
alter table public.brand_media add column if not exists source_ref text;
alter table public.chat_messages add column if not exists reasoning text;

alter table public.posts
  add column if not exists title text,
  add column if not exists link_url text,
  add column if not exists subreddit text;

-- ── Owner delle funzioni SECURITY DEFINER ────────────────────────────────────────────────────
-- In questo stack compose le migrazioni girano come `postgres`, ma `postgres` non può tornare ad
-- essere `anon` alla fine di una chiamata SECURITY DEFINER fatta via PostgREST: l'RPC fallisce con
-- "permission denied to set role anon" e il codice che la chiama cade sul fallback (es. il gate
-- della waitlist legge il flag come attivo anche quando è spento). L'owner del DBA dello stack
-- (`supabase_admin`) invece funziona. Riassegniamo solo se quel ruolo esiste, così su Supabase
-- hosted/cli — dove le stesse funzioni possedute da `postgres` sono la norma e funzionano — tutto
-- resta com'è. Idempotente: le funzioni già riassegnate non matchano il filtro.
do $$
declare
  fn record;
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    return;
  end if;
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
  loop
    execute format('alter function %s owner to supabase_admin', fn.sig);
  end loop;
end $$;
