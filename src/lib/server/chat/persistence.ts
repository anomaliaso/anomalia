import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage, TextPart, ToolApprovalRequest, ToolCallPart, ToolResultPart } from 'ai';
import { TERMINAL_TOOL_NAMES } from '@anomalia/agent-core/tools/builtin';
import { normalizeQuestionsPayload } from '$lib/chat-questions';
import { normalizeAgentProposal } from '$lib/chat-agent-proposal';
import { normalizeConnectPayload } from '$lib/chat-connect';
import { normalizeDeviceLoginPayload } from '$lib/chat-device-login';
import { normalizeTeamPayload } from '$lib/chat-team';
import { normalizeMediaPayload } from '$lib/chat-media';
import { normalizeRoutineEvent } from '$lib/chat-routine-event';
import { dmSendsFromOutput } from '$lib/chat-dm';
import { CHAT_HISTORY_LIMIT } from '$lib/chat-context';
import {
  attachmentParts,
  mediaPartsFor,
  mediaUrlsIn,
  reachableMediaParts,
  withoutVideo,
  type MediaPart
} from '$lib/media-parts';
import { summaryBlock } from './compaction';
import { markThreadRead } from './unread';
import { loadThreadEvents, threadMessageRows, threadProjectionRows } from './thread-events';
import type { ThreadProgress } from '@anomalia/agent-kit';

type ChatMessageRow = {
  id: string;
  role: string;
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
  name: string | null;
  created_at: string;
};

export type ChatThreadRow = {
  id: string;
  brand_id: string;
  user_id: string;
  title: string;
  /** Specialized agent bound to this thread (multi-agent chat). NULL = full/legacy behavior. */
  agent: string | null;
  /** Custom agent driving this thread, picked from the composer. NULL = none. */
  custom_agent_id?: string | null;
  /** Model preference (AgentModelPolicy | null) saved from the composer picker. */
  model?: unknown;
  /** Maker surface that opened this thread — 'motion' | 'media' | 'ugc'. NULL = the chat page. */
  surface?: string | null;
  /** What that surface was working on: a motion video id, a UGC run id, … */
  surface_key?: string | null;
  created_at: string;
  updated_at: string;
  /** Room (array, 0209) o DM fra agenti (oggetto `{dm:[a,b]}`, vedi $lib/chat-dm). Assente = thread normale. */
  room_agents?: unknown;
  /** Compaction (0116): everything created at or before summary_upto lives in `summary`. */
  summary?: string | null;
  summary_upto?: string | null;
  summary_message_count?: number | null;
  compacted_at?: string | null;
  compact_count?: number | null;
};


export async function createThread(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  title: string = 'Nuova chat',
  postId: string | null = null,
  agent: string | null = null,
  // I thread di squadra nascono con surface='team' + surface_key=<agentId>, per essere ritrovabili
  // senza ambiguità fra le normali chat dell'utente con lo stesso specialista.
  surface: string | null = null,
  surfaceKey: string | null = null,
  // La scelta di modello fatta nel composer PRIMA che il thread esistesse: senza, il thread nasce
  // senza preferenza e il picker torna al default appena l'app ci naviga sopra — da fuori sembra
  // che la selezione non abbia avuto effetto.
  model: unknown = null
): Promise<ChatThreadRow | null> {
  const { data } = await supabase
    .from('chat_threads')
    .insert({
      brand_id: brandId,
      user_id: userId,
      title,
      post_id: postId,
      agent,
      ...(surface ? { surface, surface_key: surfaceKey } : {}),
      ...(model ? { model } : {})
    })
    .select('*')
    .single();
  // Il thread nasce letto: un agente programmato ci scrive dentro mentre non c'è nessuno, e senza
  // questa riga il badge non avrebbe un "prima" con cui confrontarsi. Senza tabella non fa niente.
  if (data?.id) await markThreadRead(supabase, data.id as string, userId, data.created_at as string);
  return data;
}

/** Bind (or change) the specialized agent on a thread. Scoped to brand+user. */
export async function setThreadAgent(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  agent: string | null
): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ agent })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
}

/** Bind (or unbind) the custom agent whose brief drives this thread. */
export async function setThreadCustomAgent(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  customAgentId: string | null
): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ custom_agent_id: customAgentId })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
}

/**
 * Find (or lazily create) the single chat thread scoped to a post. 1:1 enforced by the partial unique
 * index (brand_id, user_id, post_id).
 */
export async function getOrCreatePostThread(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  postId: string,
  title: string = 'Editor'
): Promise<ChatThreadRow | null> {
  const { data: existing } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (existing) return existing;
  return createThread(supabase, brandId, userId, title, postId);
}

/**
 * The thread a maker surface works in: one per (user, surface, key), so a second turn on the same
 * motion video continues the same conversation instead of adding a sidebar row every time someone
 * types. A surface with nothing to key on yet passes a null key and gets a fresh thread, which
 * `bindSurfaceThread` points at the row once it has an id.
 *
 * Post-scoped editor threads stay out of the sidebar — they live inside PostEditor.
 */
export async function getOrCreateSurfaceThread(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    surface: string;
    key?: string | null;
    title: string;
    agent?: string | null;
  }
): Promise<ChatThreadRow | null> {
  const { brandId, userId, surface, key, title, agent } = opts;
  if (key) {
    const { data: existing } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('brand_id', brandId)
      .eq('user_id', userId)
      .eq('surface', surface)
      .eq('surface_key', key)
      .maybeSingle();
    if (existing) return existing;
  }
  const { data } = await supabase
    .from('chat_threads')
    .insert({
      brand_id: brandId,
      user_id: userId,
      title: title.slice(0, 120),
      agent: agent ?? null,
      surface,
      surface_key: key ?? null
    })
    .select('*')
    .single();
  return data;
}

