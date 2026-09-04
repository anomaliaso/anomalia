import type { SupabaseClient } from '@supabase/supabase-js';
import { structured } from './research';
import { withBrandContext } from './ai-log';
import { defaultSkillsFor } from './default-skills';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// ── Types ──────────────────────────────────────────────────────────────────────

export type MemoryCategory = 'voice' | 'constraint' | 'fact' | 'preference' | 'insight' | 'skill';
export type MemorySource = 'chat' | 'research' | 'onboarding' | 'user' | 'analysis';
export type MemoryLayer = 'session' | 'project' | 'global';

// ── La memoria dell'agente: il MESTIERE, non il brand ──────────────────────────
/**
 * `agent` è la terza dimensione della memoria (migration 0212), non un archivio separato:
 *
 *   null                 → memoria del BRAND: la leggono tutti gli agenti, sempre.
 *   'content' | 'motion' → nota di mestiere di quello specialista, la legge solo lui.
 *   'custom:<uuid>'      → stessa cosa per un agente custom (grammatica di agent-owners.ts).
 *
 * Se Content impara che questo brand non dice mai "soluzione innovativa", quel fatto deve
 * arrivare anche a Motion e a Web: chiuderlo dentro Content renderebbe la squadra più stupida.
 * Quello che appartiene a un agente è COME LAVORA ("i caroselli rendono col prezzo alla terza
 * slide"), non cosa sa del brand.
 */
export type MemoryAgent = string | null;

/**
 * Le categorie che NON possono essere private di un agente: sono per definizione del brand.
 * La regola sta qui e non nel prompt perché è esattamente il caso in cui un modello sbaglierebbe
 * in silenzio, frammentando la conoscenza del brand una riga alla volta.
 */
const BRAND_ONLY_CATEGORIES = new Set<MemoryCategory>(['voice', 'constraint', 'fact']);

/** L'agente sotto cui una scrittura finisce davvero: brand-only per voice/constraint/fact. */
export function memoryAgentScope(category: MemoryCategory, agent?: MemoryAgent): MemoryAgent {
  if (!agent) return null;
  return BRAND_ONLY_CATEGORIES.has(category) ? null : agent;
}

/**
 * Il filtro di lettura di un agente: la memoria del brand PIÙ la propria, mai quella dei colleghi
 * (una nota di metodo altrui è rumore, non conoscenza). Senza agente: solo il brand.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopeToAgent<Q extends { or: (f: string) => Q; is: (c: string, v: any) => Q }>(
  query: Q,
  agent?: MemoryAgent
): Q {
  if (!agent) return query.is('agent', null);
  // Valore fra virgolette: `custom:<uuid>` contiene i due punti e PostgREST vuole il letterale
  // quotato per non provare a leggerlo come un operatore.
  return query.or(`agent.is.null,agent.eq."${agent.replace(/"/g, '')}"`);
}

/**
 * A skill is a memory entry whose value is a whole procedure (first line = when to use it, rest =
 * the steps) instead of a one-line fact. Capped because every skill costs a line in EVERY prompt.
 */
export const MAX_SKILLS_PER_BRAND = 20;
/** How many skills can appear in the prompt index at once (ceiling on the prompt cost of skills). */
const SKILL_INDEX_MAX = 12;

export type MemoryEntry = {
  id: string;
  brand_id: string;
  layer: MemoryLayer;
  category: MemoryCategory;
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  times_reinforced: number;
  /** How many times this entry was injected into an AI prompt (drives decay in runDream). */
  times_used: number;
  last_reinforced_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  importance?: number;
  thread_id?: string | null;
  /** null = memoria del brand; altrimenti l'agente proprietario della nota di mestiere. */
  agent?: MemoryAgent;
  promoted_at?: string | null;
  promoted_by?: string | null;
};

export type MemoryGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
  reason: 'category' | 'tokens';
};

export type MemoryWriteOpts = {
  category: MemoryCategory;
  key: string;
  value: string;
  source?: MemorySource;
  confidence?: number;
  layer?: MemoryLayer;
  /** Required when layer is 'session' (DB CHECK). */
  threadId?: string;
  expiresDays?: number;
  /** 1..5, only applied on INSERT — a manual change in the UI must never be overwritten. */
  importance?: number;
  /** Exempt from decay/archiving. Only applied on INSERT, same reason as importance. */
  pinned?: boolean;
  /**
   * Chi scrive. Vuoto = memoria del brand. Valorizzato = nota di mestiere di quell'agente —
   * ma voice/constraint/fact tornano comunque al brand (memoryAgentScope).
   */
  agent?: MemoryAgent;
};

// ── Enrich: merge memory into an existing ai_context string ────────────────────

/**
 * Enrich a profile's ai_context with memory entries. Call this at every
 * profile assembly point so all downstream AI consumers get shared memory.
 * Non-destructive: appends memory below the existing ai_context.
 */
export async function enrichProfileWithMemory(
  supabase: SupabaseClient,
  brandId: string,
  profile: { ai_context?: string; [key: string]: unknown }
): Promise<void> {
  const memory = await buildMemoryContext(supabase, brandId);
  if (!memory) return;
  const existing = profile.ai_context ?? '';
  profile.ai_context = existing ? `${existing}\n\n${memory}` : memory;
}

// ── Read: build a context string for AI prompts ────────────────────────────────

