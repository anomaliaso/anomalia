import type { SupabaseClient } from '@supabase/supabase-js';
import { parseRoutineOwner } from '$lib/agent-owners';

/**
 * LEGGERE UN CUSTOM AGENT, e nient'altro.
 *
 * Sta in un file suo per la stessa ragione per cui ci sta `custom-agent-persona.ts`: chi ha
 * bisogno di sapere chi è un custom agent è la coda della chat, e `custom-agents.ts` la coda la
 * importa. Un modulo foglia (solo il client Supabase e la grammatica degli owner) tiene i due
 * dal chiudersi in cerchio.
 *
 * `custom_agents` è l'IDENTITÀ — chi è l'agente, che faccia ha, qual è la sua consegna permanente,
 * se è in servizio. Le sue ROUTINE stanno in `custom_agent_schedules`, una riga per cadenza, e
 * dicono a chi appartengono nella colonna `agent` (`custom:<uuid>`). Vedi 0210_custom_agents.sql.
 */
export type CustomAgentRow = {
  id: string;
  brand_id: string;
  user_id: string;
  name: string;
  prompt: string;
  agent: string | null;
  avatar_face: string | null;
  avatar_color: string | null;
  enabled: boolean;
  /** Model preference (AgentModelPolicy | null): la famiglia che esegue i suoi turni. */
  model?: unknown;
  template_slug: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * PONTE FINCHÉ LA 0210 NON È APPLICATA A MANO (in questo progetto il deploy non esegue le
 * migration). Senza la tabella, un custom agent è ancora la sua riga di schedulazione senza
 * proprietario — il modello vecchio — quindi la si mappa nella forma nuova e tutto quello che sta
 * a valle (pagina, persona, stanze, composer) non si accorge di niente. L'id è lo stesso in
 * entrambi i mondi, quindi nessuna chiave `custom:<uuid>` cambia quando la tabella arriva.
 *
 * ponytail: si cancella insieme ad `agentsFallback` appena la 0210 è applicata ovunque.
 */
function scheduleAsAgent(s: Record<string, unknown>): CustomAgentRow {
  return {
    id: s.id as string,
    brand_id: s.brand_id as string,
    user_id: s.user_id as string,
    name: (s.name as string) ?? '',
    prompt: (s.prompt as string) ?? '',
    agent: (s.agent as string | null) ?? null,
    avatar_face: (s.avatar_face as string | null) ?? null,
    avatar_color: (s.avatar_color as string | null) ?? null,
    enabled: s.enabled !== false,
    template_slug: (s.template_slug as string | null) ?? null,
    created_at: (s.created_at as string) ?? '',
    updated_at: (s.updated_at as string) ?? ''
  };
}

async function agentsFallback(
  supabase: SupabaseClient,
  brandId: string,
  ids?: string[]
): Promise<CustomAgentRow[]> {
  let q = supabase.from('custom_agent_schedules').select('*').eq('brand_id', brandId);
  if (ids?.length) q = q.in('id', ids);
  const { data } = await q;
  // Solo le righe SENZA proprietario: quelle con `team:`/`custom:` sono già routine di qualcuno.
  return (data ?? [])
    .filter((s) => !parseRoutineOwner((s as { agent?: string | null }).agent))
    .map((s) => scheduleAsAgent(s as Record<string, unknown>));
}

export async function listCustomAgents(
  supabase: SupabaseClient,
  brandId: string
): Promise<CustomAgentRow[]> {
  const { data, error } = await supabase
    .from('custom_agents')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  if (error) return agentsFallback(supabase, brandId);
  return (data ?? []) as CustomAgentRow[];
}

export async function getCustomAgentsByIds(
  supabase: SupabaseClient,
  brandId: string,
  ids: string[]
): Promise<CustomAgentRow[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('custom_agents')
    .select('*')
    .eq('brand_id', brandId)
    .in('id', ids);
  if (error) return agentsFallback(supabase, brandId, ids);
  return (data ?? []) as CustomAgentRow[];
}

export async function getCustomAgent(
  supabase: SupabaseClient,
  brandId: string,
  id: string
): Promise<CustomAgentRow | null> {
  const rows = await getCustomAgentsByIds(supabase, brandId, [id]);
  return rows[0] ?? null;
}
