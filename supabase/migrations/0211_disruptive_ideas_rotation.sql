-- 0211 — Il banco idee gira. Prima no, e si vedeva.
--
-- Il difetto: `buildDisruptiveIdeasSection` metteva nel prompt le prime 8 idee vive ordinate per
-- `score desc`. Nessun agente ha mai avuto un modo per dire "questa l'ho girata" (i tool erano
-- due: leggi e salva), quindi ogni riga restava `new` per sempre e le due col punteggio più alto
-- stavano in cima all'infinito. Il modello non riciclava per pigrizia: gli veniva messa davanti
-- sempre la stessa pagina.
--
-- La correzione sta nel dato, non nel prompt: si registra QUANDO un'idea è stata mostrata a un
-- modello, e si ordina per quello. Le mai mostrate per prime, poi le più vecchie di vista, col
-- punteggio come criterio DENTRO i gruppi e non sopra. Un'idea forte torna, ma dopo che il resto
-- del banco ha avuto il suo turno.
--
-- Perché una funzione e non un update dal client: `shown_count = shown_count + 1` fatto con
-- read-modify-write perde conteggi appena due generazioni si sovrappongono — ed è esattamente il
-- caso, il prompt si assembla a ogni turno di chat e a ogni post. Stesso identico schema di
-- `bump_brand_memory_usage` (0110), che risolve lo stesso problema per la memoria.
--
-- I deploy NON eseguono le migration. Applicare PRIMA di spedire il codice: `last_shown_at` e
-- `shown_count` entrano nella select condivisa `COLS`, e una colonna che non esiste fa tornare
-- vuota OGNI lettura della tabella, non solo questa.

alter table public.disruptive_ideas
  add column if not exists last_shown_at timestamptz,
  add column if not exists shown_count integer not null default 0;

-- L'ordine di rotazione, quello che il prompt chiede a ogni turno.
create index if not exists disruptive_ideas_rotation_idx
  on public.disruptive_ideas (brand_id, status, last_shown_at asc nulls first, score desc nulls last);

-- Il brand_id è un parametro e non solo un filtro implicito: la funzione è security definer (deve
-- scrivere anche quando la lettura arriva dal client admin dell'API), e senza quel vincolo un id
-- indovinato lascerebbe sporcare il contatore di un altro brand.
--
-- Ma il parametro da solo NON basta: `security definer` scavalca la RLS, quindi un utente
-- autenticato che indovina un brand_id potrebbe invecchiare le idee di un brand altrui e farle
-- sprofondare in fondo alla rotazione. Sommesso come danno, ma è comunque una scrittura fuori dal
-- proprio perimetro. Il permesso si ricontrolla dentro la funzione: il client admin passa come
-- service_role, chiunque altro deve avere quel brand fra i suoi.
create or replace function public.bump_disruptive_idea_shown(idea_ids uuid[], p_brand uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.disruptive_ideas
  set
    last_shown_at = now(),
    shown_count = shown_count + 1
  where id = any (idea_ids)
    and brand_id = p_brand
    and (
      auth.role() = 'service_role'
      or p_brand in (select public.auth_brand_ids())
    );
$$;

revoke all on function public.bump_disruptive_idea_shown(uuid[], uuid) from public;
grant execute on function public.bump_disruptive_idea_shown(uuid[], uuid) to authenticated, service_role;