/**
 * The first non-empty line of a skill body — its "when to use". That one line is everything the
 * prompt sees of a skill, so it is truncated hard: an index entry only has to be recognisable
 * enough for the model to decide whether to open the full thing.
 */
export function skillTrigger(value: string): string {
  const first =
    value
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  const clean = first.replace(/^#+\s*/, '').replace(/\*\*/g, '');
  return clean.length > 100 ? `${clean.slice(0, 99)}…` : clean;
}

/**
 * Build a formatted memory context string for injection into AI prompts.
 * Project/global memory is always included (budgeted). When `threadId` is set,
 * session memories for that thread are appended in a clearly labeled block.
 */
export async function buildMemoryContext(
  supabase: SupabaseClient,
  brandId: string,
  opts?: {
    threadId?: string;
    /**
     * CHI legge: filtra le righe (brand + proprie, mai quelle dei colleghi) e i trigger delle
     * skill di default. `custom:<uuid>` per un agente custom.
     */
    agent?: MemoryAgent;
  }
): Promise<string> {
  // Core memory: project/global only — pinned first, then importance/confidence, ~800 token budget.
  // Scoped: la memoria del brand PIÙ quella dell'agente che sta rispondendo. Senza agente
  // (scheduler, radar, weekly-recap) resta solo il brand — una nota di metodo altrui in un prompt
  // di produzione è rumore.
  const { data } = await scopeToAgent(
    supabase
      .from('brand_memory')
      .select('id, category, key, value, confidence, source, pinned, importance, agent')
      .eq('brand_id', brandId)
      .neq('layer', 'session')
      .gte('confidence', 0.4)
      .order('pinned', { ascending: false })
      .order('importance', { ascending: false })
      .order('confidence', { ascending: false }),
    opts?.agent
  );

  const BUDGET_TOKENS = 800;
  const usedIds: string[] = [];
  let tokens = 0;
  let skillsListed = 0;
  const groups: Record<string, string[]> = {};

  for (const entry of data ?? []) {
    const isSkill = entry.category === 'skill';
    // A skill's value is a whole procedure — injecting the body would spend the entire budget on
    // one entry. Only its trigger line goes in; the model pulls the steps with read_memory when
    // the trigger actually matches. Skills get their own count cap instead of the token budget,
    // because a skill missing from the index is a skill the model never knows exists.
    if (isSkill && skillsListed >= SKILL_INDEX_MAX) continue;
    const line = isSkill
      ? `${entry.key} — ${skillTrigger(String(entry.value ?? ''))}`
      : String(entry.value ?? '');
    const cost = Math.max(1, Math.ceil(line.length / 4));
    const isPinned = !!entry.pinned;
    if (!isSkill && !isPinned && tokens + cost > BUDGET_TOKENS) continue;
    tokens += cost;
    if (isSkill) skillsListed++;
    // Listing a skill's trigger is NOT using the skill. Counting it here would keep last_used_at
    // permanently fresh and switch off the decay in runDream, so a skill written once and never
    // followed would sit in every prompt forever. Usage is recorded when read_memory pulls the body.
    if (!isSkill) usedIds.push(entry.id as string);
    const cat = entry.category as string;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(line);
  }

  // Built-in product skills (default-skills.ts): defined in code, zero DB rows, versioned with
  // the deploy. Same contract as brand skills — trigger here, body via read_memory — but they
  // bypass SKILL_INDEX_MAX and the brand cap: those protect the prompt from unbounded BRAND rows,
  // while this set is fixed and small by construction. Brand skills stay listed first.
  // Le skill di default si filtrano per HUB (motion/content/…), non per proprietario: un agente
  // custom non è un hub, quindi `custom:<uuid>` vale null e le vede tutte — com'era prima che
  // `agent` diventasse anche la chiave della memoria.
  const skillAgent = opts?.agent?.startsWith('custom:') ? null : opts?.agent;
  for (const s of defaultSkillsFor(skillAgent)) {
    (groups.skill ??= []).push(`${s.key} — ${skillTrigger(s.value)}`);
  }

  // Usage tracking feeds the decay in runDream, so it must count what the model ACTUALLY saw —
  // entries cut by the token budget were never shown and must not look "used".
  // Fire-and-forget: prompt assembly never waits on it.
  if (usedIds.length) void recordMemoryUsage(supabase, usedIds);

  const labels: Record<string, string> = {
    constraint: 'CONSTRAINTS & RULES',
    preference: 'PREFERENCES',
    voice: 'VOICE & TONE',
    fact: 'KEY FACTS',
    insight: 'INSIGHTS & PATTERNS',
    skill:
      'SKILLS — agreed procedures for this brand. Each line is only the TRIGGER; before following one, call read_memory(category="skill") to get its steps'
  };

  const sections: string[] = [];
  for (const [cat, items] of Object.entries(groups)) {
    const label = labels[cat] ?? cat.toUpperCase();
    sections.push(`### ${label}\n${items.map((v) => `- ${v}`).join('\n')}`);
  }

  const projectBlock = sections.length ? `## BRAND MEMORY\n${sections.join('\n\n')}` : '';

  let sessionBlock = '';
  if (opts?.threadId) {
    const { data: sessionRows } = await scopeToAgent(
      supabase
        .from('brand_memory')
        .select('id, value, confidence')
        .eq('brand_id', brandId)
        .eq('layer', 'session')
        .eq('thread_id', opts.threadId)
        .gte('confidence', 0.4)
        .order('confidence', { ascending: false })
        .limit(40),
      opts.agent
    );

    if (sessionRows?.length) {
      void recordMemoryUsage(
        supabase,
        sessionRows.map((e) => e.id as string)
      );
      sessionBlock = `## CONTESTO DI QUESTA CHAT\nFatti emersi in questo thread (valgono solo qui, non sono regole permanenti del brand):\n${sessionRows.map((e) => `- ${e.value}`).join('\n')}`;
    }
  }

  return [projectBlock, sessionBlock].filter(Boolean).join('\n\n');
}

/**
 * Increment times_used for entries that were injected into a prompt. One round trip, and the
 * increment happens inside the DB: a read-modify-write per row loses counts whenever two
 * generations overlap, and prompt assembly runs on every post and every chat turn.
 */
export async function recordMemoryUsage(supabase: SupabaseClient, entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  const { error } = await supabase.rpc('bump_brand_memory_usage', { entry_ids: entryIds });
  if (error) console.error('recordMemoryUsage failed:', error.message);
}

/**
 * Load raw memory entries for a brand. Used by the Studio > Knowledge UI.
 * Defaults to project/global only (session memories stay inside their chat thread).
 */
export async function loadMemoryEntries(
  supabase: SupabaseClient,
  brandId: string,
  opts?: {
    category?: MemoryCategory;
    source?: MemorySource;
    layer?: MemoryLayer | 'project_or_global';
    threadId?: string;
    /**
     * Chi legge. Valorizzato ⇒ brand + proprie note, mai quelle dei colleghi.
     * ASSENTE ⇒ NESSUN filtro: è la pagina Knowledge, dove il brand deve vedere tutto quello che
     * la sua squadra ha imparato. (buildMemoryContext fa il contrario — lì "senza agente" vuol
     * dire "prompt di produzione", e le note di mestiere altrui non ci entrano.)
     */
    agent?: MemoryAgent;
  }
): Promise<MemoryEntry[]> {
  let query = supabase
    .from('brand_memory')
    .select('*')
    .eq('brand_id', brandId)
    .order('confidence', { ascending: false });

  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.source) query = query.eq('source', opts.source);
  if (opts?.agent !== undefined) query = scopeToAgent(query, opts.agent);

  if (opts?.layer === 'session') {
    query = query.eq('layer', 'session');
    if (opts.threadId) query = query.eq('thread_id', opts.threadId);
  } else if (opts?.layer && opts.layer !== 'project_or_global') {
    query = query.eq('layer', opts.layer);
  } else {
    // Knowledge page / default: never leak session chat notes into brand knowledge.
    query = query.neq('layer', 'session');
  }

  const { data } = await query;
  return (data ?? []) as MemoryEntry[];
}

