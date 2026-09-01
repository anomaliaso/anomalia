-- Il verdetto umano su un post: approvato, modificato, buttato.
--
-- Perché una TABELLA e non una colonna su `posts`: buttare un post ne CANCELLA la riga, quindi una
-- colonna sparirebbe insieme al verdetto più informativo di tutti — e infatti al 1/9/2026 «scartato»
-- non esiste da giugno. Un post odiato e uno mai aperto sono la stessa riga. Inoltre un post si
-- modifica più volte, e `posts` non ha nessuna colonna che dica CHI ha deciso: il verdetto è di una
-- persona, non di un brand.
--
-- `post_id` non ha foreign key APPOSTA: il verdetto 'discarded' deve sopravvivere alla riga che
-- descrive. È l'unico modo perché «buttato» resti misurabile.
create table if not exists public.post_verdicts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  verdict text not null check (verdict in ('approved', 'edited', 'discarded')),
  caption_before text,
  caption_after text,
  created_at timestamptz not null default now()
);

-- L'evento di attivazione si legge da qui: min(created_at) per (user_id, brand_id) con verdict
-- 'approved'. L'indice serve esattamente quella query.
create index if not exists post_verdicts_activation_idx
  on public.post_verdicts (user_id, brand_id, created_at)
  where verdict = 'approved';

create index if not exists post_verdicts_brand_idx on public.post_verdicts (brand_id, created_at);
create index if not exists post_verdicts_post_idx on public.post_verdicts (post_id);

alter table public.post_verdicts enable row level security;

-- Il brand decide chi legge; scrive chiunque possa già agire sul brand (la stessa sessione che
-- approva il post) oltre al service role.
drop policy if exists "post_verdicts via brand" on public.post_verdicts;
create policy "post_verdicts via brand" on public.post_verdicts
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
