-- Il link che un'agenzia manda al cliente: UNA vista, mai un account.
--
-- Perché una TABELLA e non un token firmato: un HMAC non si revoca. Un cliente che se ne va, un
-- link finito nel gruppo sbagliato, una collaborazione chiusa — con un token firmato l'unica
-- risposta è ruotare il segreto e spegnere ogni link esistente. Qui la revoca è una riga.
--
-- Perché `snapshot` e non una query dal vivo: la lettura pubblica non deve poter tornare sulle
-- tabelle vive. `posts` ha oltre cinquanta colonne — image_prompt, qc, approval_token,
-- attention_reason — e ne guadagna di nuove ogni mese. Con una vista dal vivo, la prossima
-- colonna esce da ogni link già consegnato senza che nessuno decida niente. Con lo snapshot,
-- quello che è uscito è solo quello che l'allowlist ha copiato il giorno della creazione.
-- `snapshot_version` dice con quale forma è stato scritto, perché i link vecchi restano validi.
--
-- Perché `token_hash` e non il token: un dump di questa tabella non deve produrre link
-- funzionanti. Il token è casuale (32 byte) e viene mostrato UNA volta a chi lo crea; qui resta
-- solo il suo sha256. Un link non salvato non si recupera — si revoca e se ne crea un altro.
--
-- `author_id` non è ridondante rispetto a `brand_id`: dice CHI ha consegnato quel link, e resta
-- l'unica traccia quando l'operatore che l'ha creato non lavora più su quel brand.
create table if not exists public.shared_views (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  view_type text not null check (view_type in ('calendar', 'monthly_report')),
  snapshot jsonb not null,
  snapshot_version integer not null default 1,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

-- La lista di un brand, la più recente in cima: è l'unica query che la superficie autenticata fa.
-- La ricerca per token passa dall'indice unico su token_hash e non ne serve un altro.
create index if not exists shared_views_brand_idx on public.shared_views (brand_id, created_at desc);

alter table public.shared_views enable row level security;

-- Chi può già agire sul brand vede e gestisce le sue share. Nessuna policy per `anon`: la rotta
-- pubblica legge con la chiave di servizio, con l'impronta del token come unica chiave.
drop policy if exists "shared_views via brand" on public.shared_views;
create policy "shared_views via brand" on public.shared_views
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Difesa in profondità, non ridondanza: senza privilegi di tabella, nemmeno una policy scritta
-- male in futuro può aprire questa tabella a un visitatore anonimo. Il percorso pubblico non
-- passa da qui — usa la chiave di servizio — quindi la revoca non gli toglie niente.
revoke all on public.shared_views from anon;