/**
 * Give a keyless surface thread its key, once the thing it was making exists. Best-effort and racy on
 * purpose: if another turn already claimed the key the unique index refuses this one and the thread
 * stays keyless — a duplicate sidebar row is a much smaller problem than a failed creative turn.
 */
export async function bindSurfaceThread(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  key: string
): Promise<void> {
  const { error } = await supabase
    .from('chat_threads')
    .update({ surface_key: key })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .is('surface_key', null);
  if (error) console.warn(`[chat] surface thread bind failed: ${error.message}`);
}

export async function listThreads(
  supabase: SupabaseClient,
  brandId: string,
  userId: string
): Promise<ChatThreadRow[]> {
  const { data } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .is('post_id', null)
    .order('updated_at', { ascending: false });
  return data ?? [];
}

/**
 * L'anteprima dell'ultimo messaggio di ogni thread. Query A PARTE di proposito: la select condivisa
 * di `listThreads` non si tocca — una colonna nuova lì azzera ogni lettura della tabella finché la
 * migration non è applicata. Qui non serve nessuna migration: è una embed PostgREST su una FK che
 * esiste già. Il filtro tiene solo user e assistant non vuoti, perché un turno chiuso su un tool ha
 * content '' e farebbe un'anteprima muta. Se la query fallisce si torna una mappa vuota.
 */
export async function listThreadSnippets(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<Record<string, string>> {
  if (!threadIds.length) return {};
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, chat_messages(role, content)')
    .in('id', threadIds)
    .in('chat_messages.role', ['user', 'assistant'])
    .neq('chat_messages.content', '')
    .order('created_at', { referencedTable: 'chat_messages', ascending: false })
    .limit(1, { referencedTable: 'chat_messages' });
  if (error) {
    console.warn(`[chat] thread snippets failed: ${error.message}`);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ id: string; chat_messages?: Array<{ content: string }> }>) {
    const text = snippetText(row.chat_messages?.[0]?.content ?? '');
    if (text) out[row.id] = text;
  }
  return out;
}

/**
 * Un contenuto ridotto a UNA riga di anteprima. Il taglio si fa qui e non nel browser perché una
 * risposta dell'assistente può pesare decine di KB, e non vanno spedite tutte per mostrarne 140
 * caratteri.
 */
export function snippetText(raw: string, max = 140): string {
  let text = raw.split('<!--anomalia-attached-docs-->')[0];
  text = text
    .replace(/```[\s\S]*?```/g, ' ') // blocchi di codice
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // immagini
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link → testo
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Get a single thread by id, scoped to brand+user. */
export async function getThread(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string
): Promise<ChatThreadRow | null> {
  const { data } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function renameThread(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  title: string
): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
}

export async function setThreadModel(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string,
  model: unknown
): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ model, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
}

export async function deleteThread(
  supabase: SupabaseClient,
  threadId: string,
  brandId: string,
  userId: string
): Promise<void> {
  await supabase
    .from('chat_threads')
    .delete()
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
}

