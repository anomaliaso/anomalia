// The agent behind the free tool at /tools/agent-team.
//
// A stranger pastes a URL and gets a colleague, not a report: something that reads their site,
// says what it thinks they do all week, ASKS about the parts a website cannot show ("who answers
// the DMs?", "how many quotes a week?"), and only then puts agents on the table — one card at a
// time, each one refusable.
//
// It is a normal agent loop (the same `ai` SDK, the same Gemini, the same tool-call streaming as
// the brand chats) with three differences, all of them consequences of being open to the internet:
//
//   1. NO ACCOUNT, so no thread: the browser sends the transcript back each turn and
//      `sanitizeTranscript` decides what is allowed to come back in. A public endpoint that
//      believed the client about its own history would be a free text generator for anyone.
//   2. NO WRITES: the tools read the site, search the public Agent Library, and draw cards.
//      Nothing here creates, buys, sends, or stores anything.
//   3. A HARD CEILING per turn — steps, tokens, wall clock — plus the per-IP daily cap in
//      tool-guard. A conversation is a much wider spend surface than a one-shot scan.
import { swallow } from '$lib/server/swallow';
import { tool, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_AGENTS,
  normalizeProposedAgent,
  readPageForAgent,
  siteBriefForPrompt,
  type SiteRead
} from '$lib/server/agent-team-public';
import { listAgentTemplates } from '$lib/server/agent-templates';
import type { AgentTemplate } from '$lib/agent-templates';
import {
  MAX_CRITERION_CHARS,
  MAX_GOAL_CRITERIA,
  applyCriteriaUpdate,
  goalIsMet,
  goalProgress,
  normalizeGoalCriteria,
  openCriteria,
  type GoalCriterion
} from '$lib/server/chat/goal';

/** Messages the browser may send back per turn. Older ones are dropped, oldest first. */
export const MAX_TRANSCRIPT_MESSAGES = 24;
/** Per message. A public endpoint cannot let the client decide how big the prompt is. */
export const MAX_MESSAGE_CHARS = 4000;
/** Tool steps in one turn: enough to read three pages and draw a card, not enough to wander. */
export const MAX_STEPS = 14;

export type PublicChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * What the client is allowed to hand back as "what we said so far".
 *
 * The transcript is not trusted — it is BOUNDED. Anyone can post any history to a public endpoint,
 * and no amount of validation changes that; what matters is that a forged history can only ever
 * make the model talk to itself about agent teams, never reach data or spend more than the caps
 * below allow. So: two roles only, a size per message, a count, and it must end on a user turn.
 */
export function sanitizeTranscript(raw: unknown): PublicChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicChatMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = String((m as { content?: unknown })?.content ?? '').trim();
    if ((role !== 'user' && role !== 'assistant') || !content) continue;
    out.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  // Keep the tail: the last thing said matters more than the first.
  const tail = out.slice(-MAX_TRANSCRIPT_MESSAGES);
  while (tail.length && tail[tail.length - 1].role !== 'user') tail.pop();
  return tail;
}

/**
 * The goal, without a database.
 *
 * `goal.ts` gave every brand chat the one thing a turn cannot do on its own: a definition of done
 * that the CODE holds, so "finito" stops being the model's opinion. A public tool needs that even
 * more — the whole point here is arriving at a team, and an agent that drifts into a nice chat
 * about digital transformation has failed while sounding helpful.
 *
 * What it cannot have is the storage: no account, no thread, no row. So the checklist travels with
 * the conversation — the browser sends it back, the server re-validates it — and everything that
 * decides anything is the SAME code the brand chats run: `normalizeGoalCriteria`,
 * `applyCriteriaUpdate`, `goalIsMet`, and the refusal in close_goal that is the heart of it.
 */
export type PublicGoal = { statement: string; criteria: GoalCriterion[] };

const CRITERION_STATUSES = new Set(['open', 'done', 'dropped']);

