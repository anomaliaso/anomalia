import type { SupabaseClient } from '@supabase/supabase-js';
import { turnModelFamily } from '$lib/chat-model-policy';
import type { AgentModelPolicy } from '@anomalia/agent-contracts/contracts';

/**
 * La preferenza di modello che governa il turno (0225): quella scritta sul thread vince, e in
 * sua assenza vale quella permanente dell'agente custom legato al thread. null = nessuna, decide
 * il tier del turno.
 */
export async function threadModelPreference(
  supabase: SupabaseClient,
  opts: { brandId: string; threadModel: unknown; customAgentId: string | null }
): Promise<AgentModelPolicy | null> {
  const fromThread = turnModelFamily(opts.threadModel);
  if (fromThread || !opts.customAgentId) return fromThread;

  const { data } = await supabase
    .from('custom_agents')
    .select('model')
    .eq('id', opts.customAgentId)
    .eq('brand_id', opts.brandId)
    .maybeSingle();
  return turnModelFamily((data as { model?: unknown } | null)?.model);
}
