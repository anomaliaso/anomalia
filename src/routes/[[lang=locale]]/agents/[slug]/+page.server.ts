import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { getAgentTemplate, listAgentTemplates, relatedAgentTemplates } from '$lib/server/agent-templates';

export const load: PageServerLoad = async ({ params }) => {
  const admin = createAdminClient();
  // One round trip more than strictly needed, but the "more like this" strip is part of the
  // page: a directory entry with no way onward is a dead end.
  const [agent, all] = await Promise.all([
    getAgentTemplate(admin, params.slug),
    listAgentTemplates(admin)
  ]);
  if (!agent) error(404, 'Agent not found');
  return { agent, related: relatedAgentTemplates(all, agent, 3) };
};