// ── Write: upsert a memory entry ───────────────────────────────────────────────

/**
 * Write or reinforce a memory entry. If the key already exists for this brand,
 * the existing entry is reinforced (confidence bumped, times_reinforced incremented)
 * rather than duplicated. If the value changed, the new value wins but the
 * reinforcement counter still increases.
 */
export async function writeMemory(
  supabase: SupabaseClient,
  brandId: string,
  opts: MemoryWriteOpts
): Promise<{ id: string; reinforced: boolean }> {
  const source = opts.source ?? 'user';
  const confidence = opts.confidence ?? 1.0;
  // Chi possiede questa riga. voice/constraint/fact tornano SEMPRE al brand, anche se l'agente le
  // ha chieste private: la regola sta qui, non nel prompt.
  const agent = memoryAgentScope(opts.category, opts.agent);
  // A skill is a standing procedure: it only means anything if it outlives the chat that wrote it,
  // so it is never session-scoped no matter what the caller asked for.
  const layer = opts.category === 'skill' ? 'project' : (opts.layer ?? 'project');
  if (layer === 'session' && !opts.threadId) {
    throw new Error('threadId is required for session memory');
  }
  const expiresAt = opts.expiresDays
    ? new Date(Date.now() + opts.expiresDays * 86400000).toISOString()
    : null;

  // Scope lookup: session keys are per-thread; project/global share a brand-wide key. In più la
  // chiave è per agente (indice unico in 0212): Content e Motion possono avere `caption_rules`
  // ciascuno il suo senza che il secondo rinforzi la nota del primo.
  let existingQuery = supabase
    .from('brand_memory')
    .select('id, confidence, times_reinforced, value')
    .eq('brand_id', brandId)
    .eq('key', opts.key);
  existingQuery = agent ? existingQuery.eq('agent', agent) : existingQuery.is('agent', null);

  if (layer === 'session') {
    existingQuery = existingQuery.eq('layer', 'session').eq('thread_id', opts.threadId!);
  } else {
    existingQuery = existingQuery.neq('layer', 'session');
  }

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) {
    // Reinforce: bump confidence (capped at 1.0) and counter
    const newConfidence = Math.min(1.0, Math.max(existing.confidence as number, confidence) + 0.05);
    const newReinforced = (existing.times_reinforced as number) + 1;

    const update: AnyRec = {
      value: opts.value,
      confidence: newConfidence,
      times_reinforced: newReinforced,
      last_reinforced_at: new Date().toISOString(),
      source,
      layer,
      updated_at: new Date().toISOString()
    };
    if (layer === 'session') update.thread_id = opts.threadId;
    if (expiresAt) update.expires_at = expiresAt;

    await supabase.from('brand_memory').update(update).eq('id', existing.id);
    return { id: existing.id as string, reinforced: true };
  }

  // New entry — skills are capped: each one costs a line in every prompt this brand ever sends.
  if (opts.category === 'skill') {
    const { count } = await supabase
      .from('brand_memory')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('category', 'skill');
    if ((count ?? 0) >= MAX_SKILLS_PER_BRAND) {
      throw new Error(`skill_limit_reached: max ${MAX_SKILLS_PER_BRAND} skills per brand`);
    }
  }

  const insert: AnyRec = {
    brand_id: brandId,
    layer,
    agent,
    category: opts.category,
    key: opts.key,
    value: opts.value,
    source,
    confidence,
    times_reinforced: 0,
    times_used: 0,
    last_reinforced_at: new Date().toISOString(),
    importance: Math.min(5, Math.max(1, Math.round(opts.importance ?? 3))),
    ...(opts.pinned ? { pinned: true } : {})
  };
  if (layer === 'session') insert.thread_id = opts.threadId;
  if (expiresAt) insert.expires_at = expiresAt;

  const { data: created, error } = await supabase
    .from('brand_memory')
    .insert(insert)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[writeMemory]', error.message);
    throw error;
  }

  return { id: created?.id as string, reinforced: false };
}

