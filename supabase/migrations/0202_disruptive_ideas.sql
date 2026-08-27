-- 0202 — Il banco delle idee dirompenti: quello che l'AI ha pensato di davvero contrario,
-- conservato fuori dal thread in cui è nato.
--
-- Il problema che risolve: le idee migliori escono di lato. Un agente sta scrivendo dieci script
-- UGC, ne pensa uno che rompe la categoria, lo scarta perché non rientra nel brief di quel batch —
-- e quell'idea non esiste più da nessuna parte. Il thread si chiude, la sessione scade, e la volta
-- dopo si riparte dal beneficio dichiarato. Un banco per brand rende ripescabile la parte che
-- costa di più produrre.
--
-- Perché una tabella e non brand_memory: la memoria è chiave→valore con una categoria, ottima per
-- "il brand non dice mai 'soluzione innovativa'" e inutile per un'idea, che ha una leva di
-- contrasto, un motivo per cui è scomoda, un formato in cui girarla e un ciclo di vita
-- (proposta → in lista → usata → archiviata). Senza lo stato, il banco diventa un elenco di cose
-- già fatte che l'agente ripropone.
--
-- I deploy NON eseguono le migration. Applicare prima di spedire il codice che legge queste tabelle.

create table if not exists public.disruptive_ideas (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Chi l'ha salvata quando è passata da un utente. Le idee nate dentro un cron non ne hanno uno.
  user_id uuid references auth.users(id) on delete set null,

  title text not null,
  -- L'idea come si gira: cosa si vede, non cosa si comunica.
  idea text not null,
  -- La leva di contrasto (src/lib/disruptive.ts). Testo libero: il catalogo evolve nel codice, e
  -- un check constraint qui costringerebbe a una migration per ogni leva nuova.
  device text,
  -- Perché è scomoda e A CHI dà fastidio. Un'idea che non sa rispondere non ha passato il test
  -- dell'attrito, e questo campo è dove si vede.
  why_it_contrasts text,
  -- Chi si infastidisce: la controparte del contrasto, nominata.
  who_it_annoys text,
  -- Il formato UGC/contenuto in cui girarla (id di src/lib/ugc-formats.ts, o testo libero).
  format text,

  -- Autovalutazione del modello, 0-100. Non è una metrica di performance: è quanto il modello
  -- stesso pensa che l'idea rompa la categoria. Serve a ordinare il banco, non a decidere.
  score integer check (score is null or (score >= 0 and score <= 100)),

  -- Da dove è uscita: 'chat', 'ugc', 'ads', 'editorial', 'motion', 'media'… Testo libero perché le
  -- superfici nascono e muoiono più in fretta delle tabelle.
  surface text,
  -- L'agente che l'ha pensata, quando c'è (publish/brand/grow/web/motion/ugc/media).
  agent text,
  thread_id uuid references public.chat_threads(id) on delete set null,

  status text not null default 'new' check (status in ('new', 'shortlisted', 'used', 'archived')),
  -- Il post nato dall'idea, quando l'idea viene davvero girata.
  used_post_id uuid references public.posts(id) on delete set null,
  used_at timestamptz,

  tags jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La lettura tipica è "le idee vive di questo brand, le più forti in cima".
create index if not exists disruptive_ideas_brand_idx
  on public.disruptive_ideas (brand_id, status, score desc nulls last, created_at desc);

create index if not exists disruptive_ideas_brand_created_idx
  on public.disruptive_ideas (brand_id, created_at desc);

-- Anti-duplicato lato scrittura: lo stesso agente che ripropone la stessa idea con lo stesso
-- titolo non deve moltiplicare le righe del banco. Il confronto è sul titolo normalizzato, perché
-- è l'unica parte che un modello riscrive identica quando ha davvero la stessa idea.
create unique index if not exists disruptive_ideas_brand_title_uniq
  on public.disruptive_ideas (brand_id, lower(btrim(title)));

alter table public.disruptive_ideas enable row level security;

-- Il banco è del brand: i membri leggono, scrivono e archiviano. Non c'è niente di service-role
-- qui — un'idea la salva l'agente con la sessione dell'utente, esattamente come una memoria.
drop policy if exists "disruptive ideas via brand" on public.disruptive_ideas;
create policy "disruptive ideas via brand" on public.disruptive_ideas for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Niente trigger di updated_at: il progetto non ne ha uno generico, e chi scrive nel banco
-- (tool dell'agente e pagina Idee) passa sempre da `src/lib/server/disruptive-ideas.ts`, che lo
-- imposta esplicitamente. Un trigger in più che nessuna migration precedente ha sarebbe una
-- convenzione nuova introdotta di sguincio.
