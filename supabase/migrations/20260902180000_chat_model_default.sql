-- Un default solo, e sta qui.
--
-- Il picker offriva tre preset — Auto, Fast, Pro — che non erano modelli ma alias: Auto e Fast
-- risolvevano entrambi su LLM_DEFAULT_MODEL, Pro sul SECONDO elemento di LLM_MODELS. Tre nomi in
-- un menu per due valori d'ambiente, uno dei quali si sceglieva per posizione in una lista
-- separata da virgole. Chi gestisce l'istanza non poteva toccarli senza un deploy, e `fast` non
-- era nemmeno distinguibile da `auto`.
--
-- Adesso c'e` una riga sola marcata `is_default`, e la scaletta e` questa:
--
--   1. il modello scelto nel prompt input       → chat_threads.model    (per chat)
--   2. il default del brand                     → brands.chat_default_tier (Settings)
--   3. il default globale                       → chat_model_catalog.is_default
--
-- L'invariante "un default solo" la tiene il database, non il codice. Ma NON con un indice unico
-- parziale: quello viene valutato riga per riga, e faceva fallire l'UPDATE piu` naturale che
-- l'operatore possa scrivere —
--
--   update chat_model_catalog set is_default = (model_id = 'google/gemini-3.8-flash');
--   ERROR:  duplicate key value violates unique constraint
--
-- cioe` proprio il gesto per cui la colonna esiste, e la spunta in Supabase Studio. Un trigger
-- fa la stessa promessa senza chiedere due statement: chi accende un default spegne gli altri.
-- Non ricorre, perche' l'UPDATE interno mette `false` e la clausola WHEN vuole `true`.
alter table public.chat_model_catalog add column if not exists is_default boolean not null default false;

create or replace function public.chat_model_catalog_single_default() returns trigger
language plpgsql as $$
begin
  update public.chat_model_catalog
    set is_default = false
    where model_id <> new.model_id and is_default;
  return null;
end;
$$;

drop trigger if exists chat_model_catalog_one_default on public.chat_model_catalog;

create trigger chat_model_catalog_one_default
  after insert or update of is_default on public.chat_model_catalog
  for each row when (new.is_default)
  execute function public.chat_model_catalog_single_default();

insert into public.chat_model_catalog (model_id, position, source) values
  ('google/gemini-3.8-flash', 65, 'seed')
on conflict (model_id) do nothing;

update public.chat_model_catalog
  set is_default = (model_id = 'google/gemini-3.8-flash');

-- I preset spariscono dal vincolo: un valore che il picker non offre piu` non deve poter entrare.
-- Restano validi il null (= usa il default globale) e la FORMA di un id del gateway; che quel
-- modello esista lo verifica il server contro il listino vivo, come prima.
alter table public.brands drop constraint if exists brands_chat_default_tier_check;

alter table public.brands add constraint brands_chat_default_tier_check check (
  chat_default_tier is null
  or chat_default_tier ~ '^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:-]*$'
);

-- I brand fermi su un preset tornano a "nessuna scelta". Non e` una perdita: 'auto' e 'fast'
-- valevano gia` LLM_DEFAULT_MODEL, che e` esattamente il default globale qui sopra. Lasciarli
-- scritti significherebbe mostrare nei Settings un'etichetta che non corrisponde piu` a niente.
update public.brands
  set chat_default_tier = null
  where chat_default_tier in ('auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol');