/**
 * Promote a session memory into project (brand) knowledge.
 * If a project entry with the same key already exists, reinforce it and delete the session row.
 */
export async function promoteMemoryToProject(
  supabase: SupabaseClient,
  brandId: string,
  entryId: string,
  promotedBy?: string | null
): Promise<{ id: string; merged: boolean }> {
  const { data: entry } = await supabase
    .from('brand_memory')
    .select('*')
    .eq('id', entryId)
    .eq('brand_id', brandId)
    .maybeSingle();

  if (!entry) throw new Error('Memory not found');
  if (entry.layer !== 'session') {
    return { id: entry.id as string, merged: false };
  }

  // La promozione non cambia proprietario: una nota di mestiere di Motion resta di Motion anche
  // quando smette di essere legata al thread.
  let projectQuery = supabase
    .from('brand_memory')
    .select('id, confidence, times_reinforced')
    .eq('brand_id', brandId)
    .eq('key', entry.key)
    .neq('layer', 'session');
  projectQuery = entry.agent
    ? projectQuery.eq('agent', entry.agent)
    : projectQuery.is('agent', null);
  const { data: projectExisting } = await projectQuery.maybeSingle();

  const now = new Date().toISOString();

  if (projectExisting) {
    const newConfidence = Math.min(
      1.0,
      Math.max(projectExisting.confidence as number, entry.confidence as number) + 0.05
    );
    await supabase
      .from('brand_memory')
      .update({
        value: entry.value,
        confidence: newConfidence,
        times_reinforced: (projectExisting.times_reinforced as number) + 1,
        last_reinforced_at: now,
        updated_at: now
      })
      .eq('id', projectExisting.id);
    await supabase.from('brand_memory').delete().eq('id', entryId);
    return { id: projectExisting.id as string, merged: true };
  }

  await supabase
    .from('brand_memory')
    .update({
      layer: 'project',
      thread_id: null,
      promoted_at: now,
      promoted_by: promotedBy ?? null,
      updated_at: now
    })
    .eq('id', entryId);

  return { id: entryId, merged: false };
}

// ── Delete / archive ───────────────────────────────────────────────────────────

// brandId is required, not optional: these run under the service-role client on the CLI path, where
// an id alone would reach any brand's memory.
export async function deleteMemory(supabase: SupabaseClient, brandId: string, entryId: string): Promise<void> {
  await supabase.from('brand_memory').delete().eq('id', entryId).eq('brand_id', brandId);
}

export async function updateMemoryEntry(
  supabase: SupabaseClient,
  brandId: string,
  entryId: string,
  patch: Partial<Pick<MemoryEntry, 'value' | 'category' | 'confidence' | 'pinned' | 'importance'>>
): Promise<void> {
  await supabase.from('brand_memory')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', entryId).eq('brand_id', brandId);
}

// ── Conflict detection ─────────────────────────────────────────────────────────

export type MemoryConflict = {
  key: string;
  existing: { value: string; source: string; confidence: number };
  incoming: { value: string; source: string };
};

/**
 * Check if a proposed memory entry conflicts with existing entries.
 * Returns the conflict if one exists, null otherwise.
 */
export async function detectConflict(
  supabase: SupabaseClient,
  brandId: string,
  key: string,
  newValue: string
): Promise<MemoryConflict | null> {
  const { data: existing } = await supabase
    .from('brand_memory')
    .select('key, value, source, confidence')
    .eq('brand_id', brandId)
    .eq('key', key)
    .neq('layer', 'session')
    // Solo la memoria del brand: da quando la stessa chiave può esistere anche sotto un agente
    // (0212), senza questo filtro maybeSingle troverebbe due righe e romperebbe l'ingest dei
    // documenti — che è l'unico chiamante, e scrive proprio memoria di brand.
    .is('agent', null)
    .maybeSingle();

  if (!existing) return null;

  const existingVal = (existing.value as string).toLowerCase().trim();
  const incomingVal = newValue.toLowerCase().trim();

  // Same value = reinforcement, not conflict
  if (existingVal === incomingVal) return null;

  // Simple heuristic: if one contains the other, it's an update not a conflict
  if (existingVal.includes(incomingVal) || incomingVal.includes(existingVal)) return null;

  return {
    key,
    existing: { value: existing.value as string, source: existing.source as string, confidence: existing.confidence as number },
    incoming: { value: newValue, source: 'incoming' }
  };
}

