-- posts non aveva updated_at: nessun guard «leggi prima di scrivere» poteva dire se una riga era
-- cambiata dopo l'ultima lettura dell'agente, e una patch sovrascriveva in silenzio il lavoro di
-- chi nel frattempo aveva modificato il post (persona sul browser, altro agente, autopilot).
-- Il trigger copre OGNI strada di scrittura — chat, form, API, worker — senza fidarsi del codice.
alter table public.posts add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_posts_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_posts_updated_at();
