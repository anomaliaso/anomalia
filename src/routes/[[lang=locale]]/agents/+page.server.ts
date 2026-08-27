import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listAgentTemplates } from '$lib/server/agent-templates';

// The Agent Library is a public directory: no gate, no preview limit. Someone landing here from
// a search should see the whole catalogue — the paywall is on running an agent, not on reading
// what it does.
export const load: PageServerLoad = async () => {
  const agents = await listAgentTemplates(createAdminClient());
  return { agents };
};