export async function touchThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<void> {
  await supabase
    .from('chat_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);
}


/**
 * Le parti del messaggio assistant da salvare dopo un run multi-step.
 *
 * Si raccolgono da TUTTI gli step: il payload di finish copre solo l'ULTIMO, che in un run con tool è
 * la risposta testuale, quindi salvarlo perdeva ogni tool call e stringificava le parti di reasoning.
 * L'ordine è quello in cui il modello le ha prodotte (testo → tool → testo), così la chat può
 * rigiocare il turno in ordine invece di mostrare prima tutti i tool e poi tutti i testi.
 */
export function assistantContentFromSteps(steps: any[], fallbackText?: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  // Ogni tool call alla sua risposta, così la UI può disegnare le card e `loadHistory` rigiocare la
  // fetta che il modello ha già letto.
  const outputByCallId = new Map<string, unknown>();
  for (const step of steps) {
    for (const r of step.toolResults ?? []) {
      if (r?.toolCallId) outputByCallId.set(r.toolCallId, unwrapToolOutput(r.output ?? r.result));
    }
    for (const p of step.content ?? []) {
      if (p?.type === 'tool-result' && p.toolCallId) {
        outputByCallId.set(p.toolCallId, unwrapToolOutput(p.output ?? p.result));
      }
      if (p?.type === 'tool-call' && p.toolCallId && p.output !== undefined) {
        outputByCallId.set(p.toolCallId, unwrapToolOutput(p.output));
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolPart = (tc: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const part: any = { type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input ?? tc.args };
    const storedOut = outputByCallId.get(tc.toolCallId);
    if (storedOut !== undefined) part.output = storedOut;
    const preview = previewFromOutput(tc.toolName, outputByCallId.get(tc.toolCallId), part.input);
    if (preview) part.preview = preview;
    // I tool qui sotto disegnano una card in chat, e il loro payload viaggia nel `tool_calls` JSON
    // perché la compattazione del partial butta gli output: senza, la card sparisce dai turni lunghi.
    if (tc.toolName === 'show_setup_checklist') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = outputByCallId.get(tc.toolCallId) as any;
      if (out && Array.isArray(out.items)) part.checklist = out;
    }
    if (tc.toolName === 'offer_upgrade') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = outputByCallId.get(tc.toolCallId) as any;
      if (out && (Array.isArray(out.offers) || out.is_top)) part.upgrade = out;
    }
    if (tc.toolName === 'propose_app_connection') {
      const connect = normalizeConnectPayload(outputByCallId.get(tc.toolCallId));
      if (connect) part.connect = connect;
    }
      // Il codice del device login è pubblico per design; il token non è MAI nell'output del tool,
      // quindi nemmeno qui.
    if (tc.toolName === 'sandbox_device_login') {
      const deviceLogin = normalizeDeviceLoginPayload(outputByCallId.get(tc.toolCallId));
      if (deviceLogin) part.deviceLogin = deviceLogin;
    }
    if (tc.toolName === 'show_team') {
      const team = normalizeTeamPayload(outputByCallId.get(tc.toolCallId));
      if (team) part.team = team;
    }
      // `normalizeMediaPayload` ricontrolla che ogni URL sia nostro: qui passa quello che il tool ha
      // già accettato, e resta vero comunque.
    if (
      tc.toolName === 'show_media' ||
      tc.toolName === 'motion_stills' ||
      tc.toolName === 'render_stills'
    ) {
      const media = normalizeMediaPayload(outputByCallId.get(tc.toolCallId));
      if (media) part.media = media;
    }
      // La riga di sistema del ciclo di vita di una routine deve restare leggibile mesi dopo, col
      // brief di allora dentro.
    if (
      tc.toolName === 'create_scheduled_agent' ||
      tc.toolName === 'update_scheduled_agent' ||
      tc.toolName === 'set_scheduled_agent_enabled'
    ) {
      const routineEvent = normalizeRoutineEvent(outputByCallId.get(tc.toolCallId));
      if (routineEvent) part.routineEvent = routineEvent;
    }
    if (tc.toolName === 'message_agent') {
      // Come le altre card: la compattazione butta gli output, e ChatDmChip deve sopravvivere.
      const dmSends = dmSendsFromOutput(outputByCallId.get(tc.toolCallId));
      if (dmSends.length) part.dmSends = dmSends;
    }
    if (tc.toolName === 'propose_open_tab') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = outputByCallId.get(tc.toolCallId) as any;
      if (out && typeof out.href === 'string' && typeof out.path === 'string') {
        part.openTab = { path: out.path, href: out.href, reason: out.reason ?? null };
      }
    }
    if (tc.toolName === 'ask_user_questions') {
      const out = outputByCallId.get(tc.toolCallId) ?? tc.input ?? tc.args;
      const normalized = normalizeQuestionsPayload(out);
      if (normalized) part.questions = normalized.questions;
    }
      // Il payload della proposta viaggia qui perché il percorso di CONFERMA lo rilegge da qui: il
      // browser posta un thread id e un tool call id, mai l'agente che vorrebbe creare.
    if (tc.toolName === 'propose_custom_agent') {
      const proposal = normalizeAgentProposal(outputByCallId.get(tc.toolCallId));
      if (proposal) part.agentProposal = proposal;
    }
      // Il markdown del piano resta in `brand_documents`: qui viaggia solo il puntatore.
    if (tc.toolName === 'propose_plan') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = outputByCallId.get(tc.toolCallId) as any;
      if (out && typeof out.plan_id === 'string') {
        part.plan = { id: out.plan_id, title: out.title ?? '', summary: out.summary ?? null };
      }
    }
    return part;
  };

  // Un turno chiude SOLO con `reply` o `ask_user` (il contratto del tool). Quando è così il messaggio
  // vero non è mai il testo di uno step — vive negli argomenti del tool di chiusura e arriva qui come
  // `fallbackText`. Ogni testo scritto lungo la strada è un appunto di lavoro, non una battuta: senza
  // questo, tre annunci di servizio in fila diventavano tre bolle identiche.
  const closesExplicitly = steps.some(
    (step) =>
      (step?.toolCalls ?? []).some((tc: { toolName?: string }) => tc?.toolName === 'reply' || tc?.toolName === 'ask_user') ||
      (step?.content ?? []).some(
        (p: { type?: string; toolName?: string }) => p?.type === 'tool-call' && (p.toolName === 'reply' || p.toolName === 'ask_user')
      )
  );

  // Si cammina il `content` ordinato di ogni step; quelli che non ce l'hanno tengono l'ordine
  // naturale. Il reasoning va letto QUI e non raccolto a monte da tutti gli step: incollato in testa
  // diventava un blob unico sopra la prima parola, invece di restare dove è successo. Le parti
  // adiacenti si uniscono, come nello stream live (chat-session.ts).
  for (const step of steps) {
    const ordered = Array.isArray(step?.content) && step.content.length
      ? step.content
      : [
          ...(step?.reasoningText ? [{ type: 'reasoning', text: step.reasoningText }] : []),
          ...(step?.text ? [{ type: 'text', text: step.text }] : []),
          ...((step?.toolCalls ?? []).map((tc: unknown) => ({ ...(tc as object), type: 'tool-call' })))
        ];
    for (const p of ordered) {
      if (p?.type === 'text') {
        const text = String(p.text ?? '').trim();
        if (text) content.push({ type: 'text', text });
      } else if (p?.type === 'reasoning') {
        const text = String(p.text ?? '').trim();
        if (!text) continue;
        const last = content[content.length - 1];
        if (last?.type === 'reasoning') last.text = `${last.text}\n${text}`;
        else content.push({ type: 'reasoning', text });
      } else if (p?.type === 'tool-call') {
        content.push(toolPart(p));
      }
    }
  }
  // UNA sola bolla per turno. Quale testo è la risposta e quale è un appunto:
  //  - turno chiuso su reply/ask_user → NESSUN testo di step lo è, la risposta vive negli
  //    argomenti del tool di chiusura (`fallbackText`) e va sempre in coda;
  //  - turno finito per esaurimento passi (`reason=completed`, nessun reply) → non c'è tool di
  //    chiusura da cui leggere, quindi l'ULTIMO testo scritto È la risposta e tutto quello prima
  //    resta appunto. Era il balbettio residuo: due bolle visibili in fila.
  // Tutto ciò che non è la risposta viene declassato ad appunto, e gli appunti adiacenti si
  // uniscono in un solo segmento (stessa regola del reasoning vero).
  const textIdx = content.map((p, i) => (p.type === 'text' ? i : -1)).filter((i) => i >= 0);
  const replyIdx = closesExplicitly ? -1 : textIdx.at(-1) ?? -1;
  for (const i of textIdx) if (i !== replyIdx) content[i] = { type: 'reasoning', text: content[i].text };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged: any[] = [];
  for (const p of content) {
    const last = merged[merged.length - 1];
    if (p.type === 'reasoning' && last?.type === 'reasoning') last.text = `${last.text}\n${p.text}`;
    else merged.push(p);
  }
  if (replyIdx < 0 && fallbackText?.trim()) merged.push({ type: 'text', text: fallbackText.trim() });
  return merged;
}

