import { json } from '@sveltejs/kit';
import { normalizeAgentProposal } from '$lib/chat-agent-proposal';
import {
  MAX_CUSTOM_AGENT_SCHEDULES,
  createCustomAgentSchedule,
  hireCustomAgent,
  listCustomAgentSchedules,
  parseCustomAgentSchedule
} from '$lib/server/custom-agents';
import { parseRoutineOwner } from '$lib/agent-owners';
import { fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
import type { RequestHandler } from './$types';

/**
 * "Sì, assumilo" — the confirm button on a `propose_custom_agent` card.
 *
 * THE BODY CARRIES NO AGENT. It carries a thread id and a tool call id, and the proposal is read
 * back out of the saved assistant message. That is the whole point of the round trip: a card that
 * said "Monday 09:00, brand hub" cannot create something that runs nightly with a different brief,
 * no matter what the browser posts. It also means confirming twice creates once — the second call
 * finds the name already taken and returns the existing row instead of a duplicate.
 *
 * No model turn is involved: what was on screen is what gets created.
 */
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const threadId = typeof body?.thread_id === 'string' ? body.thread_id : '';
  const toolCallId = typeof body?.tool_call_id === 'string' ? body.tool_call_id : '';
  if (!threadId || !toolCallId) return json({ error: 'thread_id and tool_call_id are required' }, { status: 400 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, timezone')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  // brand_id + user_id + thread_id: the same three keys every other read of this table uses, so a
  // tool call id from someone else's thread finds nothing here rather than something.
  const { data: rows, error } = await supabase
    .from('chat_messages')
    .select('tool_calls')
    .eq('brand_id', brand.id)
    .eq('user_id', user.id)
    .eq('thread_id', threadId)
    .eq('role', 'assistant')
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) {
    console.error('[agent-confirm] load messages', error.message);
    return json({ error: 'Could not read that proposal' }, { status: 500 });
  }

  const proposal = findProposal(rows ?? [], toolCallId);
  if (!proposal) return json({ error: 'not_found', message: 'That proposal is no longer available.' }, { status: 404 });

  const existing = await listCustomAgentSchedules(supabase, brand.id);
  // Confirming the same card twice (double click, second tab, reload) must not end with two
  // agents doing the same job on the same morning.
  const clash = existing.find((r) => r.name.trim().toLowerCase() === proposal.name.trim().toLowerCase());
  if (clash) return json({ id: clash.id, name: clash.name, already: true });

  if (existing.length >= MAX_CUSTOM_AGENT_SCHEDULES) {
    return json(
      { error: 'limit', message: `This brand already has the maximum of ${MAX_CUSTOM_AGENT_SCHEDULES} recurring agents.` },
      { status: 409 }
    );
  }

  const parsed = parseCustomAgentSchedule({
    name: proposal.name,
    prompt: proposal.prompt,
    agent: proposal.agent,
    avatarFace: fallbackAvatarFace(proposal.name),
    avatarColor: fallbackAvatarColor(proposal.name),
    days: proposal.days,
    times: proposal.times,
    enabled: true,
    reuseThread: false
  });
  if (!parsed.ok) {
    console.error('[agent-confirm] stored proposal did not parse:', parsed.error);
    return json({ error: parsed.error, message: 'That proposal is not valid any more.' }, { status: 422 });
  }

  // La scheda diceva a chi appartiene: con un proprietario si crea SOLO la routine (finisce sulla
  // card di chi c'era già), senza si assume un agente nuovo e le si dà il suo primo incarico —
  // due righe, non una che è insieme la persona e il compito (0210).
  const created = parseRoutineOwner(parsed.value.agent)
    ? await createCustomAgentSchedule(supabase, {
        brandId: brand.id,
        userId: user.id,
        timezone: brand.timezone ?? 'Europe/Rome',
        input: parsed.value
      })
    : await hireCustomAgent(supabase, {
        brandId: brand.id,
        userId: user.id,
        timezone: brand.timezone ?? 'Europe/Rome',
        agent: {
          name: parsed.value.name,
          prompt: parsed.value.prompt,
          agent: parsed.value.agent,
          avatarFace: parsed.value.avatarFace,
          avatarColor: parsed.value.avatarColor,
          enabled: true
        },
        routine: parsed.value
      });
  if (!created.ok) return json({ error: created.error, message: 'Could not save the agent.' }, { status: 500 });

  return json({
    id: 'scheduleId' in created ? created.scheduleId : created.id,
    name: parsed.value.name,
    days: parsed.value.daysOfWeek,
    times: parsed.value.times
  });
};

/** The proposal payload of one tool call, from whichever saved message carries it. */
function findProposal(rows: Array<{ tool_calls: unknown }>, toolCallId: string) {
  for (const row of rows) {
    const parts = Array.isArray(row.tool_calls) ? row.tool_calls : [];
    for (const part of parts as Array<Record<string, unknown>>) {
      if (part?.toolCallId !== toolCallId || part?.toolName !== 'propose_custom_agent') continue;
      // `agentProposal` is what persistence enriched; `output` is the raw tool result it came
      // from — read either, so a row written before the enrichment still confirms.
      const proposal = normalizeAgentProposal(part.agentProposal) ?? normalizeAgentProposal(part.output);
      if (proposal) return proposal;
    }
  }
  return null;
}
