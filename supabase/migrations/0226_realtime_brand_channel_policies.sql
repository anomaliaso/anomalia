drop policy if exists "brand members receive brand channel" on realtime.messages;

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

drop policy if exists "brand members publish presence on brand channel" on realtime.messages;

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
