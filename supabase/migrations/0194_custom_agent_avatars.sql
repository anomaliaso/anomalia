-- Custom agents get a tiny SVG face (shape + colour) shown in the app.
-- Nullable on purpose: rows created before this migration fall back to a
-- face derived from their id client-side (see $lib/agent-avatars.ts).

alter table public.custom_agent_schedules
  add column if not exists avatar_face text,
  add column if not exists avatar_color text;

alter table public.custom_agent_schedules
  drop constraint if exists custom_agent_schedules_avatar_face_chk;
alter table public.custom_agent_schedules
  add constraint custom_agent_schedules_avatar_face_chk check (
    avatar_face is null
    or avatar_face in ('wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise')
  );

alter table public.custom_agent_schedules
  drop constraint if exists custom_agent_schedules_avatar_color_chk;
alter table public.custom_agent_schedules
  add constraint custom_agent_schedules_avatar_color_chk check (
    avatar_color is null or avatar_color ~ '^#[0-9a-f]{6}$'
  );
