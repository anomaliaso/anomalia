import { toolCallsOf, parseToolCalls as parseAllParts } from '$lib/chat-parts';
import { parseChatSources, type ChatSource } from '$lib/chat-sources';
import { attachedDocNamesFromContent } from '$lib/chat-documents';
import type { ChatQuestion } from '$lib/chat-questions';

export type PostPreview = { post_id: string; platform: string; caption: string; media_url: string | null; media_urls?: string[]; format?: string; status: string };

export type ChatMessage = {
  id?: string;
  /** Row a redo must supersede from — the first row of a consolidated bubble, not the text row. */
  redo_from_id?: string;
  role: string;
  content: string;
  reasoning?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  name?: string | null;
  duration_ms?: number | null;
  model?: string | null;
  tier?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  feedback?: 1 | -1 | null;
  sources?: ChatSource[];
  /** Images the user attached to this turn (public URLs). */
  attachments?: string[];
  /** Filenames of documents attached this turn. */
  documents?: string[];
  /** Only for placing the compaction divider — everything else keys off the array index. */
  created_at?: string;
};

/** Stesso shape di ChatColumn: i fotogrammi di motion_stills vivono in chat_artifacts. */
export type ChatArtifactUi = {
  id: string;
  tool_call_id?: string | null;
  title: string;
  description?: string | null;
  kind: string;
  file_name: string;
  bytes?: number | null;
  preview?: string | null;
  url?: string | null;
  created_at?: string;
};

export type SetupChecklist = { items: Array<{ key: string; done: boolean; href: string }>; doneCount: number; total: number };
export type UpgradeOffer = { current_label: string | null; is_top: boolean; offers: Array<{ key: string; label: string }>; slug: string };
export type OpenTabProposal = { path: string; href: string; reason?: string | null };
export type PlanProposal = { id: string; title: string; summary?: string | null };
export type ToolCallUi = {
  toolCallId: string;
  toolName: string;
  /** Params in, result out — what an opened chip shows (chat-tool-detail.ts). */
  input?: unknown;
  output?: unknown;
  preview?: PostPreview[];
  checklist?: SetupChecklist;
  upgrade?: UpgradeOffer;
  openTab?: OpenTabProposal;
  questions?: ChatQuestion[];
  /** propose_custom_agent — arricchito al persist, `output` grezzo dal vivo. */
  agentProposal?: unknown;
  /** propose_app_connection — arricchito al persist, `output` grezzo dal vivo. */
  connect?: unknown;
  deviceLogin?: unknown;
  team?: unknown;
  routineEvent?: unknown;
  plan?: PlanProposal;
};

/** Solo i tool call: i segmenti di testo vivono nello stesso JSON (chat-parts.ts). */
export const parseToolCalls = (raw: unknown): ToolCallUi[] => toolCallsOf(raw) as ToolCallUi[];

export function mapMsg(m: {
  id?: string;
  role: string;
  content: string;
  reasoning?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  name?: string | null;
  duration_ms?: number | null;
  model?: string | null;
  tier?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  feedback?: number | null;
  sources?: unknown;
  attachments?: unknown;
  created_at?: string;
}): ChatMessage {
  const content = typeof m.content === 'string' ? m.content : '';
  return {
    id: m.id,
    created_at: m.created_at,
    role: m.role,
    content,
    reasoning: m.reasoning,
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
    name: m.name,
    duration_ms: m.duration_ms ?? null,
    model: m.model ?? null,
    tier: m.tier ?? null,
    input_tokens: m.input_tokens ?? null,
    output_tokens: m.output_tokens ?? null,
    // Rami letterali: confrontare un `number` non restringe a 1 | -1.
    feedback: m.feedback === 1 ? 1 : m.feedback === -1 ? -1 : null,
    sources: parseChatSources(m.sources),
    attachments: Array.isArray(m.attachments) ? (m.attachments as string[]) : undefined,
    documents: m.role === 'user' ? attachedDocNamesFromContent(content) : undefined
  };
}

export function planIdsIn(list: ChatMessage[]): string[] {
  return list.flatMap((m) =>
    parseToolCalls(m.tool_calls)
      .map((tc) => tc.plan?.id)
      .filter((id): id is string => !!id)
  );
}

// I messaggi di soli tool call confluiscono nel successivo che ha testo: una bolla sola.
export function consolidateMessages(raw: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pendingToolCalls: Array<{ toolCallId: string; toolName: string; input?: unknown }> = [];
  let pendingReasoning = '';
  // Id della PRIMA riga confluita nella bolla: redo taglia dall'id che riceve, e tagliare
  // dalla riga di testo lascerebbe vive le righe tool. Separato da `id`, che serve al feedback.
  let pendingId: string | undefined;
  for (const m of raw) {
    if (m.role === 'assistant') {
      // Parti complete (segmenti di testo inclusi): una bolla unita mantiene la sua cronologia.
      const tc = parseAllParts(m.tool_calls) as ToolCallUi[];
      if (m.content) {
        out.push({ ...m, redo_from_id: pendingId ?? m.id, tool_calls: [...pendingToolCalls, ...tc].length ? [...pendingToolCalls, ...tc] : undefined, reasoning: pendingReasoning || m.reasoning || null });
        pendingToolCalls = [];
        pendingReasoning = '';
        pendingId = undefined;
      } else if (tc.length) {
        pendingToolCalls.push(...tc);
        pendingId ??= m.id;
        if (m.reasoning) pendingReasoning += (pendingReasoning ? '\n' : '') + m.reasoning;
      }
    } else {
      if (pendingToolCalls.length) {
        out.push({ id: pendingId, redo_from_id: pendingId, role: 'assistant', content: '', tool_calls: pendingToolCalls, reasoning: pendingReasoning || null });
        pendingToolCalls = [];
        pendingReasoning = '';
        pendingId = undefined;
      }
      out.push(m);
    }
  }
  if (pendingToolCalls.length) {
    out.push({ id: pendingId, role: 'assistant', content: '', tool_calls: pendingToolCalls, reasoning: pendingReasoning || null });
  }
  return out;
}

/** Dove deve tagliare un redo: la prima riga della bolla, o la riga stessa. */
export const redoIdOf = (m?: ChatMessage) => m?.redo_from_id ?? m?.id;
