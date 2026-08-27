/**
 * Types + helpers for the `propose_custom_agent` chat card.
 *
 * WHY A CARD AND NOT A SENTENCE. `create_scheduled_agent` already let the chat put a recurring
 * agent to work, and that is exactly the problem: the agent that *suggests* hiring someone was
 * also the one that hired them. Everything a person needs to decide — the name, the brief it will
 * run every time, which specialist runs it, what days and hours — lived in prose that scrolls away,
 * and "sì dai" in a conversation is not consent to a standing job that spends credits every week.
 *
 * So the proposal is a THING: one box, all the facts, two buttons. Confirm creates exactly what
 * the box shows (the server re-reads the proposal from the stored message — see
 * /chat/agents/confirm — so what was on screen is what gets created, not a paraphrase of it).
 * Decline speaks back into the conversation, because "no, not that one" is the start of the next
 * proposal and not the end of the topic.
 */

/** 0 = Sunday .. 6 = Saturday — the same vocabulary as custom_agent_schedules. */
export type ChatAgentProposal = {
  name: string;
  /** The standing brief. Shown in full: it is what the agent will actually do, every run. */
  prompt: string;
  /**
   * Chi la esegue, o CHI LA POSSIEDE. Un valore prefissato (`team:<id>` / `custom:<uuid>`,
   * $lib/agent-owners) dice che questa non è una nuova assunzione ma una routine di un agente
   * che c'è già — e va conservato tale e quale fin qui, perché è lo stesso oggetto che
   * /chat/agents/confirm rilegge dal messaggio salvato per creare esattamente ciò che si vedeva.
   */
  agent: string;
  /** Il nome del proprietario, per la card. Vuoto = nessun proprietario (agente nuovo). */
  ownerName?: string;
  days: number[];
  times: string[];
  /** One line: why this brand, now. Written by the chat, shown above the fold. */
  because: string;
  /** What it leaves behind after each run. */
  outputs: string[];
};

const AGENTS = ['publish', 'brand', 'grow', 'web', 'auto'];

function str(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Read a proposal out of whatever the tool call left behind — the enriched `agentProposal` the
 * server attaches when persisting, or the raw tool output on a turn that is still live. Returns
 * null for anything that is not a complete, showable proposal: a half-filled card asking for a
 * yes is worse than no card.
 */
export function normalizeAgentProposal(raw: unknown): ChatAgentProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  // Accept both the payload itself and a tool output that wraps it.
  const p = (src.proposal && typeof src.proposal === 'object' ? src.proposal : src) as Record<string, unknown>;

  const name = str(p.name, 80);
  const prompt = String(p.prompt ?? '').trim().slice(0, 8000);
  if (!name || prompt.length < 20) return null;

  const days = Array.isArray(p.days)
    ? [...new Set(p.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const times = Array.isArray(p.times)
    ? [...new Set(p.times.map((t) => str(t, 5)).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].slice(0, 4)
    : [];
  if (!days.length || !times.length) return null;

  // `team:<id>` / `custom:<uuid>` passa intero (fino a 48 char: `custom:` + un uuid): è il
  // proprietario della routine, e schiacciarlo su 'auto' creerebbe un collega nuovo al posto di
  // una routine dell'agente che la card mostrava.
  const agent = str(p.agent, 48).toLowerCase();
  const owned = agent.startsWith('team:') || agent.startsWith('custom:');
  const ownerName = str(p.owner_name ?? p.ownerName, 80);
  return {
    name,
    prompt,
    agent: owned ? agent : AGENTS.includes(agent) ? agent : 'auto',
    // Assente quando non c'è un proprietario: una proposta senza padrone resta byte per byte
    // quella di prima, e le schede già salvate non cambiano forma.
    ...(ownerName ? { ownerName } : {}),
    days,
    times,
    because: str(p.because, 300),
    outputs: Array.isArray(p.outputs) ? p.outputs.map((o) => str(o, 120)).filter(Boolean).slice(0, 4) : []
  };
}

const DAY_NAMES: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  it: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
};

/** "lun, gio · 09:00" — the schedule in the shape a person reads it. */
export function describeSchedule(days: number[], times: string[], lang = 'en'): string {
  const names = DAY_NAMES[lang.slice(0, 2).toLowerCase()] ?? DAY_NAMES.en;
  const d = days.length === 7 ? null : days.map((x) => names[x] ?? String(x)).join(', ');
  return [d, times.join(', ')].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Decision memory
// ---------------------------------------------------------------------------------------------
// The decision lives on the server the moment it is confirmed (the schedule row exists), but the
// card also has to survive a reload BEFORE anything has been created — otherwise scrolling back
// through a thread offers to create the same agent a second time. Same sessionStorage trick as
// the questions card, and the same reason.

export type AgentProposalDecision = { state: 'created' | 'declined'; id?: string };

const key = (threadId: string, toolCallId: string) => `anomalia:chat-agent:${threadId}:${toolCallId}`;

export function loadProposalDecision(threadId: string, toolCallId: string): AgentProposalDecision | null {
  if (typeof sessionStorage === 'undefined' || !threadId || !toolCallId) return null;
  try {
    const raw = sessionStorage.getItem(key(threadId, toolCallId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentProposalDecision;
    return parsed?.state === 'created' || parsed?.state === 'declined' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProposalDecision(
  threadId: string,
  toolCallId: string,
  decision: AgentProposalDecision
): void {
  if (typeof sessionStorage === 'undefined' || !threadId || !toolCallId) return;
  try {
    sessionStorage.setItem(key(threadId, toolCallId), JSON.stringify(decision));
  } catch {
    /* quota / private mode */
  }
}
