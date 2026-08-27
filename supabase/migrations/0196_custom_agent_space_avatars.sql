-- Space bodies join the avatar set: planets, a black hole, a star, an asteroid, a comet.
-- Same two-colour drawing, no face — the identity is in the silhouette.

alter table public.custom_agent_schedules
  drop constraint if exists custom_agent_schedules_avatar_face_chk;
alter table public.custom_agent_schedules
  add constraint custom_agent_schedules_avatar_face_chk check (
    avatar_face is null
    or avatar_face in (
      'wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise',
      'moon', 'jupiter', 'saturn', 'blackhole', 'star', 'asteroid', 'comet', 'eclipse'
    )
  );
