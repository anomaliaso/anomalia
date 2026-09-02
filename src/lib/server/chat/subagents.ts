/**
 * SOTTO-AGENTI: la chat come orchestratore, non come esecutore unico.
 *
 * Senza, ogni lavoro lungo finisce in un solo loop: lo stesso agente legge, produce e si autovaluta
 * nella stessa finestra di contesto — la ricerca riempie il contesto che poi serve all'esecuzione, e
 * la verifica la fa chi ha appena dichiarato di aver finito.
 *
 * I ruoli sono i pezzi che vanno separati:
 *  - `research` — SOLO lettura. Il vincolo è ciò che rende il suo rapporto affidabile.
 *  - `execute`  — fa il lavoro con i tool del suo hub, e torna con cosa ha cambiato, id per id.
 *  - `verify`   — SOLO lettura: rilegge lo stato reale e dice pass/partial/fail con le prove.
 *  - `sandbox`  — una microVM sua: terminale, Node/Python, i dati del brand come file.
 *  - `compose`  — l'unico che si parallelizza, e si parallelizza PERCHÉ non scrive (vedi COMPOSE_EXTRA).
 *
 * Da cui i due modi di chiamarli in gruppo, che non sono intercambiabili: `run_task_pipeline` mette
 * in FILA ruoli diversi sullo stesso lavoro, `run_parallel_tasks` mette in PARALLELO lo stesso ruolo
 * su pezzi che non si conoscono fra loro.
 *
 * I VINCOLI, cioè perché questo file non è un wrapper di tre righe su generateText:
 * 1. NIENTE RICORSIONE: un sotto-agente non riceve mai i tool di delega — un albero di deleghe brucia
 *    il budget del turno prima di produrre qualcosa.
 * 2. NIENTE SCRITTURE DI STRAFORO: lo scope read-only è per prefisso su sole letture, e sopra passa
 *    comunque il filtro di modalità e di piano. Un sotto-agente non può fare ciò che l'orchestratore
 *    non poteva già fare.
 * 3. NIENTE BUCHI NERI DI BUDGET: tetto di dispatch per turno, di step per run. In chat la delega
 *    NON vive più dentro il turno (mode `queued`): accoda un job `subagent_run`, torna subito, e
 *    il risultato rientra come nuovo turno — come motion_write. Le superfici kit che leggono i
 *    verdetti in banda restano `inline`, dove la delega eredita l'abortSignal e non gli sopravvive.
 * 4. NESSUN AGENTE MUTO VERSO L'UTENTE: chi parla con la persona è uno solo.
 */
import { streamText, stepCountIs, tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_IDS, AGENTS, type AgentId } from '$lib/server/chat/agents';
import { buildSystemPrompt, buildTurnVolatileBlock, wrapTurnContext } from '$lib/server/chat/system-prompt';
import { type ChatModelResolved } from '$lib/server/chat/model';
import { extractSdkUsage, logAiCall } from '$lib/server/ai-log';
import { createSandboxTools, type SandboxSession } from '$lib/agent/tools/sandbox-tools';
import { chatSubAgentMaxTurns, SUB_AGENT_STEP_CEILING } from '$lib/server/chat/turn-limits';
import { isSandboxConfigured, type SandboxNetworkMode } from '$lib/server/sandbox';
import { createRecorder, saveAgentSession } from '$lib/server/agent-sessions';
import { startLongToolJob } from '$lib/agent/tools/shared';
import { createJobPartialMirror } from '$lib/server/chat/job-partial-mirror';
import {
  applyChatStreamEvent,
  emptyStreamState,
  toolsForMirror,
  type ChatStreamState
} from '$lib/chat-stream-events';

export const SUBAGENT_ROLES = ['research', 'execute', 'verify', 'sandbox', 'compose'] as const;
export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

/** I tre tool che questo file aggiunge alla chat. Vivono in SHARED_TOOL_KEYS: li ha ogni agente. */
export const SUBAGENT_TOOL_KEYS = ['delegate_task', 'run_task_pipeline', 'run_parallel_tasks', 'check_subagent'] as const;

/** Il tool_name della riga `chat_jobs` che porta una run di sub-agent fuori dal turno. */
export const SUBAGENT_JOB_TOOL = 'subagent_run';

/** Quante deleghe può fare un turno. Sopra questo, l'orchestratore finisce il lavoro da solo. */
export const MAX_SUBAGENT_RUNS = 50;

/** Un rapporto più lungo di così non è un rapporto: è il contesto che stavamo cercando di NON avere. */
const MAX_REPORT_CHARS = 8_000;

/**
 * Sola lettura per prefisso: vale su TUTTI i tool della chat, nessuno di quelli che iniziano così
 * scrive. Se un domani nascesse un `list_and_delete_*`, il posto dove metterlo è READ_ONLY_DENY qui
 * sotto, non un commento altrove.
 */
const READ_ONLY_PREFIXES = ['read_', 'list_', 'grep_', 'search_', 'dfs_', 'fetch_', 'summarize_', 'check_'];

/** Letture che non rispettano il prefisso ma sono osservazione pura. */
const READ_ONLY_EXTRA = new Set([
  'study_motion_reference',
  'research_meta_ads',
  'use_library_image',
  'get_billing_status',
  // Guarda una pagina: il PNG che lascia in libreria è il suo meccanismo, non un effetto sul brand.
  'capture_website',
    // GUARDARE NON È SCRIVERE: `render_stills` è l'unico modo di VEDERE la composizione (i tool sul
    // sorgente controllano la sintassi, non eseguono il codice) e non comincia per `read_`, quindi il
    // verificatore restava col TSX come testo e chiudeva «pass» senza modo di essere falso.
  'render_stills',
  // Le letture del motore kit (bridge/live.ts): stessi nomi diversi dal hub di chat, stessa natura.
  'brand_ls',
  'brand_read',
  'brand_grep',
  'query'
]);

/** Letture per prefisso che un sotto-agente non deve comunque avere. */
const READ_ONLY_DENY = new Set([
  // Il team ricorrente lo propone e lo crea l'orchestratore, davanti all'utente.
  'list_scheduled_agents',
  'show_setup_checklist'
]);

/**
 * IL RUOLO `compose`: N lavoratori sullo stesso oggetto, senza che si pestino i piedi.
 *
 * `execute` non si parallelizza: cinque esecutori sulla stessa sorgente fanno cinque scritture sullo
 * stesso file, l'ultimo vince e gli altri quattro hanno ricevuto «fatto» dal proprio tool. È il
 * classico lost update, e non si risolve con un prompt più severo.
 *
 * Quindi il ruolo che si parallelizza NON SCRIVE: consegna il proprio pezzo nel rapporto e il
 * montaggio lo fa l'orchestratore. Vincolo pratico: se due pezzi non possono essere scritti
 * indipendentemente, non sono due `compose`, sono un `execute`.
 *
 * Legge come un `research`, più le poche cose che gli servono per PRODURRE il pezzo invece che
 * descriverlo — nessuna delle quali tocca l'oggetto condiviso.
 */
const COMPOSE_EXTRA = new Set([
  'generate_image',
  'use_library_image',
  'search_motion_references',
  'study_motion_reference',
  'capture_website',
  'harvest_product_ui'
]);

/**
 * Mai, per nessun ruolo: interazione con l'utente (parla uno solo), gestione del team ricorrente
 * (è un atto esplicito della persona), e le deleghe stesse (niente ricorsione).
 */
