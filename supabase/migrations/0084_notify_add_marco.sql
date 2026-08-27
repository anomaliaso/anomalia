-- Add marco@anomalia.so as a second recipient of the new-signup / new-brand notifications.
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
      'to', jsonb_build_array('andrea@anomalia.so', 'marco@anomalia.so'),
      'subject', p_subject,
      'html', p_html
    )
  );
exception when others then
  null; -- best-effort; never surface to the caller
end $$;
