export type ChatMode = 'agent' | 'plan' | 'ask';

export const CHAT_MODES: ChatMode[] = ['agent', 'plan', 'ask'];

const ASK_TOOLS = new Set([
  'read_brand_kit',
  'read_strategy',
  'read_seo_geo_audit',
  'read_seo_plan',
  'read_editorial_plan',
  'read_posts',
  'read_products',
  'read_people',
  'read_competitors',
  'read_documents',
  'search_knowledge',
  'read_document',
  'list_integrations_tools',
  'list_articles',
  'read_article',
  'read_memory',
  'show_media',
  'show_setup_checklist',
  'grep_attachment',
  'read_attachment',
  'summarize_attachment',
  'propose_open_tab',
  // Sta anche in ASK perché "puoi accedere a Google Calendar?" è esattamente una domanda da modalità
  // Ask, e la risposta giusta è una card. Non scrive niente: propone, e chi autorizza è la persona.
  'propose_app_connection',
  'check_job_status',
  'offer_upgrade',
  'ask_user_questions'
]);

const PLAN_TOOLS = new Set([
  ...ASK_TOOLS,
  'propose_plan',
  'generate_strategy',
  'generate_editorial_plan',
  'update_editorial_plan',
  'update_gtm_plan',
  'update_voice',
  'update_brand_kit',
  'discover_competitors',
  'reanalyze_brand',
  'run_seo_geo_audit',
  'generate_seo_plan',
  'add_seo_initiatives',
  'analyze_post_people',
  'sync_social_history',
  'add_memory',
  'remove_memory',
  'extract_colors',
  'update_brand_colors',
  'update_logo',
  'add_document',
  'set_section_status',
  'call_integrations_tools',
  // Anche in Plan si lanciano lavori lunghi (strategia, audit): se l'utente se ne va nel
  // frattempo, deve poterlo sapere. In Ask no — lì non parte niente che valga una mail.
  'notify_user',
  // L'obiettivo serve dove c'è un lavoro in più passi da portare a termine, e la modalità PLAN ne
  // ha eccome (strategia, piano editoriale, audit SEO). In ASK no: lì non c'è niente da chiudere,
  // e un obiettivo che nessun tool può far avanzare sarebbe un turno che riparte per niente.
  'set_goal',
  'update_goal',
  'close_goal'
]);

export function isChatMode(v: unknown): v is ChatMode {
  return v === 'agent' || v === 'plan' || v === 'ask';
}

/** Filter the full tool map for the selected chat mode. */
export function filterToolsForMode<T extends Record<string, unknown>>(tools: T, mode: ChatMode): Partial<T> {
  if (mode === 'agent') return tools;
  const allow = mode === 'ask' ? ASK_TOOLS : PLAN_TOOLS;
  return Object.fromEntries(Object.entries(tools).filter(([k]) => allow.has(k))) as Partial<T>;
}

/**
 * A big ask deserves a document, not eight screens of chat bubbles. Both modes that can write
 * get the same instruction, so the behaviour does not change when the user flips the switch.
 */
const PLAN_DOC_BLOCK = `
### BIG TASKS → propose_plan
When the user asks for something large or multi-step (a launch, a repositioning, a quarter of
content, a migration, a full audit), your DEFAULT is to call propose_plan with the whole plan as
markdown — not to type the plan into the chat. Say one or two lines in the chat, then let the card
carry the detail. Use headings, numbered phases, owners and deliverables. Keep writing inline only
for short answers and single-step actions.`;

const MODE_RULE: Record<ChatMode, string> = {
  agent: 'Full access — you may read, create, edit, approve, and run background jobs as usual.',
  plan: 'Focus on strategy, GTM, editorial planning, SEO plans, brand kit, and research. You may propose and update plans. Do NOT create/approve/publish posts, articles, campaigns, or media.',
  ask: 'Answer questions using read tools only. Do NOT create, update, delete, approve, or launch generation jobs. If the user asks you to change something, explain briefly and suggest switching to Agent or Plan mode.'
};

export function modeSystemBlock(mode: ChatMode, lang: 'Italian' | 'English'): string {
  if (mode === 'agent') {
    return `## CHAT MODE: AGENT
${MODE_RULE.agent}
Attached files this turn are converted to markdown. Small files are inlined; large files: summarize_attachment → grep_attachment → read_attachment. They are not knowledge until you save them with add_document (from_attachment = filename).
${PLAN_DOC_BLOCK}`;
  }
  if (mode === 'plan') {
    const body = `## CHAT MODE: PLAN (strategy)
${MODE_RULE.plan} Prefer propose_open_tab to send the user to review pages.
${PLAN_DOC_BLOCK}`;
    return body;
  }
  return lang === 'Italian'
    ? `## CHAT MODE: ASK (solo domande)\n${MODE_RULE.ask}`
    : `## CHAT MODE: ASK (questions only)\n${MODE_RULE.ask}`;
}

const MODE_RANK: Record<ChatMode, number> = { ask: 0, plan: 1, agent: 2 };

/**
 * Gli strumenti del kit che la modalità autorizza. Ognuno dichiara da sé la modalità minima
 * (`ToolSpec.requiresMode`), accanto alla propria descrizione: qui non c'è un secondo elenco di
 * nomi da tenere allineato.
 */
export function toolsForMode<T extends { requiresMode?: 'plan' | 'agent' }>(tools: T[], mode: ChatMode): T[] {
  return tools.filter((t) => MODE_RANK[t.requiresMode ?? 'ask'] <= MODE_RANK[mode]);
}

/** Il capitolo di modalità per un prompt che NON ha i tool del motore classico. */
export function modeBlock(mode: ChatMode): string {
  const heading = mode === 'agent' ? 'AGENT' : mode === 'plan' ? 'PLAN (strategy)' : 'ASK (questions only)';
  return `## CHAT MODE: ${heading}\n${MODE_RULE[mode]}`;
}
