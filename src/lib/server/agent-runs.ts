import { createAdminClient } from '$lib/server/supabase-admin';

/** One tool step inside an agent loop — stored on agent_runs, not ai_calls. */
export type AgentStepLog = {
  step: number;
  toolCalls?: Array<{ name: string; input: unknown }>;
  toolResults?: Array<{ name: string; output: unknown }>;
  text?: string;
};

export type AgentRunCitation = { uri: string; title: string };

export type AgentRunInput = {
  brandId: string;
  userId?: string;
  agent: 'strategy' | 'week_planner' | 'gtm' | 'seo' | 'analytics_review' | 'produce' | 'dream';
  mode: string;
  status: 'finished' | 'fallback' | 'failed';
  finishedOk: boolean;
  notes?: string;
  citations?: AgentRunCitation[];
  steps?: AgentStepLog[];
  violations?: string[];
  costUsdEstimate?: number;
};

/**
 * Persist one agent session summary. Fire-and-forget — never throws, never blocks AI.
 * Does NOT replace ai_calls (per-LLM billing rows stay in logAiCall).
 */
export function persistAgentRun(input: AgentRunInput): void {
  try {
    const admin = createAdminClient();
    void admin
      .from('agent_runs')
      .insert({
        brand_id: input.brandId,
        user_id: input.userId ?? null,
        agent: input.agent,
        mode: input.mode,
        status: input.status,
        finished_ok: input.finishedOk,
        notes: input.notes?.slice(0, 8000) ?? null,
        citations: input.citations?.length ? input.citations : null,
        steps: input.steps?.length ? input.steps : null,
        violations: input.violations?.length ? input.violations : null,
        cost_usd_estimate: input.costUsdEstimate ?? null
      })
      .then(({ error }) => {
        if (error) console.warn('[agent-runs] insert failed:', error.message);
      });
  } catch {
    // missing admin env — optional observability
  }
}
