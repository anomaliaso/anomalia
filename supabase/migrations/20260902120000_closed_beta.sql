-- Il prodotto si entra dopo una call, non dopo una registrazione.
--
-- Perché una COLONNA su `profiles` e non una tabella: l'approvazione è un fatto per utente, uno
-- solo, e `approved_at` dice anche QUANDO senza tenere un audit a parte.
--
-- Perché un flag NUOVO e non `waitlist`: `waitlist` non chiude soltanto l'app, riscrive le CTA
-- della landing (`start-href.ts`, `+layout.server.ts`) e manda i visitatori su /waitlist invece che
-- dentro il funnel. Qui il funnel pubblico deve restare aperto: è quello che porta gente alla call.
--
-- Perché `is_approved()` esiste separata da `can_enter()`: la parte per-utente si prova senza
-- toccare un interruttore GLOBALE. Un test che per girare deve accendere `closed_beta` su un
-- database vero chiude fuori i clienti veri per la durata del test.

alter table public.profiles add column if not exists approved_at timestamptz;

-- Chi c'era prima entra: la chiusura vale dai nuovi. Va applicata PRIMA che il flag si accenda,
-- o il primo deploy sbatte fuori ogni cliente attuale.
update public.profiles set approved_at = now() where approved_at is null;

-- Il sollecito a chi non ha ancora prenotato si deduplica qui: `waitlist` È già il registro di
-- chi aspetta, e `lifecycle_emails` non serve — quel ledger pende dai brand, e chi aspetta non ne
-- ha uno.
alter table public.waitlist add column if not exists nudged_at timestamptz;

insert into public.app_flags (key, enabled) values ('closed_beta', false)
  on conflict (key) do nothing;

-- UNA regola sola, due porte. Il browser chiede "sono approvato io?" e la sessione basta; la CLI
-- e l'MCP arrivano con una chiave API su un client service-role, dove `auth.uid()` è NULLO — la
-- stessa domanda va posta per id, o l'API resterebbe spalancata mentre il browser è chiuso.
-- Scrivere il predicato due volte è come non averlo scritto: diverge al primo cambio.
create or replace function public.is_approved(p_user uuid) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (
        select 1 from public.admins a
        join auth.users u on lower(u.email) = lower(a.email)
        where u.id = p_user
      )
      or exists (
        select 1 from public.profiles
        where id = p_user and approved_at is not null
      )
      -- L'invitato non è ancora approvato ma deve arrivare alla schermata che accetta l'invito:
      -- `/app` controlla can_enter PRIMA di leggere gli inviti. La finestra è la stessa di
      -- `accept_brand_invite` (0077), o un invito scaduto lascerebbe un limbo permanente:
      -- dentro all'app, senza niente da accettare.
      or exists (
        select 1 from public.brand_invites i
        join auth.users u on lower(u.email) = lower(i.email)
        where u.id = p_user
          and i.accepted_at is null
          and i.created_at > now() - interval '7 days'
      );
$$;

create or replace function public.is_approved() returns boolean
  language sql security definer set search_path = public stable as $$
  select public.is_approved(auth.uid()); $$;

-- Chi accetta un invito è stato garantito da un cliente approvato: l'approvazione diventa sua e
-- non dipende più dalla riga dell'invito, che l'accettazione stessa consuma.
create or replace function public.accept_brand_invite(p_token uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_invite public.brand_invites%rowtype;
  v_slug text;
begin
  if auth.uid() is null then return null; end if;
  select * into v_invite from public.brand_invites
    where token = p_token
      and accepted_at is null
      and created_at > now() - interval '7 days'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email',''));
  if not found then return null; end if;
  insert into public.brand_members (brand_id, user_id)
    values (v_invite.brand_id, auth.uid())
    on conflict do nothing;
  update public.brand_invites set accepted_at = now(), accepted_by = auth.uid()
    where id = v_invite.id;
  update public.profiles set approved_at = coalesce(approved_at, now())
    where id = auth.uid();
  select slug into v_slug from public.brands where id = v_invite.brand_id;
  return v_slug;
end; $$;

revoke execute on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- La versione per id NON va a `authenticated`: chiunque potrebbe chiedere se un'altra email è
-- stata approvata. La chiama solo il server, con la chiave di servizio.
revoke execute on function public.is_approved(uuid) from public, anon, authenticated;
grant execute on function public.is_approved(uuid) to service_role;