// ── Auto-extraction from chat ──────────────────────────────────────────────────

/**
 * Extract memory-worthy facts from a chat conversation.
 * Called after each chat turn completes. Writes to **session** layer when threadId is set
 * (default), so chat chatter does not pollute permanent brand knowledge.
 * Returns the number of entries written.
 */
export async function extractMemoryFromChat(
  supabase: SupabaseClient,
  brandId: string,
  userMessage: string,
  assistantResponse: string,
  opts?: { threadId?: string; messageId?: string }
): Promise<number> {
  // Only extract if the conversation is substantive
  if (userMessage.length < 10 && assistantResponse.length < 20) return 0;

  const threadId = opts?.threadId;
  // Without a thread we refuse to write session memory (CHECK constraint); skip rather than
  // falling back to project — that was the bug this phase fixes.
  if (!threadId) return 0;

  const { genaiClient } = await import('$lib/server/brand-context');
  const ai = genaiClient();

  // Load existing memory keys (project + this session) to avoid re-extracting known facts
  const { data: existing } = await supabase
    .from('brand_memory')
    .select('key, value, layer, thread_id')
    .eq('brand_id', brandId);

  const existingKeys = (existing ?? [])
    .filter((e) => e.layer !== 'session' || e.thread_id === threadId)
    .map((e) => `${e.key}: ${e.value}`)
    .join('\n');

  const prompt = `You are a memory extraction system. Analyze this conversation and extract facts worth remembering about the brand.

CONVERSATION:
User: ${userMessage.slice(0, 1500)}
Assistant: ${assistantResponse.slice(0, 1500)}

EXISTING MEMORY (avoid duplicates):
${existingKeys || '(empty)'}

Extract NEW facts only. For each fact, output a JSON object with:
- key: a short snake_case identifier (e.g. "dietary_restriction", "brand_tone")
- value: the fact in one sentence
- category: one of "voice", "constraint", "fact", "preference", "insight"
- confidence: 0.0-1.0 (how certain this fact is)

Rules:
- Only extract facts that would be useful for future content planning, research, or brand management
- Skip vague or temporary statements ("I'm thinking about maybe...")
- If this turn CONFIRMS or repeats something already in EXISTING MEMORY, output it again with the EXACT SAME key (and the same meaning) — repetition is how we learn that a fact matters. Only leave it out when this turn says nothing about it.
- If nothing worth extracting, return an empty array
- Return a JSON array, nothing else`;

  try {
    const raw = await structured<unknown>(ai, prompt, {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              key: { type: 'string' as const },
              value: { type: 'string' as const },
              category: { type: 'string' as const, enum: ['voice', 'constraint', 'fact', 'preference', 'insight'] as const },
              confidence: { type: 'number' as const }
            },
            required: ['key', 'value', 'category', 'confidence']
          }
    }, undefined, { label: 'memoryExtract' });

    const extracted = (Array.isArray(raw) ? raw : []) as Array<{
      key: string;
      value: string;
      category: MemoryCategory;
      confidence: number;
    }>;

    let count = 0;
    for (const item of extracted) {
      if (!item.key || !item.value || !item.category) continue;
      if (item.confidence < 0.5) continue;

      const written = await writeMemory(supabase, brandId, {
        key: item.key,
        value: item.value,
        category: item.category,
        confidence: item.confidence,
        source: 'chat',
        layer: 'session',
        threadId
      });

      if (opts?.messageId && written.id) {
        await supabase.from('brand_knowledge_edges').upsert(
          {
            brand_id: brandId,
            src_kind: 'memory',
            src_id: written.id,
            dst_kind: 'chat_message',
            dst_id: opts.messageId,
            rel: 'derived_from',
            confidence: item.confidence,
            created_by: 'system'
          },
          { onConflict: 'brand_id,src_kind,src_id,dst_kind,dst_id,rel', ignoreDuplicates: true }
        );
      }
      count++;
    }

    return count;
  } catch (e) {
    console.error('Memory extraction failed:', e);
    return 0;
  }
}

// ── Learning from user caption edits ────────────────────────────────────────────

/**
 * The user EDITED an AI-written caption before approving it. That diff is the purest voice signal
 * the brand ever gives us — far stronger than any inferred style — so extract GENERALIZABLE
 * writing rules from it ("shortens captions", "removes emoji", "never uses formal address") and
 * persist them as high-confidence user memories. They flow into every future prompt via
 * enrichProfileWithMemory/buildMemoryContext, which is how Anomalia gets better week after week
 * instead of staying frozen. Fire-and-forget by design: never throws, returns entries written.
 */