const NEVER_FOR_SUBAGENTS = new Set<string>([
  ...SUBAGENT_TOOL_KEYS,
  'ask_user_questions',
  'propose_open_tab',
  // Lo sticker è un gesto verso la persona: chi parla con lei è uno solo.
  'set_expression',
    // I TERMINALI DEL KIT (`reply`/`ask_user`) e il suo `plan`: chiudevano il turno di CHI L'HA
    // CHIAMATO o parlavano all'utente dalla bocca sbagliata. Nel kit l'executor li tratta da
    // no-op, quindi qui si toglie la tentazione alla radice.
  'reply',
  'ask_user',
  'plan',
    // `finish` chiude il loop di CHI L'HA CHIAMATO: un delegato che lo trova si autolicenzia e, peggio,
    // dichiara concluso il lavoro dell'orchestratore.
  'finish',
  // Il titolo dell'oggetto è dell'orchestratore: cinque lavoratori su cinque scene lo
  // riscriverebbero cinque volte, ognuno con il nome della propria scena.
  'set_title',
    // Email a tutto il progetto + push: una pipeline da tre fasi busserebbe tre volte per lo stesso
    // lavoro. Notifica chi ha parlato con l'utente.
  'notify_user',
    // Stessa ragione: un worker con un brief parziale non sa cosa il capo ha già detto in chat. I
    // delegati riferiscono nel report. (`read_notifications` resta: è una lettura come le altre.)
  'set_notification',
  'offer_upgrade',
    // Aprire un link OAuth è un gesto verso la persona: la card la propone chi le parla.
  'propose_app_connection',
    // Stessa ragione, più un dettaglio: il gate vero è il flag `deviceLogin` di `createSandboxTools`
    // (i sandbox tool dei delegati si montano DOPO questo filtro). La voce qui copre chi un giorno
    // montasse il tool per un'altra via.
  'sandbox_device_login',
  'propose_plan',
  'show_setup_checklist',
  'set_section_status',
  'suggest_agent_team',
  'propose_custom_agent',
  'create_scheduled_agent',
  'update_scheduled_agent',
  'set_scheduled_agent_enabled',
  'list_scheduled_agents',
    // L'obiettivo è del capo: un delegato ha un brief e un giro solo, e chiuderebbe il lavoro di
    // qualcun altro con la propria idea di «fatto».
  'set_goal',
  'update_goal',
  'close_goal',
  // La memoria di progetto la scrive chi ha parlato con l'utente, non un worker.
  'add_memory',
  'remove_memory',
    // L'IDENTITÀ DEL BRAND non è una scrittura come le altre: un post sbagliato è un post sbagliato,
    // un logo o una palette re-skinnano TUTTO quello che verrà generato dopo e nessun render
    // successivo fallisce — escono coi colori di qualcun altro, e chi lo scopre è il cliente del
    // cliente.
    //
    // Qui e non dietro una scheda di conferma: il logo lo cambia una persona che ha appena scritto
    // «mettimi questo logo», e a forza di schede si smette di leggerle. Il caso pericoloso è
    // l'opposto — la scrittura d'identità che NESSUNO ha chiesto, decisa tre livelli sotto. Chi parla
    // con l'utente li ha ancora tutti, e ogni scrittura torna indietro col valore di prima.
  'update_logo',
  'update_brand_colors',
  'extract_colors',
  // Il DM fra agenti, per la stessa ragione ma peggio: un worker delegato che apre canali privati
  // accoda turni interi a nome di qualcun altro — chi parla (anche fra agenti) è uno solo.
  'message_agent',
  // Stessa regola, ancora più netta: una sessione con l'utente è un posto dove parla una persona,
  // e un delegato tre livelli sotto non ha titolo per aprirne una né per parlarci.
  'open_session_with_user',
  // Stessa regola: una stanza è un posto dove l'utente parla con degli agenti, e un delegato tre
  // livelli sotto non ha titolo per aprirne una — men che meno per metterci dentro chi vuole.
  'create_group_chat'
]);