/** What the client may hand back as "the goal so far". Same bounding logic as the transcript. */
export function sanitizeGoal(raw: unknown): PublicGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const statement = String(g.statement ?? '').trim().slice(0, 500);
  if (!statement) return null;

  const list = Array.isArray(g.criteria) ? g.criteria : [];
  // Rebuild through normalizeGoalCriteria so ids, caps and de-duplication are the shared ones,
  // then re-apply the statuses the client reported for the texts that survived.
  const texts = list.map((c) => String((c as { text?: unknown })?.text ?? '').trim()).filter(Boolean);
  const criteria = normalizeGoalCriteria(texts);
  for (const c of criteria) {
    const match = list.find((x) => String((x as { text?: unknown })?.text ?? '').trim() === c.text) as
      | Record<string, unknown>
      | undefined;
    const status = String(match?.status ?? 'open');
    if (CRITERION_STATUSES.has(status)) c.status = status as GoalCriterion['status'];
    const note = String(match?.note ?? '').trim();
    if (note) c.note = note.slice(0, MAX_CRITERION_CHARS);
  }
  return criteria.length ? { statement, criteria } : null;
}

/** The goal block for the system prompt — the onboarding variant, with its own first-reply rule. */
function goalBlock(goal: PublicGoal | null): string {
  if (!goal) {
    return `GOAL — SET IT YOURSELF, IN YOUR FIRST REPLY (set_goal):
- Before anything else, call set_goal with what has to be TRUE for this conversation to have been worth their time. One sentence, then 3 to ${MAX_GOAL_CRITERIA} checkable facts.
- Facts, not steps of your process: "the recurring processes of <site> are named and confirmed by the user", "at least three agents are on the table, each standing on one of those processes", "the user knows which one to start with". Never "analyse the business".
- Then work through them and close each one with update_goal the moment it is really true — right after the thing that made it true, never all together at the end.`;
  }
  const { done, total } = goalProgress(goal.criteria);
  const open = openCriteria(goal.criteria)
    .map((c) => `- ${c.id}: ${c.text}`)
    .join('\n');
  return `GOAL (${done}/${total} done) — ${goal.statement}
${open ? `Still open:\n${open}` : 'Everything is closed: call close_goal and tell them where to start.'}
- Close each criterion with update_goal the moment it is really true, and keep working until none is open. close_goal(outcome="met") is REFUSED while one is.
- If a criterion turns out to be impossible here (something only they can answer and they will not), drop it with a reason. Never mark it done, never leave it hanging in silence.`;
}

export function toModelMessages(messages: PublicChatMessage[]): ModelMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage);
}

// ---------------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------------

