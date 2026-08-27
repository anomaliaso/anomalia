-- 0199_more_avatar_expressions widened the face set for custom_agent_schedules but 0201 landed
-- in parallel, so the Agent Library still only accepts the original eight. Same list, same
-- meaning — a library agent should be allowed to wear any face a user's own agent can.
--
-- Applied to Supabase kszazivzwievqixcnanp via MCP.

alter table public.agent_templates
  drop constraint if exists agent_templates_avatar_face_check;
alter table public.agent_templates
  add constraint agent_templates_avatar_face_check check (
    avatar_face is null
    or avatar_face in (
      'wide', 'dot', 'wink', 'sleepy', 'squint', 'curious', 'smile',
      'grin', 'happy', 'laugh', 'sad', 'visor', 'focus', 'surprise'
    )
  );