const TOOL_RESULT_OUTPUT_TYPES = new Set([
  'text',
  'json',
  'error-text',
  'error-json',
  'execution-denied',
  'content'
]);

/** Persist the raw execute() return, not the SDK `{type,value}` wrapper. */
function unwrapToolOutput(output: unknown): unknown {
  if (output && typeof output === 'object' && 'type' in output && 'value' in output) {
    const t = (output as { type: string }).type;
    if (TOOL_RESULT_OUTPUT_TYPES.has(t)) return (output as { value: unknown }).value;
  }
  return output;
}

function toToolResultOutput(output: unknown): ToolResultPart['output'] {
  if (output && typeof output === 'object' && 'type' in output) {
    const t = (output as { type: string }).type;
    if (TOOL_RESULT_OUTPUT_TYPES.has(t)) return output as ToolResultPart['output'];
  }
  return typeof output === 'string'
    ? { type: 'text', value: output }
    : { type: 'json', value: (output === undefined ? null : output) as never };
}

function asContentParts(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isStoredToolCall(
  p: unknown
): p is { type?: string; toolCallId?: string; toolName: string; input?: unknown; output?: unknown; status?: string } {
  if (!p || typeof p !== 'object') return false;
  const rec = p as { type?: string; toolName?: unknown };
  return rec.type !== 'text' && typeof rec.toolName === 'string' && !!rec.toolName;
}

const READ_ONLY_TOOL_NAME = /(^|_)(read|list|get|search|show|fetch|check)(_|$)/;

/**
 * The synthetic result for a stored tool call that never got one — a turn killed mid-tool by the
 * platform, a crash, a deploy. The provider rejects an open call, but DROPPING the pair made the
 * next turn redo the work: regenerate paid media, re-render a video, replay an external write.
 * An interrupted call is not discarded, it is remembered as uncertain.
 */
function interruptedToolResult(call: { toolCallId: string; toolName: string; status?: string }): ToolResultPart {
  const value =
    call.status === 'done'
      ? `${call.toolName} completed, but the turn was interrupted before its result was recorded. Do not redo the work — re-read the current state if you need its outcome.`
      : READ_ONLY_TOOL_NAME.test(call.toolName)
        ? `${call.toolName} was interrupted before returning and was not replayed. It only reads, so you can simply call it again if you still need it.`
        : `${call.toolName} was interrupted before returning: outcome unknown, and it was NOT replayed. This tool has effects (it creates, edits, publishes or spends credits) — verify the current state before running it again.`;
  return {
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: { type: 'text', value }
  };
}

/**
 * Rebuild the AI SDK messages for one DB row, including tool-call / tool-result pairs. UI-only fields
 * stay in `tool_calls` for the bubble and are stripped here; a tool call without a persisted `output`
 * keeps its pair via a synthetic uncertain result, because the SDK rejects an open call.
 */
async function pruneUnreachableMedia(messages: ModelMessage[]): Promise<void> {
  // One pass over the whole history in parallel: awaiting per message serialised a 5s timeout per
  // dead link, which on a long thread cost more than the model call it was protecting.
  await Promise.all(
    messages.map(async (m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return;
      const media = m.content.filter(
        (p): p is MediaPart => p.type === 'image' || p.type === 'file'
      );
      // A data: URL carries its own bytes — there is nothing to reach.
      const remote = media.filter((p) => !(p.type === 'image' && typeof p.image === 'string'));
      if (!remote.length) return;
      const live = new Set(await reachableMediaParts(remote));
      m.content = m.content.filter(
        (p) => !remote.includes(p as MediaPart) || live.has(p as MediaPart)
      );
    })
  );
}

/**
 * What the resolved model can actually be handed. Defaults to 'none' everywhere so a caller that has
 * not checked its model keeps text-only behaviour: an openai-compatible provider throws outright on a
 * video file part, and one pasted .mp4 would break every later turn of that thread.
 */
export type HistoryMedia = 'none' | 'images' | 'images+video';

export function messagesFromRow(
  row: {
    role: string;
    content?: string | null;
    tool_calls?: unknown;
    attachments?: unknown;
  },
  media: HistoryMedia = 'none'
): ModelMessage[] {
  if (row.role === 'user') {
    const urls = Array.isArray(row.attachments)
      ? (row.attachments as unknown[]).map(String).filter(Boolean)
      : [];
    const text = row.content ?? '';
      // Real parts, not a flattened text line — but only what this model can take.
    const parts =
      media === 'none'
        ? []
        : (() => {
            const all = [...attachmentParts(urls), ...mediaPartsFor(mediaUrlsIn(text))];
            return media === 'images' ? withoutVideo(all) : all;
          })();
    if (parts.length) {
      const listed = urls.length ? `${text}\n[attached: ${urls.join(' ')}]` : text;
      return [{ role: 'user', content: [{ type: 'text', text: listed }, ...parts] }];
    }
    const content = urls.length ? `${text}\n[attached urls: ${urls.join(' ')}]` : text;
    return content ? [{ role: 'user', content }] : [];
  }
  if (row.role !== 'assistant') return [];

  const parts = asContentParts(row.tool_calls);
  const text = row.content?.trim() ?? '';
  const hasToolParts = parts.some(isStoredToolCall);
  if (!hasToolParts) {
    return text ? [{ role: 'assistant', content: text }] : [];
  }

  const out: ModelMessage[] = [];
  let assistantParts: Array<TextPart | ToolApprovalRequest | ToolCallPart> = [];
  let resultParts: ToolResultPart[] = [];
  let partsHaveText = false;
  const approvalCallIds = new Set(
    parts
      .filter((part): part is { type: 'tool-approval-request'; toolCallId: string } => {
        return !!part && typeof part === 'object' && (part as { type?: string }).type === 'tool-approval-request' && typeof (part as { toolCallId?: unknown }).toolCallId === 'string';
      })
      .map((part) => part.toolCallId)
  );

  const flush = () => {
    if (assistantParts.length) {
      out.push({ role: 'assistant', content: assistantParts });
      assistantParts = [];
    }
    if (resultParts.length) {
      out.push({ role: 'tool', content: resultParts });
      resultParts = [];
    }
  };

  for (const p of parts) {
    if (p && typeof p === 'object' && (p as { type?: string }).type === 'text') {
      const t = String((p as { text?: string }).text ?? '').trim();
      if (!t) continue;
      if (resultParts.length) flush();
      assistantParts.push({ type: 'text', text: t });
      partsHaveText = true;
      continue;
    }
    if (p && typeof p === 'object' && (p as { type?: string }).type === 'tool-approval-request') {
      if (resultParts.length) flush();
      assistantParts.push(p as ToolApprovalRequest);
      continue;
    }
    if (!isStoredToolCall(p) || !p.toolCallId) continue;
    if (TERMINAL_TOOL_NAMES.includes(p.toolName)) continue;
    assistantParts.push({
      type: 'tool-call',
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      input: p.input ?? {}
    });
    if (!approvalCallIds.has(p.toolCallId)) {
      resultParts.push(
        p.output === undefined
          ? interruptedToolResult({ toolCallId: p.toolCallId, toolName: p.toolName, status: p.status })
          : {
              type: 'tool-result',
              toolCallId: p.toolCallId,
              toolName: p.toolName,
              output: toToolResultOutput(p.output)
            }
      );
    }
  }

  flush();
  if (text && !partsHaveText) {
    out.push({ role: 'assistant', content: text });
  }
  return out;
}

  // Un'anteprima compatta estratta dall'output di un tool. Piccola di proposito: viaggia dentro la
  // colonna JSON `tool_calls`.
export type ChatPostPreview = {
  post_id: string;
  platform: string;
  caption: string;
  media_url: string | null;
  media_urls?: string[];
  format?: string;
  status: string;
  /** 'rendering' while a clip is produced out-of-band — media_url is the cover standing in. */
  video_render_status?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function previewFromOutput(toolName: string, output: any, input?: any): ChatPostPreview[] | null {
  if (!output || typeof output !== 'object' || output.error) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toPreview = (p: any): ChatPostPreview => {
    const urls = Array.isArray(p.media_urls)
      ? (p.media_urls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u)
      : [];
    const mediaUrl =
      (typeof p.media_url === 'string' && p.media_url) ||
      (typeof p.image_url === 'string' && p.image_url) ||
      urls[0] ||
      null;
    return {
      post_id: p.post_id ?? p.id,
      platform: p.platform ?? '',
      caption: typeof p.caption === 'string' ? p.caption : '',
      media_url: mediaUrl,
      media_urls: urls.length > 1 ? urls : undefined,
      format: p.format,
      status: p.status ?? 'pending_user',
      // Only when set, so this stays absent on the overwhelming majority of previews that ride
      // inside the tool_calls JSON column.
      ...(p.video_render_status ? { video_render_status: p.video_render_status as string } : {})
    };
  };
  /** Skip blank cards — pending shells with no caption/media only clutter the transcript. */
  const isRenderable = (p: ChatPostPreview) =>
    !!p.post_id && (!!p.caption.trim() || !!p.media_url || !!(p.media_urls && p.media_urls.length));

  if ((toolName === 'create_post' || toolName === 'cross_post') && output.success && output.post_id) {
    const preview = toPreview(output);
    return isRenderable(preview) ? [preview] : null;
  }
  if (
    (toolName === 'generate_image' ||
      toolName === 'design_graphic' ||
      toolName === 'replace_source' ||
      toolName === 'write_source') &&
    output.success &&
    !output.did_not_change_post &&
    (output.post_id || output.image_url || output.media_url)
  ) {
    const preview = toPreview({ ...output, post_id: output.post_id });
    return isRenderable(preview) ? [preview] : null;
  }
    // Leggere è privato, mostrare è una decisione: un `read_posts` di contesto non disegna niente.
    // Solo la chiamata che ha chiesto di mostrarli lo fa — sopra è automatico perché lì la card È il
    // lavoro appena fatto.
  if (toolName === 'read_posts' && input?.show_to_user === true && Array.isArray(output.posts)) {
    const previews = output.posts
      .map(toPreview)
      .filter(isRenderable)
      .slice(0, 12);
    return previews.length ? previews : null;
  }
  return null;
}

export type SaveMessageOpts = {
  /** Redo: link the new assistant row to the superseded reply it replaces. */
  regeneratedFrom?: string;
  durationMs?: number;
  model?: string;
  tier?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Sources derived from tool results this turn (jsonb on the row). */
  sources?: unknown[];
  /** Image URLs the user attached to this turn — shown on their bubble on every reload. */
  attachments?: string[];
    /**
     * CHI ha parlato in una chat di gruppo: la chiave del membro (`motion`, `custom:<uuid>`). Finisce
     * in `name`, che su una riga assistant è sempre stato vuoto, invece che in una colonna nuova in
     * tre select condivise — che è il modo in cui una migration non applicata azzera la lettura di
     * tutta la chat. Vuoto = thread a un agente solo.
     *
     * Nei DM fra agenti vale anche sulle righe `user`: lì la riga user è il messaggio dell'agente che
     * ha scritto, e senza firma il transcript non saprebbe di chi è la battuta.
     */
  speaker?: string;
};

/**
 * Save new messages to `chat_messages`. Returns the inserted row ids in the order given — la memoria
 * che punta al messaggio che l'ha prodotta ha bisogno dell'id vero, non di un «ultima riga assistant».
 *
 * ALZA se l'insert non è andato dentro. postgrest-js non lancia mai: riga troppo grande, connessione
 * caduta, policy che nega, tutto torna come `{ error }` — e con un `console.error` ogni chiamante
 * credeva di aver salvato, quindi i ripieghi scritti apposta (`closeSurfaceTurn`,
 * `persistFailedPartial`) non partivano mai.
 *
 * E l'inverso conta quanto questo: DOPO l'insert non si alza più. L'insert è atomico, quindi «ha
 * alzato» significa una cosa sola — la riga non è entrata — e chi riprova sa di non duplicare. Un
 * `touchThread` o un broadcast andati male non valgono una seconda risposta in chat.
 */
export async function saveMessages(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  messages: ModelMessage[],
  threadId: string,
  opts?: SaveMessageOpts
): Promise<string[]> {
  if (!messages.length) return [];

  const rows = messages.map((m) => {
    const row: Record<string, unknown> = {
      brand_id: brandId,
      user_id: userId,
      thread_id: threadId,
      role: m.role,
      content: ''
    };
    if (m.role === 'assistant') {
      if (opts?.regeneratedFrom) row.regenerated_from = opts.regeneratedFrom;
      if (opts?.durationMs != null) row.duration_ms = opts.durationMs;
      if (opts?.model) row.model = opts.model;
      if (opts?.tier) row.tier = opts.tier;
      if (opts?.inputTokens != null) row.input_tokens = opts.inputTokens;
      if (opts?.outputTokens != null) row.output_tokens = opts.outputTokens;
      if (opts?.sources?.length) row.sources = opts.sources;
      if (opts?.speaker) row.name = opts.speaker;
    }

    if (m.role === 'assistant') {
        // Gli allegati valgono anche per l'assistant: un `attach` vero consegna file, e il video
        // renderizzato DEVE stare nella bolla, non solo nel testo come link.
      if (opts?.attachments?.length) row.attachments = opts.attachments;
      if (typeof m.content === 'string') {
        row.content = m.content;
      } else if (Array.isArray(m.content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts = m.content as any[];
        const textParts = parts.filter((p) => p.type === 'text');
        row.content = textParts.map((p) => p.text ?? '').join('\n\n');
        const reasoningParts = parts.filter((p) => p.type === 'reasoning');
        if (reasoningParts.length) {
          row.reasoning = reasoningParts.map((p) => p.text ?? '').join('\n');
        }
          // Tool call e segmenti di testo, nell'ordine in cui sono stati prodotti: è ciò che permette
          // alla UI di rigiocare il turno. `content` resta il testo unito per copia/compattazione/
          // contesto, così nient'altro deve sapere dell'ordinamento.
        const toolParts = parts.filter((p) => p.type === 'tool-call');
        if (toolParts.length) {
          row.tool_calls = parts.filter((p) => p.type === 'tool-call' || p.type === 'text');
        }
      }
    } else if (m.role === 'tool') {
      if (typeof m.content === 'string') {
        row.content = m.content;
      } else if (Array.isArray(m.content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts = m.content as any[];
        row.content = JSON.stringify(parts);
        if (parts[0]) {
          if (parts[0].toolCallId) row.tool_call_id = parts[0].toolCallId;
          if (parts[0].toolName) row.name = parts[0].toolName;
        }
      }
    } else {
      if (m.role === 'user' && opts?.attachments?.length) row.attachments = opts.attachments;
      // DM fra agenti: la riga user è la battuta dell'agente mittente — firmata come le assistant.
      if (m.role === 'user' && opts?.speaker) row.name = opts.speaker;
      if (typeof m.content === 'string') {
        row.content = m.content;
      } else if (Array.isArray(m.content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row.content = (m.content as any[])
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');
      }
    }

    return row;
  });

  // Postgres restituisce le righe inserite nell'ordine in cui sono state fornite.
  const { data: inserted, error } = await supabase
    .from('chat_messages')
    .insert(rows)
    .select('*');
  if (error) throw new Error(`[saveMessages] insert failed: ${error.message}`);

  // Da qui in giù è tutto accessorio e va dentro un catch proprio: la riga c'è già, e un'eccezione
  // farebbe credere al chiamante che il messaggio sia da riscrivere.
  try {
    await touchThread(supabase, threadId);

    // Chi scrive ha visto tutto quello che c'era prima: il proprio messaggio non accende il badge sul
    // proprio thread. Solo per un batch di soli messaggi utente — se dentro c'è anche la risposta
    // dell'assistente (turno salvato a tab chiusa) quella non l'ha ancora letta nessuno.
    if (messages.every((m) => m.role === 'user')) {
      await markThreadRead(supabase, threadId, userId);
    }

    // Imbuto unico per ogni messaggio scritto ovunque (stream live, worker, salvataggio parziale,
    // CLI): è perché nessun chiamante deve ricordarsi di notificare, e perché una risposta prodotta
    // senza browser attaccato arriva comunque in ogni tab aperta.
    if (inserted?.length) {
      const { broadcastToBrand } = await import('$lib/server/realtime');
      void broadcastToBrand(brandId, {
        event: 'thread-changed',
        payload: { threadId, hasAssistantReply: messages.some((m) => m.role === 'assistant') }
      });
    }
  } catch (e) {
    console.warn('[saveMessages] post-insert best-effort failed:', e instanceof Error ? e.message : e);
  }

  return (inserted ?? []).map((r) => r.id as string);
}

/**
 * Newest-first DB rows → chronological order for the model / UI.
 * Ascending + limit kept the *oldest* N messages — the "AI forgot" bug.
 */
export function chronologicalTail<T>(newestFirst: T[], limit: number): T[] {
  return newestFirst.slice(0, limit).reverse();
}

/**
 * La coda di una lista GIÀ cronologica. `chronologicalTail` pretende il contrario — la query la
 * ordina `created_at desc` — e passargli la proiezione del log, che esce in ordine di `seq`,
 * capovolgeva l'intera conversazione: la risposta sopra la domanda a cui rispondeva.
 */
export function newestTail<T>(oldestFirst: T[], limit: number): T[] {
  return limit >= oldestFirst.length ? oldestFirst : oldestFirst.slice(-limit);
}

function visibleInUi(row: { role?: unknown }): boolean {
  return row.role !== 'system' && row.role !== 'tool';
}

/**
 * Una coda che comincia a metà conversazione può aprirsi su un turno assistant, che Gemini rifiuta
 * (gli openai-compatible lo tollerano). Costa meno ripartire sempre da un turno user che ramificare
 * per provider.
 */
export function dropLeadingAssistant<T extends { role: string }>(messages: T[]): T[] {
  const first = messages.findIndex((m) => m.role === 'user');
  // No user turn at all in the window → nothing usable to prime the model with.
  return first === -1 ? [] : messages.slice(first);
}

export type ChatMessageUiRow = {
  id: string;
  role: string;
  content: string;
  reasoning?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  name?: string | null;
  created_at?: string;
  superseded?: boolean;
  regenerated_from?: string | null;
  duration_ms?: number | null;
  model?: string | null;
  tier?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  feedback?: number | null;
  sources?: unknown;
  /** Images the user attached to this turn (public URLs), so the bubble still shows them. */
  attachments?: unknown;
};

/**
 * Marca un messaggio e tutti quelli dopo, nello stesso thread, come superati (redo / resend / edit).
 * Torna la riga bersaglio, o null se non trovata o non di questo utente.
 */
export async function supersedeFromMessage(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  messageId: string
): Promise<{ id: string; role: string; content: string; created_at: string } | null> {
  const { data: target, error: selectError } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at, thread_id')
    .eq('id', messageId)
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('superseded', false)
    .maybeSingle();

  // «Nessuna riga» e «la query è fallita» tornano entrambi null, e il chiamante mappa null su un 404
  // che nasconderebbe un errore di RLS.
  if (selectError) console.error('[supersedeFromMessage] select', selectError.message);
  if (!target) return null;

  const { error } = await supabase
    .from('chat_messages')
    .update({ superseded: true })
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('superseded', false)
    .gte('created_at', target.created_at);

  if (error) {
    console.error('[supersedeFromMessage]', error.message);
    return null;
  }

  return target;
}

/**
 * La storia del thread come ModelMessage[]: gli ULTIMI `limit` messaggi vivi (non superati). Se il
 * thread è stato compattato, tutto fino a `summary_upto` diventa un system summary in testa. Le righe
 * assistant rigiocano le coppie tool-call/tool-result (la fetta già letta, non il file).
 */
export async function loadHistory(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  limit: number = CHAT_HISTORY_LIMIT,
  media: HistoryMedia = 'none'
): Promise<ModelMessage[]> {
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('summary, summary_upto, summary_message_count')
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .maybeSingle();

  const summary: ModelMessage[] = thread?.summary
    ? [
        {
          role: 'system',
          content: summaryBlock(thread.summary, thread.summary_message_count ?? 0)
        }
      ]
    : [];

  const eventRows = await loadThreadEvents(supabase, threadId);
  const eventMessages = eventRows?.length
    ? threadMessageRows(eventRows)?.filter((row) => row.role !== 'system' && row.role !== 'tool') ?? null
    : null;
  if (eventMessages) {
    const filtered = thread?.summary_upto
      ? eventMessages.filter((row) => String(row.created_at ?? '') > thread.summary_upto)
      : eventMessages;
    const messages: ModelMessage[] = [];
    for (const row of chronologicalTail(filtered, limit)) {
      messages.push(...messagesFromRow(row as Parameters<typeof messagesFromRow>[0], media));
    }
    if (media !== 'none') await pruneUnreachableMedia(messages);
    return [...summary, ...dropLeadingAssistant(messages)];
  }

  let query = supabase
    .from('chat_messages')
    .select('role, content, tool_calls, tool_call_id, name, created_at, attachments')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('superseded', false);
    // Il confine è `summary_upto` DA SOLO. Pretendendo anche un `summary` non nullo, un confine senza
    // riassunto — cioè `/clear` — non tagliava niente. Le due colonne dicono due cose diverse:
    // `summary_upto` è dove comincia la memoria del modello, `summary` è cosa si porta dietro da
    // prima, e può legittimamente non esserci.
  if (thread?.summary_upto) {
    query = query.gt('created_at', thread.summary_upto);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

    // Un errore inghiottito qui si legge come «l'AI ha dimenticato tutto», senza traccia.
  if (error) console.error('[loadHistory]', error.message);

  if (!data?.length) return summary;

  const messages: ModelMessage[] = [];

  for (const row of chronologicalTail(data, limit)) {
    messages.push(...messagesFromRow(row, media));
  }

    // Le parti media puntano a URL che il provider scarica da sé, quindi un solo link morto farebbe
    // fallire il turno intero.
  if (media !== 'none') await pruneUnreachableMedia(messages);

    // Il riassunto va in testa solo DOPO il taglio dell'assistant iniziale, che cerca il primo turno
    // *user* e altrimenti se lo mangerebbe.
  return [...summary, ...dropLeadingAssistant(messages)];
}

async function chatMessagesFallbackForUI(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  limit: number
): Promise<ChatMessageUiRow[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(
      'id, role, content, reasoning, tool_calls, tool_call_id, name, created_at, regenerated_from, duration_ms, model, tier, input_tokens, output_tokens, feedback, sources, attachments'
    )
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) console.error('[loadHistoryForUI]', error.message);
  return chronologicalTail(data ?? [], limit);
}

/** Come loadHistory, ma per la UI: include tool call e tool result. */
export async function loadHistoryForUI(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  limit: number = 100
): Promise<ChatMessageUiRow[]> {
  const eventRows = await loadThreadEvents(supabase, threadId);
  if (eventRows?.length) {
    const eventMessages = threadMessageRows(eventRows);
    if (eventMessages) {
      return newestTail(eventMessages.filter(visibleInUi), limit) as ChatMessageUiRow[];
    }
  }

  return chatMessagesFallbackForUI(supabase, brandId, userId, threadId, limit);
}

export type ThreadUiHistory = {
  messages: ChatMessageUiRow[];
  liveProgress: Record<string, ThreadProgress>;
  eventCursor: number;
};

export async function loadThreadUiHistory(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  limit: number = 100
): Promise<ThreadUiHistory> {
  const eventRows = await loadThreadEvents(supabase, threadId);
  if (eventRows?.length) {
    const projection = threadProjectionRows(eventRows);
    if (projection) {
      return {
        messages: newestTail(projection.messages.filter(visibleInUi), limit) as ChatMessageUiRow[],
        liveProgress: projection.progress,
        eventCursor: projection.cursor
      };
    }
  }

  return {
    messages: await chatMessagesFallbackForUI(supabase, brandId, userId, threadId, limit),
    liveProgress: {},
    eventCursor: 0
  };
}

/** Tutta la storia di un brand+utente, senza filtro sul thread — per la pagina di riepilogo. */
export async function loadAllHistoryForUI(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  limit: number = 100
): Promise<ChatMessageUiRow[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(
      'id, role, content, reasoning, tool_calls, tool_call_id, name, created_at, regenerated_from, duration_ms, model, tier, input_tokens, output_tokens, feedback, sources, attachments'
    )
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) console.error('[loadAllHistoryForUI]', error.message);
  return chronologicalTail(data ?? [], limit);
}

/**
 * `/clear` — il SECONDO scrittore sul confine della compattazione: sposta `summary_upto` all'ultimo
 * messaggio e non lascia niente dietro. Stessa meccanica della compattazione, altra intenzione, e in
 * entrambi i casi `chat_messages` non perde una riga (a differenza di `clearHistory` qui sotto, che
 * CANCELLA).
 *
 * La riga di avviso non è decorazione: senza, il contesto si svuoterebbe in silenzio e l'unico segno
 * sarebbe un'AI che ha dimenticato tutto senza dire perché. Passa da `saveMessages` apposta, così il
 * push realtime la porta a ogni sessione aperta sul thread.
 *
 * Torna `false` quando non c'era niente da azzerare: niente confine, niente riga.
 */
export async function clearThreadContext(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string,
  notice: string
): Promise<boolean> {
    // Il confine è l'ULTIMO messaggio vivo letto dal DB, non `new Date()`: `created_at` lo scrive
    // Postgres, e un orologio di funzione avanti di un secondo taglierebbe fuori anche il successivo.
  const { data: last } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId)
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (!last?.created_at) return false;

  const { error } = await supabase
    .from('chat_threads')
    .update({ summary: null, summary_upto: last.created_at, summary_message_count: 0 })
    .eq('id', threadId)
    .eq('brand_id', brandId)
    .eq('user_id', userId);
  if (error) {
    console.error('[clearThreadContext]', error.message);
    return false;
  }

  await saveMessages(supabase, brandId, userId, [{ role: 'assistant', content: notice }], threadId);
  return true;
}

/** Cancella davvero i messaggi di un thread. */
export async function clearHistory(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  threadId: string
): Promise<void> {
  await supabase
    .from('chat_messages')
    .delete()
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .eq('thread_id', threadId);
}
