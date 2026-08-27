-- ═══════════════════════════════════════════════════════════════
-- Migrazione blog_integrations a Supabase Vault
-- I secret (client_id, client_secret, access_token) vengono rimossi
-- dalla tabella e salvati crittografati in vault.secrets.
--
-- Struttura:
--   vault_integration.*  — funzioni reali, schema locked (solo service_role via SQL diretto)
--   public.*             — wrapper SECURITY DEFINER con role check (chiamabili via .rpc())
--   public._cleanup_*    — trigger (chiamato da PG, non da REST)
-- ═══════════════════════════════════════════════════════════════

-- 1. Abilita Vault (dipende da pgsodium, entrambi pre-installati su Supabase Cloud)
create extension if not exists supabase_vault cascade;

-- 2. Rimuovi colonne plaintext (sicuro: nessun dato presente)
alter table public.blog_integrations
  drop column if exists client_id,
  drop column if exists client_secret,
  drop column if exists access_token;

-- ═══════════════════════════════════════════════════════════════
-- Schema locked per le funzioni vault reali
-- ═══════════════════════════════════════════════════════════════

create schema if not exists vault_integration;
revoke all on schema vault_integration from public, anon, authenticated;
grant usage on schema vault_integration to service_role;

-- 3. upsert: crea o aggiorna un secret come JSON crittografato.
--    Race-condition safe: se due chiamate concorrenti cercano di creare
--    lo stesso name, la seconda cattura unique_violation e fa update.
create function vault_integration.upsert_integration_secret(
  p_brand_id  uuid,
  p_platform  text,
  p_secrets   jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := 'blog_integration_' || p_brand_id || '_' || p_platform;
  v_id   uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_secrets::text, v_name);
    return v_id;
  end if;
  begin
    return vault.create_secret(p_secrets::text, v_name);
  exception when unique_violation then
    select id into v_id from vault.secrets where name = v_name;
    perform vault.update_secret(v_id, p_secrets::text, v_name);
    return v_id;
  end;
end;
$$;

-- 4. read: decripta e restituisce il JSON del secret.
create function vault_integration.read_integration_secret(
  p_brand_id uuid,
  p_platform text
) returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'blog_integration_' || p_brand_id || '_' || p_platform
  limit 1;
$$;

-- 5. delete: elimina il secret crittografato.
create function vault_integration.delete_integration_secret(
  p_brand_id uuid,
  p_platform text
) returns void
language sql
security definer
set search_path = public
as $$
  delete from vault.secrets
  where name = 'blog_integration_' || p_brand_id || '_' || p_platform;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Wrapper in public (chiamabili via .rpc()) con role check
-- Supabase Cloud ha default privileges che concedono EXECUTE a
-- anon/authenticated su tutte le funzioni in public. Il REVOKE
-- non ha effetto (viene sovrascritto dai default privileges).
-- Il role check dentro il body è la difesa reale.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.upsert_integration_secret(
  p_brand_id uuid, p_platform text, p_secrets jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := current_setting('role', true);
begin
  if v_role not in ('service_role', 'postgres', 'none', '')
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'permission denied';
  end if;
  return vault_integration.upsert_integration_secret(p_brand_id, p_platform, p_secrets);
end;
$$;

create or replace function public.read_integration_secret(
  p_brand_id uuid, p_platform text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := current_setting('role', true);
begin
  if v_role not in ('service_role', 'postgres', 'none', '')
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'permission denied';
  end if;
  return vault_integration.read_integration_secret(p_brand_id, p_platform);
end;
$$;

create or replace function public.delete_integration_secret(
  p_brand_id uuid, p_platform text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := current_setting('role', true);
begin
  if v_role not in ('service_role', 'postgres', 'none', '')
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'permission denied';
  end if;
  perform vault_integration.delete_integration_secret(p_brand_id, p_platform);
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Trigger: cleanup automatico del vault secret quando la riga
-- blog_integrations viene eliminata (es. disconnect action).
-- BEFORE DELETE → OLD.brand_id e OLD.platform sono ancora popolati.
-- ═══════════════════════════════════════════════════════════════

create or replace function public._cleanup_integration_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets
  where name = 'blog_integration_' || old.brand_id || '_' || old.platform;
  return old;
end;
$$;

create trigger trg_blog_integrations_cleanup
  before delete on public.blog_integrations
  for each row execute function public._cleanup_integration_secret();