export async function learnFromCaptionEdit(
  supabase: SupabaseClient,
  brandId: string,
  original: string | null | undefined,
  edited: string | null | undefined
): Promise<number> {
  const a = String(original ?? '').trim();
  const b = String(edited ?? '').trim();
  // Only meaningful rewrites teach anything: skip no-ops, deletions and tiny captions.
  if (!a || !b || a === b || b.length < 10) return 0;

  try {
    const { genaiClient } = await import('$lib/server/brand-context');
    const ai = genaiClient();

    const { data: existing } = await supabase
      .from('brand_memory')
      .select('key, value')
      .eq('brand_id', brandId)
      .in('category', ['voice', 'preference', 'constraint']);
    const existingKeys = (existing ?? []).map((e) => `${e.key}: ${e.value}`).join('\n');

    const prompt = `A brand owner EDITED the social caption an AI copywriter wrote, before approving it. Compare the two versions and extract the GENERALIZABLE writing rules the AI should follow next time — style, length, tone, register, emoji/hashtag usage, wording the user prefers or removes.

AI WROTE:
${a.slice(0, 1200)}

USER SHIPPED:
${b.slice(0, 1200)}

EXISTING MEMORY (reuse the SAME key to reinforce a rule instead of duplicating it):
${existingKeys || '(empty)'}

Rules:
- Extract only rules that generalize to FUTURE captions — never facts about this specific post (dates, product names, one-off wording).
- 0-3 entries max. If the edit is only a typo/date/detail fix, return an empty array.
- Each entry: key (short snake_case, stable across similar edits, e.g. "caption_length", "emoji_usage"), value (one imperative sentence, e.g. "Keep captions under ~3 short sentences"), category ("voice" | "preference" | "constraint"), confidence 0.0-1.0.
Return a JSON array, nothing else.`;

    const raw = await structured<unknown>(ai, prompt, {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              key: { type: 'string' as const },
              value: { type: 'string' as const },
              category: { type: 'string' as const, enum: ['voice', 'preference', 'constraint'] as const },
              confidence: { type: 'number' as const }
            },
            required: ['key', 'value', 'category', 'confidence']
          }
    }, undefined, { label: 'memoryExtract' });

    const extracted = (Array.isArray(raw) ? raw : []) as Array<{
      key: string;
      value: string;
      category: MemoryCategory;
      confidence: number;
    }>;

    let count = 0;
    for (const item of extracted.slice(0, 3)) {
      if (!item.key || !item.value) continue;
      if ((item.confidence ?? 0) < 0.5) continue;
      await writeMemory(supabase, brandId, {
        key: item.key,
        value: item.value,
        category: item.category,
        // User edits are the strongest signal we have — floor the confidence high.
        confidence: Math.max(0.8, Math.min(1, item.confidence ?? 0.8)),
        source: 'user',
        layer: 'project'
      });
      count++;
    }
    return count;
  } catch (e) {
    console.error('learnFromCaptionEdit failed:', e);
    return 0;
  }
}

// ── Dream: weekly maintenance ──────────────────────────────────────────────────

/**
 * Quante SCRITTURE (decay + archiviazione + promozione) un solo giro può fare su un brand.
 * Non è una quota di prudenza generica: è ciò che spalma un arretrato su più notti invece di
 * farlo succedere tutto insieme la prima volta che il cron parte.
 * ponytail: tetto globale, non per tipo di scrittura — basta finché un brand sta sotto le
 * centinaia di righe; se un giorno serve proteggere le cancellazioni a parte, si sdoppia.
 */
export const DREAM_MAX_WRITES_PER_BRAND = 100;

export type DreamResult = {
  decayed: number;
  promoted: number;
  archived: number;
  skills: number;
  orphans: number;
  /** Chiamate AI di sintesi skill fatte (o, in prova, che sarebbero partite). */
  aiCalls: number;
  /** Le chiavi cancellate, per nome: è l'unica traccia che resta di una riga sparita. */
  archivedKeys: string[];
  /** true = il tetto per giro ha fermato il lavoro, il resto tocca alla notte dopo. */
  capped: boolean;
};

/**
 * Dream: manutenzione della memoria. Decade le voci ferme, archivia quelle morte, promuove a
 * patrimonio del brand ciò che una conversazione ha imparato, sintetizza le skill.
 *
 * `dryRun` esegue esattamente le stesse decisioni senza scrivere né cancellare né chiamare l'AI:
 * è il modo di guardare cosa farebbe un giro prima di lasciarglielo fare.
 */
export async function runDream(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { dryRun?: boolean }
): Promise<DreamResult> {
  // Credits: called from the memory/dream cron outside any request scope.
  return withBrandContext(brandId, () => runDreamInner(supabase, brandId, opts?.dryRun ?? false));
}

