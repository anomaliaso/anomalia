import { json } from '@sveltejs/kit';
import { listCustomAgents } from '$lib/server/custom-agents';
import { fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
import type { RequestHandler } from './$types';

/** The brand's custom agents, shaped for the composer picker (avatar + name). */
export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  // Il picker sceglie CHI, non un incarico: `custom_agents`, non le sue routine (0210).
  const agents = await listCustomAgents(supabase, brand.id);
  return json({
    agents: agents.map((s) => ({
      id: s.id,
      name: s.name,
      agent: s.agent,
      enabled: s.enabled,
      face: s.avatar_face || fallbackAvatarFace(s.id),
      color: s.avatar_color || fallbackAvatarColor(s.id)
    }))
  });
};
