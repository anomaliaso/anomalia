-- The astronomical avatars are gone: back to the eight expressive faces, which is what the
-- rows now animate through in chat. Anything still holding a space id falls back to 'wide'.

update public.custom_agent_schedules
set avatar_face = 'wide'
where avatar_face in ('moon', 'jupiter', 'saturn', 'blackhole', 'star', 'asteroid', 'comet', 'eclipse');

alter table public.custom_agent_schedules
  drop constraint if exists custom_agent_schedules_avatar_face_chk;
alter table public.custom_agent_schedules
  add constraint custom_agent_schedules_avatar_face_chk check (
    avatar_face is null
    or avatar_face in ('wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise')
  );