async function runDreamInner(
  supabase: SupabaseClient,
  brandId: string,
  dryRun: boolean
): Promise<DreamResult> {
  const now = new Date();
  let decayed = 0;
  let promoted = 0;
  let archived = 0;
  let orphans = 0;
  let writes = 0;
  let capped = false;
  const archivedKeys: string[] = [];

  // updated_at crescente: ogni riga toccata va in fondo alla coda, quindi il tetto per giro
  // ruota fra le righe invece di ripassare sempre le stesse.
  const { data: entries } = await supabase
    .from('brand_memory')
    .select('*')
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: true });

  if (entries?.length) {
    for (const entry of entries as MemoryEntry[]) {
      if (writes >= DREAM_MAX_WRITES_PER_BRAND) {
        capped = true;
        break;
      }
      // Prefer last_used_at when present so unused memories decay even if old-but-reinforced.
      const lastTouch = entry.last_used_at
        ? new Date(entry.last_used_at)
        : entry.last_reinforced_at
          ? new Date(entry.last_reinforced_at)
          : new Date(entry.created_at);
      const daysSince = (now.getTime() - lastTouch.getTime()) / 86400000;

      if (!entry.pinned && daysSince > 30 && entry.confidence > 0.3) {
        const decay = Math.max(0.3, entry.confidence - 0.1);
        if (!dryRun) {
          await supabase
            .from('brand_memory')
            .update({
              confidence: decay,
              updated_at: now.toISOString()
            })
            .eq('id', entry.id);
        }
        decayed++;
        writes++;
      }

      // Pinned = the user's explicit "never forget this". Decay already skips them; archiving must
      // too, otherwise a pinned entry that arrived with low confidence gets silently deleted.
      // Skills are never auto-deleted either: a hand-written procedure is real work, and decay
      // already retires an unused one by dropping it under the 0.4 injection floor. Only the user
      // deletes a skill.
      //
      // `times_used > 0` è il terzo scudo, ed è quello che mancava: una riga con times_used = 0 non
      // è mai finita in un prompt, quindi non ha mai avuto modo di rendersi utile. Spesso non è
      // colpa sua — buildMemoryContext taglia sul budget di 800 token e la ordina per confidence,
      // così una riga sotto il taglio decade, scende ancora, e non risale mai più. Cancellarla
      // sarebbe punirla per una selezione che non ha mai visto. Decade fino al pavimento di 0.3 e
      // lì resta, sotto la soglia di iniezione: costa una riga, non una perdita.
      // Una scadenza esplicita (`expires_at`) invece vale sempre: chi l'ha scritta ha già deciso.
      const expired = !!entry.expires_at && new Date(entry.expires_at) < now;
      if (
        !entry.pinned &&
        entry.category !== 'skill' &&
        (expired || (entry.confidence <= 0.3 && (entry.times_used ?? 0) > 0))
      ) {
        if (!dryRun) await supabase.from('brand_memory').delete().eq('id', entry.id);
        archived++;
        writes++;
        archivedKeys.push(entry.key);
        continue;
      }

      if (entry.layer === 'session' && entry.times_reinforced >= 3) {
        try {
          if (!dryRun) await promoteMemoryToProject(supabase, brandId, entry.id as string);
          promoted++;
          writes++;
        } catch (e) {
          console.error('[runDream] promote session→project', e);
        }
      }
    }
  }

  // Orphan edge cleanup (polymorphic nodes — no FK).
  const { data: edges } = await supabase
    .from('brand_knowledge_edges')
    .select('id, src_kind, src_id, dst_kind, dst_id, weight')
    .eq('brand_id', brandId)
    .limit(500);

  for (const e of edges ?? []) {
    const srcOk = await nodeExists(supabase, brandId, e.src_kind as string, e.src_id as string);
    const dstOk = await nodeExists(supabase, brandId, e.dst_kind as string, e.dst_id as string);
    if (!srcOk || !dstOk) {
      if (!dryRun) await supabase.from('brand_knowledge_edges').delete().eq('id', e.id);
      orphans++;
      continue;
    }
    // Soft decay for never-traversed edges (weight only).
    if (!dryRun && (e.weight as number) > 0.2) {
      await supabase
        .from('brand_knowledge_edges')
        .update({ weight: Math.max(0.2, (e.weight as number) * 0.98) })
        .eq('id', e.id);
    }
  }

  const synth = await synthesizeSkills(supabase, brandId, now, dryRun);

  return {
    decayed,
    promoted,
    archived,
    skills: synth.written,
    orphans,
    aiCalls: synth.called ? 1 : 0,
    archivedKeys,
    capped
  };
}

// ── Skill synthesis: the AI writing its own procedures ─────────────────────────

const NO_SKILLS = { written: 0, called: false } as const;
/** A pattern needs at least this many separate lessons behind it before it becomes a skill. */
const SKILL_SYNTHESIS_MIN_SIGNALS = 3;
/** Only lessons reinforced this recently count as "new learning" worth re-synthesizing on. */
const SKILL_SYNTHESIS_WINDOW_DAYS = 7;

/**
 * Promote repetition into procedure. The memory layer already collects one-line lessons from every
 * chat turn and every caption the user rewrote; individually they are trivia, but three of them
 * pointing at the same recurring move ("cut the intro", "no emoji in the hook", "CTA last line")
 * are really one operating procedure nobody has written down.
 *
 * Gated on fresh reinforcement so it costs one AI call only when the brand actually learned
 * something this week — most weeks it returns 0 without calling anything.
 */
