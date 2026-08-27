-- Six more expressions to pick from, and to cycle through while a turn is running:
-- squint, curious, grin, laugh, sad, focus.

alter table public.custom_agent_schedules
  drop constraint if exists custom_agent_schedules_avatar_face_chk;
alter table public.custom_agent_schedules
  add constraint custom_agent_schedules_avatar_face_chk check (
    avatar_face is null
    or avatar_face in (
      'wide', 'dot', 'wink', 'sleepy', 'squint', 'curious', 'smile',
      'grin', 'happy', 'laugh', 'sad', 'visor', 'focus', 'surprise'
    )
  );