export function isReadOnlyToolName(name: string): boolean {
  if (READ_ONLY_DENY.has(name)) return false;
  if (READ_ONLY_EXTRA.has(name)) return true;
  return READ_ONLY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Quali tool vede un sotto-agente, dato ruolo e hub. `available` sono i tool che l'ORCHESTRATORE
 * poteva già usare in questo turno: un sotto-agente non apre mai una porta che era chiusa. In
 * `execute` si restringe all'hub scelto, così il worker ha il set di un solo mestiere.
 */
export function subagentToolNames(
  role: SubagentRole,
  agent: AgentId | null,
  available: string[],
    /**
     * Sostituisce `AGENTS[agent].toolKeys` come perimetro di scrittura dell'`execute`, per le
     * superfici che NON sono un hub di chat: la pagina Motion ha i suoi nomi (`replace_source`), e lo
     * scope per hub la taglierebbe fuori da ogni scrittura.
     */
  hubToolKeys?: string[]
): string[] {
    // `hubToolKeys?.length`, non `hubToolKeys`: un array vuoto è truthy e significherebbe «perimetro
    // di scrittura vuoto», cioè un `execute` senza un tool per eseguire.
  const scopeKeys = hubToolKeys?.length ? hubToolKeys : agent ? AGENTS[agent].toolKeys : null;
  const writeScope =
    role === 'execute' && scopeKeys ? new Set<string>([...scopeKeys, ...READ_ONLY_EXTRA]) : null;

  return available.filter((name) => {
    if (NEVER_FOR_SUBAGENTS.has(name)) return false;
      // compose: legge come research, più i pochi tool che gli servono per produrre il proprio pezzo.
    if (role === 'compose') return isReadOnlyToolName(name) || COMPOSE_EXTRA.has(name);
      // sandbox: sul brand è in sola lettura come research — quello che può cambiare è dentro la sua
      // VM, e la VM non è il brand. I suoi tool si aggiungono a run time, non stanno in `available`.
    if (role !== 'execute') return isReadOnlyToolName(name);
    // execute: scrive nel suo perimetro, ma legge ovunque (i read_* restano trasversali come in chat).
    if (isReadOnlyToolName(name)) return true;
    return writeScope ? writeScope.has(name) : true;
  });
}

function pickByName<T extends Record<string, unknown>>(tools: T, names: string[]): Partial<T> {
  const keep = new Set(names);
  return Object.fromEntries(Object.entries(tools).filter(([k]) => keep.has(k))) as Partial<T>;
}

/** pass / partial / fail dal rapporto del verificatore, senza obbligare il modello a fare JSON. */
export function parseVerdict(report: string): 'pass' | 'partial' | 'fail' | 'unknown' {
  const m = /^\s*(?:\*\*)?verdict(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(pass|partial|fail)\b/im.exec(report);
  return (m?.[1]?.toLowerCase() as 'pass' | 'partial' | 'fail') ?? 'unknown';
}

function clampReport(text: string): { report: string; truncated: boolean } {
  const t = (text ?? '').trim();
  if (t.length <= MAX_REPORT_CHARS) return { report: t, truncated: false };
  return { report: `${t.slice(0, MAX_REPORT_CHARS)}\n…[rapporto troncato]`, truncated: true };
}

const ROLE_CONTRACT: Record<SubagentRole, string> = {
  research: `You are a RESEARCH sub-agent. You were dispatched by the orchestrating agent, not by the user.
- You have READ tools only. You cannot create, update, approve or generate anything — and you must not claim you did.
- Gather the facts that answer the brief. Prefer real tool reads over what you already believe from the context pack.
- Reply ONCE, as a compact report for another agent (not for the end user), in this shape:
  FINDINGS — bullets, each with the concrete evidence (ids, numbers, urls, exact field values).
  GAPS — what you could NOT establish, and which tool/data would be needed.
  RECOMMENDATION — the shortest plan of action the executor should follow, step by step.
- Never invent an id, a metric or a url. "Not found" is a finding.`,

  execute: `You are an EXECUTION sub-agent. You were dispatched by the orchestrating agent, not by the user.
- Do the work described in the brief with your tools, end to end, in this run. Read before you write.
- Stay inside the brief. Do not start adjacent work nobody asked for, and do not ask questions — you have no channel to the user.
- Reply ONCE, as a compact report for another agent:
  DONE — one line per change, each with the id/name of the thing you changed and what it now says.
  FAILED — what did not go through and the exact error.
  NOTES — anything the verifier must check, or that the orchestrator should tell the user.
- A report that says "done" for work whose tool call failed is the one unacceptable outcome. Report failures plainly.`,

  verify: `You are a VERIFICATION sub-agent. You were dispatched by the orchestrating agent, not by the user.
- You have READ tools only. Your job is to check, against the REAL current state, whether the claimed work actually happened and is good.
- Do not trust the execution report: re-read the objects it names (posts, articles, plan, kit, media…) and judge what you find.
- Reply ONCE, and START with a single line exactly in this form:
  VERDICT: pass | partial | fail
  then:
  EVIDENCE — what you read and what it showed (ids, field values).
  DEFECTS — each problem found, with the one concrete fix that would close it.
- "pass" means you verified it, not that nothing looked wrong. If you could not check something, that is at most "partial".`,

  sandbox: `You are a SANDBOX sub-agent. You were dispatched by the orchestrating agent, not by the user, and you have something no other agent here has: a real Linux VM of your own.
- sandbox_exec runs commands (Node, Python, package installs, whatever you install). sandbox_write_file / sandbox_read_file are your filesystem. On a research run, sandbox_browse opens a real Chromium — pair it with search_web: that finds urls, this actually reads the rendered page.
- The brand's own data may be on that filesystem, regenerated for this run (on a research run it is deliberately absent — the README says so). READ \`brand/README.md\` FIRST — it lists exactly which files exist. \`brand/history.csv\` has published-post metrics in columns: count things there instead of eyeballing them.
- Write and run real code. A number you computed with a command you can point at is worth more than the same number guessed from a file you skimmed — and any number in your report must come from the former.
- The VM changes NOTHING about the brand: it is isolated and it is thrown away. If a result matters (a chart, a report, a cleaned dataset), call sandbox_save_output or it is gone.
- Reply ONCE, as a compact report for another agent:
  METHOD — what you actually ran, in one or two lines.
  RESULT — the findings, with the numbers and where they came from.
  SAVED — what you persisted (media ids / document titles), or "nothing".
  LIMITS — what you could not compute or reach, and why.
- If the sandbox fails to start or Chromium is unavailable, say so plainly and fall back to the read tools. Never present an estimate as a computed result.`,

  compose: `You are a COMPOSE sub-agent. You were dispatched by the orchestrating agent, not by the user, and you are ONE OF SEVERAL running at the same time on different pieces of the same object.
- You do NOT write to the shared object. There is no source tool in your set on purpose: several of you writing the same file would silently overwrite each other. YOUR DELIVERABLE IS YOUR REPORT.
- Build exactly the one piece described in the brief, nothing around it. You cannot see the other pieces and you must not guess at them: anything shared — canvas size, palette, fonts, the names already in scope — is in the brief, and if it is not there, it is not yours to invent.
- You may read anything, and you may mint what your piece needs (an image, a library asset, a reference). Use them.
- Reply ONCE, in this shape, and keep prose out of the code block:
  PIECE — the deliverable itself, in a single fenced code block, ready to be pasted as-is.
  ASSUMPTIONS — anything you had to decide that the brief did not fix, one line each.
  NEEDS — identifiers, props or helpers your piece expects to already exist in the assembled whole.
- A piece that does not compile on its own terms, or that redefines something the brief said is shared, costs the orchestrator more than a missing piece. When in doubt, make it smaller and say so in ASSUMPTIONS.`
};

const ROLE_LABEL: Record<SubagentRole, string> = {
  research: 'Ricerca',
  execute: 'Esecuzione',
  verify: 'Verifica',
  sandbox: 'Sandbox',
  compose: 'Composizione'
};

export type SubagentRunCtx = {
  supabase: SupabaseClient;
  brandId: string;
  /** Tool dell'orchestratore DOPO modalità e piano, PRIMA della restrizione per hub. */
  tools: Record<string, unknown>;
  model: ChatModelResolved;
  locale?: string;
  userId?: string;
  threadId?: string;
  webHubEnabled?: boolean;
  /** L'hub dell'agente che sta orchestrando: default degli `execute` senza `agent` esplicito. */
  defaultAgent?: AgentId | null;
    /**
     * Perimetro di scrittura degli `execute` quando la superficie non è un hub di chat. Vuoto = «usa i
     * toolKeys dell'hub», giusto in chat e sbagliato dove i tool si chiamano in un altro modo.
     */
  hubToolKeys?: string[];
  /** Quanto tempo resta alla run: un sotto-agente non deve mai essere l'ultimo a saperlo. */
  remainingMs?: () => number;
  /**
   * Chiamata alla fine di OGNI run, riuscita o meno: serve a chi deve sapere non quante deleghe ci
   * sono state ma DI CHE TIPO — la guardia che pretende una review prima di chiudere non può fidarsi
   * di ciò che l'agente racconta, deve vedere che una run di verifica è girata e con che verdetto.
   */
  onRun?: (info: { role: SubagentRole; agent: AgentId | null; verdict?: string; error?: string }) => void;
  /**
   * Il partial in tempo reale (stessa forma dell'SSE di chat, piegata dal reducer condiviso):
   * chiamata a ogni delta, con throttle a cura del destinatario. `force` = un evento che l'utente
   * deve vedere SUBITO (una tool call che si apre o chiude). Nel turno in coda è il mirror che
   * riscrive `chat_jobs.partial`; nella run sincrona non c'è.
   */
  onProgress?: (state: ChatStreamState, force?: boolean) => void;
};

export type SubagentFactoryOpts = SubagentRunCtx & {
  /**
   * `queued` (default in chat): i tool di delega accodano un job `subagent_run` e tornano SUBITO —
   * il risultato rientra come nuovo turno. `inline`: la run gira dentro il tool call come prima,
   * per le superfici kit la cui guardia di `finish` legge i verdetti in banda (agent-base).
   */
  mode?: 'inline' | 'queued';
  /**
   * Solo `inline`: anche una run dentro il turno lascia una riga `chat_jobs` con il partial vivo
   * (specchio, non coda) — è ciò che fa comparire il lavoro tra i processi in background e lo
   * rende leggibile a `check_subagent`. La durabilità la dà il turno kit che la ospita.
   */
  mirror?: boolean;
  /** Dove il rientro del job deve ripartire (il kick della coda ne ha bisogno). */
  origin?: string;
};

type RunResult = {
  role: SubagentRole;
  agent: AgentId | null;
  title: string;
  report: string;
  /** `runs/<id>.md` — il percorso da cui l'orchestratore rilegge cosa ha fatto davvero. */
  trace?: string;
  truncated?: boolean;
  steps: number;
  tools_used: string[];
  verdict?: ReturnType<typeof parseVerdict>;
  error?: string;
  tools_available?: number;
  sandbox?: {
    opened: boolean;
    commands: number;
    browses: number;
    saves: number;
    browser: boolean;
    browser_provisioning?: string;
    image?: string;
    browser_error?: string;
  };
};

/**
 * Sotto questo non si apre una delega: non farebbe in tempo a tornare. Esportata perché chi PRETENDE
 * una delega deve poter sapere se è ancora possibile — una guardia che chiede una review quando non
 * c'è più tempo per farla è un vicolo cieco, e il turno ci muore dentro.
 */
export const MIN_SUBAGENT_RUN_MS = 20_000;
const MIN_RUN_MS = MIN_SUBAGENT_RUN_MS;

/**
 * La cache che attraversa le run di una stessa factory: il brand e i prompt di sistema per hub si
 * costruiscono una volta per turno (o per job), non per delega.
 */
export type SubagentSharedCache = {
  brandRow: Record<string, unknown> | null;
  systemCache: Map<string, string>;
  volatile: Promise<string> | null;
};

const newSharedCache = (): SubagentSharedCache => ({ brandRow: null, systemCache: new Map(), volatile: null });

/**
 * IL MOTORE DI UNA RUN, indipendente da chi la chiama.
 *
 * Una volta la run viveva solo dentro la closure dei tre tool di delega: chi non era uno di quei
 * tool non poteva eseguire un sotto-agente. Il lavoro async ne ha bisogno altrove — il worker che
 * esegue il job `subagent_run` — quindi il motore è qui, e la closure diventa uno dei chiamanti.
 */
export async function runSubagentRun(
  ctx: SubagentRunCtx,
  args: {
    role: SubagentRole;
    agent: AgentId | null;
    title: string;
    brief: string;
    context?: string;
    successCriteria?: string;
    maxSteps?: number;
    network?: SandboxNetworkMode;
    brandData?: boolean;
    abortSignal?: AbortSignal;
    shared?: SubagentSharedCache;
  }
): Promise<RunResult> {
  const {
    supabase,
    brandId,
    tools: available,
    model,
    locale = 'en',
    userId = '',
    threadId,
    webHubEnabled = true,
    hubToolKeys,
    remainingMs,
    onRun,
    onProgress
  } = ctx;
  const { role, agent, title, brief, context, successCriteria, abortSignal } = args;
  const shared = args.shared ?? newSharedCache();
  const base: RunResult = { role, agent, title, report: '', steps: 0, tools_used: [] };

  if (abortSignal?.aborted) return { ...base, error: 'Chat stopped' };

  const names = subagentToolNames(role, agent, Object.keys(available), hubToolKeys);
  const scoped = pickByName(available, names);
  if (!Object.keys(scoped).length) {
    return {
      ...base,
      error: `No tools available for a ${role} sub-agent in this chat mode — do this work yourself or switch mode.`
    };
  }
  if (role === 'sandbox' && !isSandboxConfigured()) {
    return {
      ...base,
      error:
        'The sandbox is not configured on this deployment, so there is no VM to run code in. Do the work with the normal tools, or tell the user this needs the sandbox enabled.'
    };
  }
  // Modalità ask / plan: le scritture sono già state tolte a monte. Un esecutore con solo tool di
  // lettura brucerebbe una run per tornare a dire che non poteva fare niente.
  if (role === 'execute' && !names.some((n) => !isReadOnlyToolName(n))) {
    return {
      ...base,
      error:
        'This chat mode has no write tools, so an execution sub-agent has nothing to execute. Use role="research", or tell the user to switch to Agent mode.'
    };
  }

  const left = remainingMs?.();
  if (typeof left === 'number' && left < MIN_RUN_MS) {
    return {
      ...base,
      error: 'Not enough time left in this turn to run a sub-agent. Report what is done and what still needs another turn.'
    };
  }

  async function loadBrand() {
    if (shared.brandRow) return shared.brandRow;
    const { data } = await supabase
      .from('brands')
      .select(
        'id, org_id, name, slug, website, timezone, onboarding_state, setup_completed_at, plan, status, activated_at, stripe_customer_id, stripe_subscription_id'
      )
      .eq('id', brandId)
      .maybeSingle();
    shared.brandRow = (data as Record<string, unknown> | null) ?? null;
    return shared.brandRow;
  }

  async function hubSystem(): Promise<string> {
    const key = agent ?? '_none';
    const cached = shared.systemCache.get(key);
    if (cached) return cached;
    const brand = await loadBrand();
    if (!brand) return '';
    // `consultation: true` = contesto del brand e dell'hub, senza il blocco di setup: un worker
    // non deve inseguire l'onboarding, deve fare la cosa che gli è stata scritta nel brief.
    const built = await buildSystemPrompt(supabase, brand, locale, agent, {
      consultation: true,
      webHubEnabled,
      threadId,
      userId
    });
    shared.systemCache.set(key, built);
    return built;
  }

  function turnVolatile(): Promise<string> {
    if (!shared.volatile) {
      shared.volatile = loadBrand()
        .then((brand) => (brand ? buildTurnVolatileBlock(supabase, brand, locale) : ''))
        .catch(() => '');
    }
    return shared.volatile;
  }

  const system = `${await hubSystem()}

## SUB-AGENT RUN — ${ROLE_LABEL[role]}
${ROLE_CONTRACT[role]}

Everything above is brand context. It is NOT a task list: the only task is the brief below.
You are not talking to the user and no one is reading you live — your final message IS the return value.`;

  const prompt = wrapTurnContext(
    await turnVolatile(),
    [
      `TASK: ${title}`,
      `BRIEF:\n${brief.trim()}`,
      context?.trim() ? `CONTEXT FROM THE ORCHESTRATOR:\n${context.trim()}` : '',
      successCriteria?.trim() ? `DONE WHEN:\n${successCriteria.trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  );

  const steps = chatSubAgentMaxTurns(role, args.maxSteps);
  const t0 = Date.now();

    // La VM vive quanto la run: si apre pigra al primo tool che la tocca e si chiude nel finally,
    // anche quando il modello esplode a metà. Il recorder è la scatola nera della run, per tutti i
    // ruoli — anche un `research` a mani vuote ha un percorso che spiega perché.
  const recorder = createRecorder();
  recorder.event('start', { role, agent, title, brief, context, success_criteria: successCriteria, max_steps: steps });

  let sandboxSession: SandboxSession | null = null;
  if (role === 'sandbox') {
    sandboxSession = createSandboxTools({
      supabase,
      brandId,
      userId,
      threadId,
      // La macchina è quella dell'agente che ha delegato, non una VM del brand a parte: il
      // delegato lavora sullo schermo che l'utente sta guardando.
      agentId: agent ?? undefined,
      mode: args.network ?? 'compute',
      brandData: args.brandData,
      webHubEnabled,
      remainingMs,
      onLog: (line) => {
        console.log(`[Subagent sandbox] brand=${brandId} ${line}`);
        recorder.event('log', { line });
      },
      record: recorder.event
    });
    Object.assign(scoped, sandboxSession.tools);
  }

  // Il partial in tempo reale: la run NON è più un buco nero. Gli stessi eventi che piega il
  // browser, piegati qui e girati a chi riscrive `chat_jobs.partial` — flush immediato sui tool
  // (aprire una call è ciò che l'utente deve vedere SUBITO), throttle sul testo, a cura di chi
  // riceve. Nella run senza spettatori il callback non c'è e il costo è zero.
  const state = emptyStreamState();
  let lastFlush = 0;
  const PARTIAL_MS = 300;
  const flushProgress = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastFlush < PARTIAL_MS) return;
    lastFlush = now;
    onProgress(state, force);
  };

  try {
    const result = streamText({
      model: model.model,
      system,
      prompt,
      tools: scoped as Parameters<typeof streamText>[0]['tools'],
      stopWhen: [stepCountIs(steps)],
      temperature: role === 'verify' ? 0.1 : 0.4,
      abortSignal,
      ...model.callOptions
    });

    for await (const part of result.fullStream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = part as any;
      switch (p.type) {
        case 'text-delta':
          applyChatStreamEvent(state, { type: 'text-delta', delta: p.text ?? p.delta });
          flushProgress();
          break;
        case 'tool-call':
          applyChatStreamEvent(state, {
            type: 'tool-input-available',
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            input: p.input
          });
          flushProgress(true);
          break;
        case 'tool-result':
          applyChatStreamEvent(state, {
            type: 'tool-output-available',
            toolCallId: p.toolCallId,
            output: p.output
          });
          flushProgress(true);
          break;
        case 'tool-error':
          applyChatStreamEvent(state, {
            type: 'tool-output-error',
            toolCallId: p.toolCallId,
            errorText: String(p.error ?? 'tool error')
          });
          flushProgress(true);
          break;
        case 'reasoning-delta':
          applyChatStreamEvent(state, { type: 'reasoning-delta', delta: p.text ?? p.delta });
          flushProgress();
          break;
        case 'error':
          state.failed = true;
          flushProgress(true);
          break;
        default:
          break;
      }
    }
    flushProgress(true);

    const finalText = await result.text;
    const finalSteps = await result.steps;
    const totalUsage = await result.totalUsage;

    const used = new Set<string>();
    for (const s of finalSteps ?? []) {
      for (const c of s.toolCalls ?? []) used.add(c.toolName);
      // Il giro del modello, non solo quello della VM: quale tool ha chiamato, con che input, e
      // cosa gli è tornato. È la metà che mancava per capire perché un sotto-agente ha deviato.
      for (const r of s.toolResults ?? []) {
        recorder.event('tool_call', {
          tool: (r as { toolName?: string }).toolName,
          input: (r as { input?: unknown }).input,
          output: (r as { output?: unknown }).output
        });
      }
      if (s.text?.trim()) recorder.event('assistant_text', { text: s.text });
    }
    const { report, truncated } = clampReport(finalText ?? '');

    logAiCall({
      label: 'chat_subagent',
      provider: model.provider,
      model: model.modelId,
      ms: Date.now() - t0,
      ok: true,
      ...extractSdkUsage(totalUsage),
      brandId,
      userId,
      threadId,
      context: `subagent:${role}:${agent ?? 'none'}`
    });

    const out: RunResult = {
      ...base,
      report:
        report ||
        'The sub-agent ended without a written report — treat its work as unverified and check the state yourself.',
      steps: finalSteps?.length ?? 0,
      tools_used: [...used],
      tools_available: names.length
    };
    if (truncated) out.truncated = true;
    if (role === 'verify') out.verdict = parseVerdict(report);
    onRun?.({ role, agent, verdict: out.verdict });
    if (sandboxSession) out.sandbox = sandboxSession.stats();

    recorder.event('report', { report: out.report, steps: out.steps, tools_used: out.tools_used });
      // ATTESO, non `void`: senza l'id la traccia esiste e non è raggiungibile. Costa un insert su un
      // giro durato decine di secondi; `.catch` perché l'osservabilità non può far fallire un lavoro
      // riuscito.
    const traceId = await saveAgentSession({
      brandId,
      userId,
      threadId,
      agent: agent ?? 'none',
      mode: role,
      surface: 'chat_subagent',
      status: 'ok',
      model: model.modelId,
      provider: model.provider,
      systemPrompt: system,
      transcript: out.report,
      recorder,
      // L'unico momento in cui il set esiste: qui. Chi rileggerà `runs/<id>.md` non potrà più.
      secrets: sandboxSession?.secrets()
    }).catch(() => null);
    if (traceId) {
      out.trace = `runs/${traceId}.md`;
        // La riga che rimanda alla traccia si aggiunge SOLO quando il rapporto non torna: metterla
        // sempre inviterebbe a rileggere anche i giri andati bene, cioè a rovesciare nel padre i
        // token che il sotto-agente serviva a risparmiare. Il campo `trace` c'è comunque.
      if (out.verdict && out.verdict !== 'pass') {
        out.report += `\n\nTraccia completa di questo giro: read_file("${out.trace}") — o grep("${out.trace}", "error").`;
      }
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAiCall({
      label: 'chat_subagent',
      provider: model.provider,
      model: model.modelId,
      ms: Date.now() - t0,
      ok: false,
      error: msg,
      brandId,
      userId,
      threadId,
      context: `subagent:${role}:${agent ?? 'none'}`
    });

      // Una run che esplode è quella di cui non si sa niente, ed è la situazione in cui la traccia
      // serve di più: il riepilogo, qui, non arriva nemmeno.
    recorder.event('error', { message: msg });
    const traceId = await saveAgentSession({
      brandId,
      userId,
      threadId,
      agent: agent ?? 'none',
      mode: role,
      surface: 'chat_subagent',
      status: abortSignal?.aborted ? 'cancelled' : 'error',
      model: model.modelId,
      provider: model.provider,
      systemPrompt: system,
      transcript: '',
      error: msg,
      recorder,
      secrets: sandboxSession?.secrets()
    }).catch(() => null);
    onRun?.({ role, agent, error: msg });
    return { ...base, error: msg, ...(traceId ? { trace: `runs/${traceId}.md` } : {}) };
  } finally {
    // La sandbox si chiude comunque; se ha lasciato uno stato interessante, è già negli eventi.
    await sandboxSession?.close();
  }
}

/**
 * La pipeline RESEARCH → EXECUTION → VERIFICATION, fuori dai tool: la usa il mode inline e il
 * worker che esegue il job accodato. `budget.spend` conta le run che la pipeline consuma.
 */
export async function runTaskPipelinePhases(
  ctx: SubagentRunCtx,
  input: {
    objective: string;
    agent?: AgentId;
    research_brief?: string;
    execute_brief?: string;
    verify_brief?: string;
    context?: string;
    skip_research?: boolean;
    repair?: boolean;
  },
  budget: { left: () => number; spend: (n: number) => void },
  shared: SubagentSharedCache = newSharedCache()
): Promise<AnyRecShape> {
  const agent = input.agent ?? ctx.defaultAgent ?? null;
  const phases: RunResult[] = [];
  const wantsRepair = input.repair !== false;

  const need = (input.skip_research ? 0 : 1) + 2;
  if (budget.left() < need) {
    return {
      error: `Not enough sub-agent budget for a full pipeline (needs ${need}, ${budget.left()} left). Use delegate_task for the single phase that matters, or finish it yourself.`,
      runs_left: budget.left()
    };
  }

  let research: RunResult | null = null;
  if (!input.skip_research) {
    budget.spend(1);
    research = await runSubagentRun(ctx, {
      role: 'research',
      agent,
      shared,
      title: `Ricerca — ${input.objective.slice(0, 80)}`,
      brief:
        input.research_brief?.trim() ||
        `Establish everything needed to do this well, from the real data:\n${input.objective}`,
      context: input.context
    });
    phases.push(research);
    if (research.error) return { phases, error: research.error, runs_left: budget.left() };
  }

  const researchBlock = research?.report ? `RESEARCH REPORT:\n${research.report}` : '';
  const sharedContext = [input.context?.trim(), researchBlock].filter(Boolean).join('\n\n');

  budget.spend(1);
  const exec = await runSubagentRun(ctx, {
    role: 'execute',
    agent,
    shared,
    title: `Esecuzione — ${input.objective.slice(0, 80)}`,
    brief: input.execute_brief?.trim() || `Do the work required by this objective, end to end:\n${input.objective}`,
    context: sharedContext,
    successCriteria: input.objective
  });
  phases.push(exec);
  if (exec.error) return { phases, error: exec.error, runs_left: budget.left() };

  budget.spend(1);
  let verify = await runSubagentRun(ctx, {
    role: 'verify',
    agent,
    shared,
    title: `Verifica — ${input.objective.slice(0, 80)}`,
    brief:
      input.verify_brief?.trim() ||
      `Check against the real current state whether this objective is met:\n${input.objective}`,
    context: `EXECUTION REPORT (claims to verify — do not trust, re-read):\n${exec.report}${sharedContext ? `\n\n${sharedContext}` : ''}`
  });
  phases.push(verify);

  let repaired = false;
  if (
    wantsRepair &&
    !verify.error &&
    (verify.verdict === 'fail' || verify.verdict === 'partial') &&
    budget.left() >= 2
  ) {
    repaired = true;
    budget.spend(1);
    const fix = await runSubagentRun(ctx, {
      role: 'execute',
      agent,
      shared,
      title: `Riparazione — ${input.objective.slice(0, 80)}`,
      brief: `Fix ONLY the defects listed by the verifier. Do not redo what already passed, do not add new work.`,
      context: `OBJECTIVE:\n${input.objective}\n\nVERIFICATION REPORT:\n${verify.report}\n\nPREVIOUS EXECUTION REPORT:\n${exec.report}`
    });
    phases.push(fix);
    if (!fix.error) {
      budget.spend(1);
      verify = await runSubagentRun(ctx, {
        role: 'verify',
        agent,
        shared,
        title: `Ri-verifica — ${input.objective.slice(0, 80)}`,
        brief: `Re-check the objective against the real state after the repair round:\n${input.objective}`,
        context: `REPAIR REPORT (claims to verify — do not trust, re-read):\n${fix.report}`
      });
      phases.push(verify);
    }
  }

  return {
    objective: input.objective,
    agent,
    verdict: verify.verdict ?? 'unknown',
    repaired,
    phases,
    runs_left: budget.left(),
    instruction:
      verify.verdict === 'pass'
        ? 'Verified. Tell the user what changed, concretely — do not re-run the same work.'
        : 'NOT verified. Say plainly to the user what is done, what is not, and what you propose next. Never report unverified work as finished.'
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecShape = Record<string, any>;

/** Il fan-out `run_parallel_tasks`: N worker sullo stesso ruolo, 4 lane. Usato da inline e worker. */
export async function runParallelTasks(
  ctx: SubagentRunCtx,
  input: {
    role: 'compose' | 'research';
    shared_context: string;
    tasks: Array<{ title: string; brief: string }>;
    agent?: AgentId;
    max_steps?: number;
  }
): Promise<AnyRecShape> {
  const agent = input.agent ?? ctx.defaultAgent ?? null;

  // Il tetto di concorrenza non è il budget: è quante chiamate al modello vogliamo in volo
  // insieme. Oltre, si guadagna poco wall-clock e si prende un rate limit a metà lavoro.
  const LANES = 4;
  const results: RunResult[] = new Array(input.tasks.length);
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= input.tasks.length) return;
      const task = input.tasks[i];
      results[i] = await runSubagentRun(ctx, {
        role: input.role,
        agent,
        title: task.title,
        brief: task.brief,
        context: `SHARED CONTEXT — the whole this piece belongs to. Do not contradict it, do not redefine what it fixes:\n${input.shared_context.trim()}\n\nYou are piece ${i + 1} of ${input.tasks.length}. The others are being built right now by other agents; you cannot see them.`,
        maxSteps: input.max_steps
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, input.tasks.length) }, lane));

  const failed = results.filter((r) => r?.error).length;
  return {
    role: input.role,
    agent,
    tasks: results,
    failed,
    instruction:
      input.role === 'compose'
        ? failed
          ? `${failed} of ${results.length} pieces failed. Build the missing ones yourself before assembling — never assemble a whole with a hole in it and call it done.`
          : 'Every piece came back in its report. Assemble them yourself now, reconcile the ASSUMPTIONS and NEEDS sections, and write the result with your source tools — the workers wrote nothing.'
        : 'Read the reports together: what one worker could not establish another may have. Then act.'
  };
}

/**
 * La lettura del job di un sub-agent, condivisa dal tool `check_subagent`: status, il testo vivo
 * (la coda di quello che sta facendo), le tool call con il loro stato, e il risultato quando c'è.
 */
export async function checkSubagentJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string
): Promise<AnyRecShape> {
  const { data: job } = await supabase
    .from('chat_jobs')
    .select('id, tool_name, status, partial, result, error, created_at, completed_at')
    .eq('id', jobId)
    .eq('user_id', userId || '')
    .maybeSingle();
  if (!job) return { error: 'No such sub-agent job (or it is not yours).' };
  const partial = (job.partial ?? {}) as { text?: string; tools?: Array<{ toolName: string; status?: string }> };
  const out: AnyRecShape = {
    job_id: job.id,
    status: job.status,
    progress: String(partial.text ?? '').slice(-1200),
    tools: (partial.tools ?? []).map((t) => `${t.toolName}:${t.status ?? 'running'}`)
  };
  if (job.error) out.error = job.error;
  if (job.status === 'done' && job.result) out.result = job.result;
  out.note = 'The finished report is delivered as a new message anyway. Do not poll this in a loop.';
  return out;
}

export function createSubagentTools(opts: SubagentFactoryOpts) {
  const { mode = 'queued', origin = '', mirror = false, ...ctx } = opts;
  const shared = newSharedCache();

  /** Letto a ogni run, non alla costruzione: in una superficie che mette i propri tool e questi
   * nello STESSO oggetto (la pagina Motion) il set si riempie subito dopo la costruzione. */
  const availableNames = () => Object.keys(ctx.tools);
  let runsUsed = 0;

  // Il budget conta ora DISPACCI, non run: ogni delega accodata è una riga chat_jobs che un
  // worker esegue fuori dal turno. Il tetto resta ciò che ferma un orchestratore che accumula
  // lavoro senza produrre nulla.
  function budgetError(): { error: string; budget_used: number } | null {
    if (runsUsed >= MAX_SUBAGENT_RUNS) {
      return {
        error: `Sub-agent dispatch budget spent for this turn (max ${MAX_SUBAGENT_RUNS}). Finish the work yourself with your own tools, or tell the user what is left.`,
        budget_used: runsUsed
      };
    }
    return null;
  }

  /** La run inline (superfici kit): stesso motore, cache condivisa, budget del chiamante.
   * Con `mirror` la run lascia una riga `chat_jobs` con il partial vivo — osservabilità, non
   * coda: la durabilità la dà il turno kit che la ospita (run con heartbeat e resume). */
  function runMirrored<T>(
    kind: 'single' | 'pipeline' | 'parallel',
    row: { role?: string; agent?: AgentId | null; title: string },
    run: (onProgress: SubagentRunCtx['onProgress']) => Promise<T>
  ): Promise<T> {
    if (!mirror) return run(undefined);

    const created = ctx.supabase
      .from('chat_jobs')
      .insert({
        brand_id: ctx.brandId,
        user_id: ctx.userId || '',
        tool_name: SUBAGENT_JOB_TOOL,
        input_params: { kind, role: row.role ?? null, agent: row.agent ?? null, title: row.title, mirrored: true },
        status: 'running',
        thread_id: ctx.threadId ?? null,
        partial: { text: '', tools: [], reasoning: '', at: Date.now() }
      })
      .select('id')
      .maybeSingle();

    return (async () => {
      // La riga è un extra di osservabilità: se l'insert non passa, la run inline resta integra.
      const { data: job } = await created;
      if (!job) return run(undefined);

      const jobMirror = createJobPartialMirror(ctx.supabase, (job as { id: string }).id);
      const stopHeartbeat = jobMirror.startHeartbeat();
      try {
        const res = await run((s, f) => jobMirror.push(s, f));
        const ok = !(res as { error?: string }).error;
        await ctx.supabase
          .from('chat_jobs')
          .update({
            status: ok ? 'done' : 'failed',
            ...(ok ? { result: res } : {}),
            ...(!(res as { error?: string }).error ? {} : { error: String((res as { error?: string }).error).slice(0, 2000) }),
            partial: null,
            completed_at: new Date().toISOString()
          })
          .eq('id', (job as { id: string }).id);
        return res;
      } finally {
        await jobMirror.flushLatest();
        stopHeartbeat();
      }
    })();
  }

  /** La run inline di UN sub-agent (delegate_task). */
  function runInline(args: Parameters<typeof runSubagentRun>[1]): Promise<RunResult> {
    return runMirrored<RunResult>('single', { role: args.role, agent: args.agent, title: args.title }, (onProgress) =>
      runSubagentRun({ ...ctx, onProgress }, { ...args, shared })
    );
  }
  const agentEnum = z.enum(AGENT_IDS as unknown as [AgentId, ...AgentId[]]);

  return {
    delegate_task: tool({
      description: [
        'Dispatch ONE sub-agent that really runs — its own tool loop, its own clean context — and returns a written report.',
        'Use it as your default for any step of a long job: role="research" (read-only fact gathering), role="execute" (does the work with the hub tools), role="verify" (read-only check of what was actually done), role="sandbox" (a real Linux VM: writes and runs code, a terminal, the brand data as files, and a real browser when you pass network="research").',
        'The brief must be self-contained: the sub-agent does not see this conversation, only the brand context and what you write here.',
        'It cannot talk to the user, cannot delegate further, and research/verify cannot write anything.',
        mode === 'queued'
          ? 'The run happens OUTSIDE this turn as a background job: you get a job_id back and the report arrives as a NEW message. Its live progress (what it is doing, which tools it is calling) is visible to the user and readable with check_subagent.'
          : 'It runs inside this turn and returns the report directly.',
        `Budget: ${MAX_SUBAGENT_RUNS} sub-agent dispatches per turn, shared with run_task_pipeline and run_parallel_tasks.`
      ].join(' '),
      inputSchema: z.object({
        role: z
          .enum(SUBAGENT_ROLES)
          .describe(
            'research = read-only facts; execute = do the work; verify = read-only check; sandbox = a real Linux VM (terminal, Node/Python, the brand data as files, and — with network="research" — a Chromium to browse)'
          ),
        title: z.string().min(3).max(120).describe('Short name of the task, for the user-visible trace'),
        brief: z
          .string()
          .min(10)
          .max(6000)
          .describe('Self-contained instruction: what to do, on what, with which constraints. Written for an agent, not for the user.'),
        agent: agentEnum
          .optional()
          .describe('Which hub the sub-agent works in (publish, brand, grow, web, motion, ugc, media). Required in practice for execute; defaults to your own hub.'),
        context: z
          .string()
          .max(4000)
          .optional()
          .describe('Facts from this conversation the sub-agent needs — ids, decisions, the user’s wording, the previous phase’s report.'),
        success_criteria: z.string().max(1000).optional().describe('What "done" means, checkable from the data.'),
        max_steps: z.number().min(3).max(SUB_AGENT_STEP_CEILING).optional().describe('Tool-step ceiling for this sub-agent. Leave empty for the role default.'),
        network: z
          .enum(['compute', 'research'])
          .optional()
          .describe(
            'role="sandbox" only. "compute" (default) = no internet beyond package registries: for calculations on the brand data. "research" = internet + Chromium: only when the task really needs to read the web.'
          ),
        brand_data: z
          .boolean()
          .optional()
          .describe(
            'role="sandbox" only. Whether the brand data files are written to the VM. Default: yes on "compute", NO on "research" — a run that reads untrusted pages with the internet open should not also be sitting on the brand data. Set true only when the task genuinely needs to cross the two.'
          )
      }),
      execute: async (
        input: {
          role: SubagentRole;
          title: string;
          brief: string;
          agent?: AgentId;
          context?: string;
          success_criteria?: string;
          max_steps?: number;
          network?: SandboxNetworkMode;
          brand_data?: boolean;
        },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const blocked = budgetError();
        if (blocked) return blocked;
        const agent = input.agent ?? ctx.defaultAgent ?? null;
        if (mode === 'queued') {
          runsUsed++;
          return startLongToolJob(
            ctx.supabase,
            ctx.brandId,
            ctx.userId || '',
            SUBAGENT_JOB_TOOL,
            {
              kind: 'single',
              role: input.role,
              agent,
              title: input.title,
              brief: input.brief,
              context: input.context,
              success_criteria: input.success_criteria,
              max_steps: input.max_steps,
              network: input.network,
              brand_data: input.brand_data,
              subagent: {
                locale: ctx.locale ?? 'en',
                webHubEnabled: ctx.webHubEnabled ?? true,
                defaultAgent: ctx.defaultAgent ?? null
              }
            },
            ctx.threadId,
            toolOpts?.abortSignal,
            origin,
            ctx.locale ?? 'en'
          );
        }
        runsUsed++;
        const res = await runInline({
          role: input.role,
          agent,
          title: input.title,
          brief: input.brief,
          context: input.context,
          successCriteria: input.success_criteria,
          maxSteps: input.max_steps,
          network: input.network,
          brandData: input.brand_data,
          abortSignal: toolOpts?.abortSignal
        });
        return { ...res, runs_left: Math.max(0, MAX_SUBAGENT_RUNS - runsUsed) };
      }
    }),

    run_task_pipeline: tool({
      description: [
        'Run a whole job as RESEARCH → EXECUTION → VERIFICATION in one call: three sub-agents, each with a clean context, each fed the previous one’s report.',
        'This is the default shape for anything long or multi-step (produce a week, fix the SEO of a section, prepare a launch, clean up a backlog): it separates finding out, doing, and checking, instead of doing all three in your own context.',
        'When the verification comes back fail/partial you may ask for one repair round (repair=true): the executor gets the defects and the verifier re-checks.',
        mode === 'queued'
          ? 'The whole pipeline runs OUTSIDE this turn as ONE background job: you get a job_id back and the verdict with the phase reports arrives as a NEW message. Live progress is visible to the user and readable with check_subagent.'
          : 'It runs inside this turn and returns the verdict with the phase reports.',
        `One dispatch from the turn budget of ${MAX_SUBAGENT_RUNS} (the phases run inside the pipeline).`
      ].join(' '),
      inputSchema: z.object({
        objective: z.string().min(10).max(2000).describe('The whole job in the user’s terms — what must be true at the end.'),
        agent: agentEnum.optional().describe('Hub that will do the execution. Defaults to your own hub.'),
        research_brief: z.string().max(4000).optional().describe('What to find out first. Empty + skip_research=false = derived from the objective.'),
        execute_brief: z.string().max(6000).optional().describe('What to actually do. The research report is appended to it automatically.'),
        verify_brief: z.string().max(4000).optional().describe('What to check, and against what. Defaults to the objective plus the executor’s claims.'),
        context: z.string().max(4000).optional().describe('Shared facts every phase needs: ids, the user’s constraints, decisions already made.'),
        skip_research: z.boolean().optional().describe('True only when you already hold the facts and passed them in context.'),
        repair: z.boolean().optional().describe('Run one repair round (execute + verify again) if the first verdict is fail or partial. Default true.')
      }),
      execute: async (
        input: {
          objective: string;
          agent?: AgentId;
          research_brief?: string;
          execute_brief?: string;
          verify_brief?: string;
          context?: string;
          skip_research?: boolean;
          repair?: boolean;
        },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const blocked = budgetError();
        if (blocked) return blocked;
        if (mode === 'queued') {
          runsUsed++;
          return startLongToolJob(
            ctx.supabase,
            ctx.brandId,
            ctx.userId || '',
            SUBAGENT_JOB_TOOL,
            {
              kind: 'pipeline',
              ...input,
              agent: input.agent ?? ctx.defaultAgent ?? null,
              subagent: {
                locale: ctx.locale ?? 'en',
                webHubEnabled: ctx.webHubEnabled ?? true,
                defaultAgent: ctx.defaultAgent ?? null
              }
            },
            ctx.threadId,
            toolOpts?.abortSignal,
            origin,
            ctx.locale ?? 'en'
          );
        }
        const res = await runMirrored<AnyRecShape>(
          'pipeline',
          { agent: input.agent ?? ctx.defaultAgent ?? null, title: `Pipeline — ${input.objective.slice(0, 80)}` },
          (onProgress) => runTaskPipelinePhases({ ...ctx, onProgress }, input, {
            left: () => Math.max(0, MAX_SUBAGENT_RUNS - runsUsed),
            spend: (n) => (runsUsed += n)
          }, shared)
        );
        return { ...res, runs_left: Math.max(0, MAX_SUBAGENT_RUNS - runsUsed) };
      }
    }),

    run_parallel_tasks: tool({
      description: [
        'Run SEVERAL sub-agents AT THE SAME TIME, one per piece of a job that splits cleanly, and get back one report each.',
        'role="compose" is the normal choice: each worker builds one piece (a scene, a section, a variant) and returns it as code/text in its report — it does NOT write to the shared object, you assemble the pieces yourself afterwards.',
        'role="research" fans out a search: several read-only workers looking at different sources or angles at once.',
        'Execution is deliberately NOT available here: several writers on the same object silently overwrite each other. If the pieces cannot be produced independently, use run_task_pipeline instead.',
        `Each task spends one sub-agent run from the turn budget of ${MAX_SUBAGENT_RUNS}.`
      ].join(' '),
      inputSchema: z.object({
        role: z
          .enum(['compose', 'research'])
          .describe('compose = each worker produces one piece and returns it in its report; research = read-only fan-out.'),
        shared_context: z
          .string()
          .max(6000)
          .describe(
            'What EVERY worker needs and must not re-invent: the whole they are building, the canvas/palette/fonts/names already fixed, the conventions the pieces must share. Workers cannot see each other.'
          ),
        tasks: z
          .array(
            z.object({
              title: z.string().min(3).max(120).describe('Short name of this piece, for the user-visible trace'),
              brief: z
                .string()
                .min(10)
                .max(4000)
                .describe('Self-contained instruction for THIS piece only: what it must contain, how long, what it must not touch.')
            })
          )
          .min(2)
          .max(MAX_SUBAGENT_RUNS)
          .describe('One entry per piece. Two or more — a single piece is delegate_task.'),
        agent: agentEnum.optional().describe('Which hub the workers read from. Defaults to your own hub.'),
        max_steps: z.number().min(3).max(SUB_AGENT_STEP_CEILING).optional().describe('Tool-step ceiling per worker. Leave empty for the role default.')
      }),
      execute: async (
        input: {
          role: 'compose' | 'research';
          shared_context: string;
          tasks: Array<{ title: string; brief: string }>;
          agent?: AgentId;
          max_steps?: number;
        },
        toolOpts: ToolExecutionOptions<unknown>
      ) => {
        const blocked = budgetError();
        if (blocked) return blocked;
        const left = Math.max(0, MAX_SUBAGENT_RUNS - runsUsed);
        if (input.tasks.length > left) {
          return {
            error: `Not enough sub-agent budget for ${input.tasks.length} parallel tasks (${left} left). Send fewer pieces, or build the rest yourself.`,
            runs_left: left
          };
        }
        if (mode === 'queued') {
          runsUsed += input.tasks.length;
          return startLongToolJob(
            ctx.supabase,
            ctx.brandId,
            ctx.userId || '',
            SUBAGENT_JOB_TOOL,
            {
              kind: 'parallel',
              ...input,
              agent: input.agent ?? ctx.defaultAgent ?? null,
              subagent: {
                locale: ctx.locale ?? 'en',
                webHubEnabled: ctx.webHubEnabled ?? true,
                defaultAgent: ctx.defaultAgent ?? null
              }
            },
            ctx.threadId,
            toolOpts?.abortSignal,
            origin,
            ctx.locale ?? 'en'
          );
        }
        runsUsed += input.tasks.length;
        const res = await runMirrored<AnyRecShape>(
          'parallel',
          { role: input.role, agent: input.agent ?? ctx.defaultAgent ?? null, title: `${input.tasks.length} pezzi — ${input.role}` },
          (onProgress) => runParallelTasks({ ...ctx, onProgress }, input)
        );
        return { ...res, runs_left: Math.max(0, MAX_SUBAGENT_RUNS - runsUsed) };
      }
    }),

    /**
     * La lettura del partial da parte dell'AI, stessa parità che motion_write ha con motion_check.
     * Il turno che ha accodato vede l'ID, e il rientro porta il risultato da solo: questo tool è
     * per chi vuole UNA lettura dello stato mentre la run gira, non un loop di polling.
     */
    check_subagent: tool({
      description: [
        'Read the live progress of ONE background sub-agent job (delegate_task / run_task_pipeline / run_parallel_tasks).',
        'Returns its status, what it is doing right now (live text), the tools it has called, and — when finished — its report.',
        'Do NOT poll it in a loop: the finished result is delivered to you as a new message anyway. Use this once, only if you genuinely need to know where the work stands right now.'
      ].join(' '),
      inputSchema: z.object({
        job_id: z.string().describe('The job_id the dispatch returned.')
      }),
      execute: async (input: { job_id: string }) => checkSubagentJob(ctx.supabase, ctx.userId || '', input.job_id)
    })
  };
}

/** Attacca i tool di delega al set già filtrato per agente / modalità / piano. */
export function withSubagentTools<T extends Record<string, unknown>>(
  scoped: T,
  opts: SubagentFactoryOpts
): T {
  return { ...scoped, ...createSubagentTools(opts) } as unknown as T;
}