async function synthesizeSkills(
  supabase: SupabaseClient,
  brandId: string,
  now: Date,
  dryRun: boolean
): Promise<{ written: number; called: boolean }> {
  try {
    const { data: existingSkills } = await supabase
      .from('brand_memory')
      .select('key, value')
      .eq('brand_id', brandId)
      .eq('category', 'skill');

    const slots = MAX_SKILLS_PER_BRAND - (existingSkills?.length ?? 0);
    if (slots <= 0) return NO_SKILLS;

    const { data: rows } = await supabase
      .from('brand_memory')
      .select('key, value, category, times_reinforced, last_reinforced_at')
      .eq('brand_id', brandId)
      .neq('layer', 'session')
      .in('category', ['insight', 'preference', 'constraint', 'voice'])
      .gte('confidence', 0.5)
      .order('times_reinforced', { ascending: false })
      .limit(80);

    const signals = rows ?? [];
    if (signals.length < SKILL_SYNTHESIS_MIN_SIGNALS) return NO_SKILLS;

    const cutoff = now.getTime() - SKILL_SYNTHESIS_WINDOW_DAYS * 86400000;
    const fresh = signals.filter(
      (s) => s.last_reinforced_at && new Date(s.last_reinforced_at as string).getTime() >= cutoff
    );
    if (!fresh.length) return NO_SKILLS;

    // Prova: qui sarebbe partita la chiamata AI. Contarla senza farla è il punto della modalità.
    if (dryRun) return { written: 0, called: true };

    const { genaiClient } = await import('$lib/server/brand-context');
    const ai = genaiClient();

    const prompt = `You maintain the operating procedures ("skills") of a brand's AI assistant.

LESSONS LEARNED SO FAR (each was extracted from a real conversation or a caption the user rewrote):
${signals.map((s) => `- [${s.category}] ${s.key}: ${s.value}`).join('\n')}

SKILLS THAT ALREADY EXIST (do not restate these):
${(existingSkills ?? []).map((s) => `- ${s.key}: ${skillTrigger(String(s.value ?? ''))}`).join('\n') || '(none)'}

Write a new skill ONLY when at least ${SKILL_SYNTHESIS_MIN_SIGNALS} of the lessons above describe the SAME recurring way of working. A skill is a procedure, not a fact: if it cannot be written as steps somebody could follow, it is not a skill and must be skipped.

For each skill:
- key: short snake_case identifier (e.g. "caption_rewrite_rules")
- body: markdown. The FIRST LINE must be a single sentence saying when to use it, starting with "Use when". The lines after it are the steps, one per line, concrete enough to follow without re-reading the lessons. Keep the whole body under 1200 characters.

Return at most ${Math.min(slots, 3)} skills. If no clear repeated procedure exists, return an empty array — that is the normal answer.`;

    const raw = await structured<unknown>(
      ai,
      prompt,
      {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            key: { type: 'string' as const },
            body: { type: 'string' as const }
          },
          required: ['key', 'body']
        }
      },
      undefined,
      { label: 'skillSynthesis' }
    );

    const proposed = (Array.isArray(raw) ? raw : []) as Array<{ key: string; body: string }>;
    let written = 0;
    for (const item of proposed) {
      if (written >= slots) break;
      if (!item.key?.trim() || !item.body?.trim()) continue;
      // Derived from a pattern, not stated by the user: below the 0.9 a chat-confirmed rule gets,
      // above the 0.4 injection floor, so it starts live but retires on its own if never used.
      await writeMemory(supabase, brandId, {
        key: item.key.trim(),
        value: item.body.trim().slice(0, 1500),
        category: 'skill',
        source: 'analysis',
        confidence: 0.7
      });
      written++;
    }
    return { written, called: true };
  } catch (e) {
    // Maintenance must never fail on the optional step — decay and promotion already ran.
    console.error('[runDream] synthesizeSkills', e);
    return NO_SKILLS;
  }
}

async function nodeExists(
  supabase: SupabaseClient,
  brandId: string,
  kind: string,
  id: string
): Promise<boolean> {
  const table =
    kind === 'memory'
      ? 'brand_memory'
      : kind === 'document'
        ? 'brand_documents'
        : kind === 'chunk'
          ? 'brand_doc_chunks'
          : kind === 'chat_message'
            ? 'chat_messages'
            : kind === 'product'
              ? 'products'
              : kind === 'competitor'
                ? 'competitors'
                : kind === 'person'
                  ? 'people'
                  : kind === 'post'
                    ? 'posts'
                    : kind === 'rubric'
                      ? 'rubrics'
                      : null;
  if (!table) return false;
  const { data } = await supabase.from(table).select('id').eq('id', id).eq('brand_id', brandId).maybeSingle();
  return !!data;
}

// ── Migration helper: seed from existing ai_context ────────────────────────────

// ── Research integration: persist strategy findings to memory ──────────────────

/**
 * Write key findings from a competitor research / strategy report to memory.
 * Called after the onboarding research pipeline and after chat-triggered competitor discovery.
 */
export async function writeResearchToMemory(
  supabase: SupabaseClient,
  brandId: string,
  report: {
    differentiators?: string[];
    whiteSpace?: string[];
    threats?: string[];
    recommendedAngles?: string[];
    summary?: string;
  }
): Promise<number> {
  let count = 0;

  if (report.differentiators?.length) {
    await writeMemory(supabase, brandId, {
      key: 'brand_differentiators',
      value: `Brand differentiators: ${report.differentiators.join('; ')}`,
      category: 'insight',
      confidence: 0.8,
      source: 'research'
    });
    count++;
  }

  if (report.whiteSpace?.length) {
    await writeMemory(supabase, brandId, {
      key: 'market_white_space',
      value: `White space opportunities: ${report.whiteSpace.join('; ')}`,
      category: 'insight',
      confidence: 0.7,
      source: 'research'
    });
    count++;
  }

  if (report.threats?.length) {
    await writeMemory(supabase, brandId, {
      key: 'competitive_threats',
      value: `Competitive threats to avoid: ${report.threats.join('; ')}`,
      category: 'constraint',
      confidence: 0.7,
      source: 'research'
    });
    count++;
  }

  if (report.recommendedAngles?.length) {
    await writeMemory(supabase, brandId, {
      key: 'recommended_content_angles',
      value: `Recommended content angles: ${report.recommendedAngles.join('; ')}`,
      category: 'preference',
      confidence: 0.7,
      source: 'research'
    });
    count++;
  }

  if (report.summary) {
    await writeMemory(supabase, brandId, {
      key: 'strategy_summary',
      value: report.summary,
      category: 'fact',
      confidence: 0.7,
      source: 'research'
    });
    count++;
  }

  return count;
}
