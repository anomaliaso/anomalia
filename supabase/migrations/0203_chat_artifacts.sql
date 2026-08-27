-- 0203: gli artefatti della chat — quello che l'agente produce e che deve restare.
--
-- Fino a qui la chat sapeva mostrare due cose: il testo di un turno e le anteprime dei post. Tutto
-- il resto di ciò che un agente produce — un grafico, un CSV pulito, un report, un file compilato
-- nella sandbox — o veniva incollato come testo dentro la risposta (e allora spariva dentro un muro
-- di caratteri), oppure finiva nella libreria media / nella conoscenza del brand: posti giusti per
-- un asset del brand, sbagliati per "il risultato di questa conversazione".
--
-- Un artefatto è la terza cosa: **un file, attaccato a un thread, che resta**. Riaprendo la chat fra
-- un mese è ancora lì, scaricabile, con il nome che l'agente gli ha dato e la ragione per cui esiste.
--
-- Tre decisioni che questa tabella incorpora:
--
-- 1. **Appartiene al thread, non al messaggio.** Un messaggio si può ripubblicare (i turni parziali
--    vengono riscritti), un artefatto no: se fosse figlio del messaggio, un turno salvato due volte
--    lo duplicherebbe o lo perderebbe. `message_id` resta come riferimento debole, per ancorarlo
--    nel punto giusto della conversazione quando c'è.
-- 2. **I byte stanno in storage, non qui.** `brand-knowledge` è già il bucket privato del brand, con
--    le sue policy: gli artefatti ci vivono dentro sotto `{user}/{brand}/artifacts/`, e la chat li
--    serve firmati. Nessun base64 dentro una riga di database.
-- 3. **Chi l'ha creato si vede.** `created_by` distingue l'agente dalla persona, e `tool_call_id`
--    lega l'artefatto alla chiamata che l'ha prodotto: un file che compare senza sapere da dove
--    viene è esattamente ciò che rende un prodotto AI difficile da fidarsi.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

create table if not exists public.chat_artifacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  -- Il messaggio in cui è comparso, quando lo sappiamo. Volutamente `set null`: l'artefatto
  -- sopravvive alla riscrittura del turno che l'ha generato.
  message_id uuid references public.chat_messages(id) on delete set null,
  tool_call_id text,

  title text not null,
  description text,
  -- 'image' | 'document' | 'data' | 'code' | 'archive' — come va mostrato, non cosa contiene.
  kind text not null default 'document',
  mime text,
  file_name text not null,
  storage_path text not null,
  bytes integer,
  -- Anteprima testuale per i formati leggibili (markdown, csv, codice): evita di scaricare il file
  -- per capire cosa sia, ed è quello che la card mostra sotto il titolo.
  preview text,

  -- 'agent' | 'user'. La sandbox scrive 'agent'.
  created_by text not null default 'agent',
  -- Da quale superficie: 'chat' | 'sandbox' | 'tool'.
  source text not null default 'chat',
  created_at timestamptz not null default now()
);

create index if not exists chat_artifacts_thread_idx
  on public.chat_artifacts (thread_id, created_at desc);
create index if not exists chat_artifacts_brand_idx
  on public.chat_artifacts (brand_id, created_at desc);
create index if not exists chat_artifacts_message_idx
  on public.chat_artifacts (message_id)
  where message_id is not null;

alter table public.chat_artifacts enable row level security;

-- Stessa forma delle policy dei thread: il brand deve essere tuo e il thread pure. La scrittura
-- passa dal server (service role) perché è l'agente a produrli, non il browser.
drop policy if exists "chat_artifacts_select" on public.chat_artifacts;
create policy "chat_artifacts_select" on public.chat_artifacts for select
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

drop policy if exists "chat_artifacts_insert" on public.chat_artifacts;
create policy "chat_artifacts_insert" on public.chat_artifacts for insert
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

drop policy if exists "chat_artifacts_delete" on public.chat_artifacts;
create policy "chat_artifacts_delete" on public.chat_artifacts for delete
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());