export function buildSystemPrompt(site: SiteRead, goal: PublicGoal | null): string {
  return `You are an operations partner who designs AI agent teams for real businesses. Right now you are looking at ONE business: the site below. A stranger pasted it and has told you nothing else yet.

YOUR GOAL, in this order — do not skip step 1, it is what makes the rest worth reading:
1. MAP THE PROCESSES. Say what this business repeats every week, in their own words: what comes in (orders, enquiries, bookings, applications, questions), who touches it, how often, and where it stalls. Use the DETECTED PROCESSES as your evidence, and the page text for the rest. Six to ten lines, no preamble.
2. ASK what the site cannot tell you — volumes, who does what today, which tool holds the data. ONE question at a time, the one whose answer would change the team most. Never ask something the site already answers.
3. PROPOSE THE TEAM, one \`propose_agent\` card per agent, each standing on a process you mapped. Best-first: the one that pays for itself soonest goes first. At most ${MAX_AGENTS} agents in total, and fewer is better than padded.

HOW YOU WORK:
- Write in the PRIMARY LANGUAGE OF THE SITE. If the site is Italian, everything you say and every card is Italian.
- Never invent a process. If you cannot point at it on the site or at something the user told you, ask instead of assuming.
- \`read_page\` opens another page of the same site when you need it (pricing, services, FAQ, careers). Cheap — use it before guessing, at most a few per turn.
- \`search_agent_library\` finds ready-made agents that already exist. If one matches what you are about to propose, put its slug in the card so the user can start with it instead of writing a prompt.
- Cards carry the detail: after drawing one, write at most one line about it. Do not repeat the mission, the cadence or the hours in prose.
- Never claim anything was created or activated. This is a public tool: nothing here runs until they start with Anomalia.
- Short paragraphs. No headers, no bullet-point walls, no emoji. Talk like a colleague who has read their site, because you have.

${goalBlock(goal)}

${siteBriefForPrompt(site)}`;
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

const AGENT_CARD_SCHEMA = z.object({
  name: z.string().min(1).max(60).describe('The role as a small team would name it, in the site language'),
  role: z.string().max(160).describe('One line: the job, not the technology'),
  department: z
    .enum(['marketing', 'content', 'sales', 'support', 'ops', 'data', 'product', 'people'])
    .describe('Where this agent sits'),
  mission: z.string().min(20).max(600).describe('2-3 sentences: what it does every time it runs'),
  because: z.string().max(400).describe('Why THIS business needs it, quoting what you saw or what the user told you'),
  signals: z
    .array(z.string())
    .max(4)
    .describe('ids from DETECTED PROCESSES this agent stands on. Only ids that are actually in that list.'),
  cadence: z.string().max(80).describe('When it runs: every morning, every Monday, on every new enquiry…'),
  inputs: z.array(z.string()).max(5).describe('What it needs to read'),
  outputs: z.array(z.string()).max(5).describe('What each run leaves behind'),
  integrations: z.array(z.string()).max(6).describe('Tools it needs access to, named as the business knows them'),
  handoffTo: z.array(z.string()).max(3).describe('Names of the teammates it passes work to (as you named them)'),
  impact: z.enum(['high', 'medium', 'low']),
  effort: z.enum(['high', 'medium', 'low']),
  hoursSavedPerWeek: z.number().describe('Honest estimate for a business this size, 0.5-20'),
  firstTask: z.string().max(400).describe('The very first task you would give it, concrete enough to run tomorrow'),
  librarySlug: z
    .string()
    .max(60)
    .optional()
    .describe('Slug from search_agent_library when one already does this job. Never invent one.')
});

export function createAgentTeamChatTools(opts: {
  site: SiteRead;
  supabase?: SupabaseClient;
  /** The goal as it arrived from the client; the tools below move it from here. */
  goal?: PublicGoal | null;
  /** Counts cards drawn this turn, so the caller can tell the client how the team is growing. */
  onProposal?: (agentName: string) => void;
}): ToolSet {
  const { site, supabase } = opts;
  // The turn's copy of the checklist. It goes back to the browser inside every goal tool result,
  // which is how it survives to the next turn — there is no row to write it to.
  let goal: PublicGoal | null = opts.goal ?? null;
  const goalState = () =>
    goal
      ? {
          statement: goal.statement,
          criteria: goal.criteria.map((c) => ({ id: c.id, text: c.text, status: c.status, note: c.note ?? null })),
          progress: (({ done, total }) => `${done}/${total}`)(goalProgress(goal.criteria))
        }
      : null;
  let templates: AgentTemplate[] | null = null;
  const proposed = new Set<string>();

  async function library(): Promise<AgentTemplate[]> {
    if (templates) return templates;
    templates = supabase ? await listAgentTemplates(supabase).catch((error) => { swallow('list agent templates', error); return []; }) : [];
    return templates;
  }

  return {
    set_goal: tool({
      description: [
        'Write down, before you start, what has to be TRUE for this conversation to have been worth their time — and let the system hold you to it.',
        'Call it in your FIRST reply, without asking permission. One sentence, then 3 to ' + MAX_GOAL_CRITERIA + ' checkable facts about the real state, in the site language.',
        'Facts, never steps of your process: "the recurring processes of this site are named and the user confirmed them", "three agents are on the table, each standing on one of those processes", "the user knows which one to start with".',
        'If a goal is already open, do not open a second one — update that one instead.'
      ].join(' '),
      inputSchema: z.object({
        statement: z.string().min(8).max(500).describe('The goal in one sentence, in the site language'),
        criteria: z
          .array(z.string().min(3).max(MAX_CRITERION_CHARS))
          .min(1)
          .max(MAX_GOAL_CRITERIA)
          .describe('Verifiable facts, in the order you will work through them')
      }),
      execute: async (input: { statement: string; criteria: string[] }) => {
        // Re-opening merges rather than replaces: a model that restates the same goal a turn later
        // would otherwise reset every criterion it had already closed.
        const criteria = normalizeGoalCriteria(input.criteria, goal?.criteria ?? []);
        goal = { statement: input.statement.trim().slice(0, 500), criteria };
        return {
          success: true,
          goal: goalState(),
          instruction:
            'The checklist is on screen now. Start on the first open criterion and close it with update_goal the moment it is really true.'
        };
      }
    }),

    update_goal: tool({
      description: [
        'Tick off, drop or add criteria on the goal of this conversation.',
        'Close a criterion the moment it is really true — right after the thing that made it true, not all of them together at the end.',
        'Drop one (with a note) when it cannot be reached here: leaving it open forever is worse, and marking it done would be a lie.'
      ].join(' '),
      inputSchema: z.object({
        done: z.array(z.string()).optional().describe('Criteria now TRUE, by id ("c2") or exact text'),
        drop: z.array(z.string()).optional().describe('Criteria that cannot be reached. Always explain in note.'),
        add: z.array(z.string().min(3).max(MAX_CRITERION_CHARS)).optional(),
        note: z.string().max(MAX_CRITERION_CHARS).optional()
      }),
      execute: async (input: { done?: string[]; drop?: string[]; add?: string[]; note?: string }) => {
        if (!goal) return { success: false, error: 'No goal yet — call set_goal first.' };
        const res = applyCriteriaUpdate(goal.criteria, input);
        goal = { ...goal, criteria: res.criteria };
        return {
          success: true,
          goal: goalState(),
          closed: res.closed,
          // An unknown reference swallowed in silence is exactly how a model comes to believe it
          // closed something that is still open.
          unknown: res.unknown,
          instruction: res.unknown.length
            ? `These do not exist on the list: ${res.unknown.join(', ')}. Check the ids and try again.`
            : goalIsMet(res.criteria)
              ? 'Every criterion is closed. Call close_goal and tell them where to start.'
              : 'Carry on with the first still-open criterion.'
        };
      }
    }),

    close_goal: tool({
      description:
        'Close the goal of this conversation. outcome="met" only when every criterion is closed — it is refused otherwise. Use outcome="handed_back" when what is missing depends on something only they can decide.',
      inputSchema: z.object({
        outcome: z.enum(['met', 'handed_back']),
        note: z.string().max(300).optional().describe('One line: what they got, or what is still missing')
      }),
      execute: async (input: { outcome: 'met' | 'handed_back'; note?: string }) => {
        if (!goal) return { success: false, error: 'No goal to close.' };
        const still = openCriteria(goal.criteria);
        // The refusal is the whole feature: from here on, "I'm done" is not the model's opinion.
        if (input.outcome === 'met' && still.length) {
          return {
            success: false,
            error: 'not_met',
            open: still.map((c) => ({ id: c.id, text: c.text })),
            message: `${still.length} criteria are still open. Close them, or drop the ones that cannot be reached with a reason — do not declare this met.`
          };
        }
        return {
          success: true,
          outcome: input.outcome,
          goal: goalState(),
          note: input.note ?? null,
          instruction:
            input.outcome === 'met'
              ? 'Say in two lines which agent to start with and why that one. Nothing else.'
              : 'Say plainly what is still missing and what you would need from them to finish it.'
        };
      }
    }),

    read_page: tool({
      description:
        'Open one more page of THIS site and read it (pricing, services, FAQ, careers, a product page). Use it whenever the homepage leaves a process unclear — it is cheap, and reading beats guessing. Same site only.',
      inputSchema: z.object({
        path: z.string().describe('Path on this site, e.g. "/pricing". Pick from the list in the brief.')
      }),
      execute: async ({ path }: { path: string }) => {
        try {
          const page = await readPageForAgent(site.url, path);
          return {
            success: true,
            path: page.path,
            title: page.title,
            text: page.text,
            processes_found: page.signals.map((s) => `${s.id} (${s.evidence})`)
          };
        } catch (e) {
          // A 404 on a guessed path is normal and must not end the turn.
          return { success: false, message: e instanceof Error ? e.message : 'Could not read that page' };
        }
      }
    }),

    search_agent_library: tool({
      description:
        'Search Anomalia’s public Agent Library — ready-made agents someone already wrote the prompt for. Call it before proposing an agent whose job sounds standard (weekly recap, SEO upkeep, content production): if one matches, the user can start from it instead of from a blank page.',
      inputSchema: z.object({
        query: z.string().max(80).describe('A few words about the job, e.g. "weekly performance recap"')
      }),
      execute: async ({ query }: { query: string }) => {
        const all = await library();
        const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const scored = all
          .map((t) => {
            const hay = `${t.name} ${t.tagline} ${t.tags.join(' ')} ${t.category}`.toLowerCase();
            return { t, score: words.filter((w) => hay.includes(w)).length };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        return {
          success: true,
          found: scored.length,
          agents: scored.map(({ t }) => ({ slug: t.slug, name: t.name, tagline: t.tagline, category: t.category })),
          note: scored.length
            ? 'Put the slug of a real match in the card’s librarySlug. Never invent a slug.'
            : 'Nothing matches — propose the agent without a librarySlug.'
        };
      }
    }),

    propose_agent: tool({
      description: [
        'Put ONE agent on the table: draws a card in the conversation with the role, what it does, when it runs, what it needs, what it leaves behind and the hours it takes off their week.',
        'One call per agent — three ideas are three calls, so each can be judged on its own. Propose only agents that stand on a process you mapped from the site or from what the user told you.',
        `At most ${MAX_AGENTS} in the whole conversation. After a card, write one short line at most and move on.`
      ].join(' '),
      inputSchema: AGENT_CARD_SCHEMA,
      execute: async (input: z.infer<typeof AGENT_CARD_SCHEMA>) => {
        if (proposed.size >= MAX_AGENTS) {
          return {
            success: false,
            message: `The team is already at ${MAX_AGENTS} agents. Rather than adding another, say which one to start with.`
          };
        }
        const agent = normalizeProposedAgent(input, site.signals);
        if (!agent) {
          return {
            success: false,
            // The refusal names the fix, otherwise the model retries the same card verbatim.
            message:
              'That card stands on nothing: cite an id from DETECTED PROCESSES in `signals`, or explain in `because` what on this site (or in what the user told you) makes this agent necessary.'
          };
        }
        if (proposed.has(agent.id)) {
          return { success: false, message: `“${agent.name}” is already on the table. Propose a different one.` };
        }
        proposed.add(agent.id);

        const slug = String(input.librarySlug ?? '').trim().toLowerCase();
        if (slug) {
          const match = (await library()).find((t) => t.slug === slug);
          if (match) agent.library = { slug: match.slug, name: match.name, tagline: match.tagline };
        }
        opts.onProposal?.(agent.name);

        return {
          success: true,
          // The card the client renders. Everything the user sees comes from here, already clamped.
          agent,
          position: proposed.size,
          instruction:
            'The card is on screen. One short line about it at most — never repeat the mission, the cadence or the hours, they are all on the card. Then continue with the next agent or with the question you still need answered.'
        };
      }
    })
  };
}

