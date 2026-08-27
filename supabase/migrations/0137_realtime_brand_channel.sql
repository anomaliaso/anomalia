-- Realtime Authorization for the per-brand shell channel (presence + live chat sync).
--
-- Topic shape is `brand:<uuid>`. Membership is the same `auth_brand_ids()` set every other
-- brand-scoped policy uses, so exactly the people who can already read the brand can join its
-- channel — a brand UUID alone is not enough, which is the whole reason these channels are
-- private rather than public.
--
-- `realtime.messages` has RLS on with no policies by default, meaning every private channel is
-- currently denied. These two policies are what opens it, and only for brand topics:
--   SELECT → receive presence + broadcast on the topic
--   INSERT → publish your own presence (the server broadcasts with the service role, which
--            bypasses RLS, so clients never need broadcast rights for chat sync itself)
--
-- The topic is parsed with CASE, not a chain of ANDs: Postgres does not promise left-to-right
-- evaluation of AND, so a bare `substring(...)::uuid` could be reached on a non-brand topic and
-- raise instead of simply denying. CASE does promise it.
--
-- ⚠ Deploys in this project do NOT run migrations. Apply this by hand.
--
-- SELF-HOST: `realtime.messages` esiste solo DOPO che il servizio Realtime ha inizializzato il
-- proprio schema. Su un replay pulito (il generatore di baseline, un compose appena alzato) la
-- tabella non c'è ancora: le policy si creano solo se lo schema è già in piedi, e l'installazione
-- reale le riceve dal giro successivo o dall'applicazione manuale documentata.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p1$
      create policy "brand members receive brand channel"
      on realtime.messages
      for select
      to authenticated
      using (
        extension in ('broadcast', 'presence')
        and case
              when (select realtime.topic()) ~
                   '^brand:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then substring((select realtime.topic()) from 7)::uuid in (select public.auth_brand_ids())
              else false
            end
      );
    $p1$;
    execute $p2$
      create policy "brand members publish presence on brand channel"
      on realtime.messages
      for insert
      to authenticated
      with check (
        extension in ('broadcast', 'presence')
        and case
              when (select realtime.topic()) ~
                   '^brand:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then substring((select realtime.topic()) from 7)::uuid in (select public.auth_brand_ids())
              else false
            end
      );
    $p2$;
  end if;
end $$;
