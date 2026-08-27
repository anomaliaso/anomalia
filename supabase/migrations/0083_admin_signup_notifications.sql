-- Email andrea@anomalia.so on every new signup and every new brand, straight from the DB via
-- pg_net → Resend. Reads the Resend key from Vault (secret name 'resend_notify_key', created
-- out-of-band so it never lands in git). All notification logic is wrapped so a failure can
-- NEVER block a signup or brand creation.

create or replace function public.notify_admin_email(p_subject text, p_html text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_notify_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Anomalia <noreply@anomalia.so>',
      'to', jsonb_build_array('andrea@anomalia.so'),
      'subject', p_subject,
      'html', p_html
    )
  );
exception when others then
  null; -- notifications are best-effort; never surface to the caller
end $$;

-- New user → notify
create or replace function public.tg_notify_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_admin_email(
    '🎉 Nuovo iscritto su Anomalia',
    '<p>Nuovo utente registrato.</p><p><b>Email:</b> ' || coalesce(NEW.email, '—') ||
    '</p><p style="color:#888">' || now()::text || '</p>'
  );
  return NEW;
exception when others then
  return NEW;
end $$;

-- New brand → notify (with the owner's email resolved from the org)
create or replace function public.tg_notify_new_brand()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select p.email into v_email
  from public.org_members om join public.profiles p on p.id = om.user_id
  where om.org_id = NEW.org_id
  limit 1;
  perform public.notify_admin_email(
    '🏷️ Nuovo brand: ' || coalesce(NEW.name, 'senza nome'),
    '<p>Nuovo brand creato.</p><p><b>Brand:</b> ' || coalesce(NEW.name, '—') ||
    '<br><b>Owner:</b> ' || coalesce(v_email, '—') || '</p>'
  );
  return NEW;
exception when others then
  return NEW;
end $$;

drop trigger if exists notify_new_user on auth.users;
create trigger notify_new_user after insert on auth.users
  for each row execute function public.tg_notify_new_user();

drop trigger if exists notify_new_brand on public.brands;
create trigger notify_new_brand after insert on public.brands
  for each row execute function public.tg_notify_new_brand();
