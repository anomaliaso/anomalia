/**
 * Modello di rendering CRONOLOGICO di un turno assistant: testo, una chiamata a tool, la sua card,
 * altro testo, un altro tool… L'ordine sta nel JSON `tool_calls` (i segmenti di testo viaggiano
 * come parti `{type:'text'}`, vedi assistantContentFromSteps); `content` resta il testo unito per
 * copia/compattazione/contesto.
 *
 * Le righe vecchie portano solo tool call e ricadono sul layout di prima: prima i tool, poi tutto
 * il testo.
 */

import { splitGoalStatus } from '$lib/goal-status';
import { splitTextMedia } from '$lib/chat-media';

export type ChatToolPart = {
  type?: string;
  toolCallId?: string;
  toolName: string;
  input?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

export type ChatTextPart = { type: 'text'; text: string };
export type ChatReasoningPart = { type: 'reasoning'; text: string };
export type ChatPart = ChatTextPart | ChatReasoningPart | ChatToolPart;

/**
 * Una traccia di ragionamento viva, posizionata come una tool call: si è aperta con `textLen`
 * caratteri di testo e `toolsBefore` chiamate già esistenti. Vedi `foldReasoningEvent`.
 */
export type ChatReasoningSegment = { text: string; textLen: number; toolsBefore: number };

/** Consecutive tool calls collapse into one chip bar; each text/reasoning segment is its own block. */
export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'tools'; calls: ChatToolPart[] }
  | { type: 'reasoning'; text: string };

/**
 * I tool che NON si mostrano come chip: hanno già una card che parla, e la chip accanto la
 * ucciderebbe. L'elenco sta QUI e non nelle pagine perché era copiato in due surface, che si sono
 * scollate: la stessa conversazione mostrava lo sticker da una parte e una chip nuda dall'altra.
 */
export const SILENT_CHIP_TOOLS: readonly string[] = [
  'ask_user_questions',
  'propose_custom_agent',
  // La card della squadra dice già chi è chi.
  'show_team',
  // Il blocco dei media è la cosa stessa che si sta guardando.
  'show_media',
  'set_expression',
  // Il DM fra agenti ha già la sua chip-link ("N messaggi con X") che porta al thread privato.
  'message_agent'
];

/** Le chiamate che meritano una chip. Usata DENTRO ChatToolChips: nessun chiamante se la ricorda. */
export function chipCalls<T extends { toolName: string }>(calls: T[]): T[] {
  return calls.filter((c) => !SILENT_CHIP_TOOLS.includes(c.toolName));
}

/**
 * Quante di quelle azioni sono FALLITE. Un conteggio di azioni che include i rifiuti dichiara 12
 * cose fatte quando due non hanno consegnato niente, ed è così che un agente sembra affidabile.
 * Si guarda l'OUTPUT e non solo `status`: `status` esiste solo mentre il turno è in streaming, e
 * un turno riaperto dopo il ricaricamento perderebbe l'informazione proprio quando serve.
 */
export function failedCallCount(calls: Array<{ status?: string; output?: unknown }>): number {
  return calls.filter((c) => {
    if (c.status === 'error') return true;
    const raw = c.output as Record<string, unknown> | null | undefined;
    const out = raw && typeof raw === 'object' && 'value' in raw && 'type' in raw ? raw.value : raw;
    const o = out as Record<string, unknown> | null | undefined;
    // `retry` è un rifiuto ripetibile (storyboard_first): non ha consegnato niente. Vedi output-tools.ts.
    return !!(o && typeof o === 'object' && (o.error || o.retry));
  }).length;
}

/** Display name for a tool chip: `list_posts` → "list posts". */
export function toolLabel(name: string): string {
  // Una delega non è "un tool chiamato": è un altro agente che ha lavorato.
  if (name === 'delegate_task') return 'Sub-agent';
  if (name === 'run_task_pipeline') return 'Research → Execute → Verify';
  if (name === 'publish_artifact') return 'Artifact';
  if (name.startsWith('sandbox_')) return `Sandbox · ${name.slice('sandbox_'.length).replace(/_/g, ' ')}`;
  return name.replace(/_/g, ' ');
}

/**
 * Nome leggibile di un job asincrono + da quanto gira ("SEO & GEO audit · 3m"). Qui e non nella
 * pagina perché lo leggono due posti, e due copie della stessa etichetta si scollano sempre. Il
 * traduttore arriva come parametro (`$_`) invece di essere importato, per restare reattivo alla
 * lingua nei `$derived` che la chiamano.
 */
export function backgroundJobLabel(
  job: { tool_name: string; created_at: string },
  t: (key: string) => string
): string {
  const key = `chat.toolJob.${job.tool_name}`;
  const label = t(key);
  const name = label === key ? job.tool_name.replace(/_/g, ' ') : label;
  const mins = Math.floor((Date.now() - Date.parse(job.created_at)) / 60_000);
  return Number.isFinite(mins) && mins >= 1 ? `${name} · ${mins}m` : name;
}

export type ChatPostPreview = {
  post_id: string;
  platform: string;
  caption: string;
  media_url: string | null;
  media_urls?: string[];
  format?: string;
  status: string;
  /**
   * 'rendering' mentre una clip si produce fuori banda: senza, la card mostra la copertina come se
   * fosse un post foto finito.
   */
  video_render_status?: string | null;
};

/**
 * Anteprime dei post per tool call, deduplicate su tutto il turno (lo stesso post prodotto e poi
 * riletto comparirebbe due volte). Chiavi sull'oggetto part, quindi va costruita dagli STESSI
 * blocchi che si stanno disegnando.
 */
export function previewsByCall(blocks: ChatBlock[]): Map<ChatToolPart, ChatPostPreview[]> {
  const seen = new Set<string>();
  const out = new Map<ChatToolPart, ChatPostPreview[]>();
  for (const b of blocks) {
    if (b.type !== 'tools') continue;
    for (const tc of b.calls) {
      const list = ((tc.preview ?? []) as ChatPostPreview[]).filter((p) => {
        if (!p.post_id || seen.has(p.post_id)) return false;
        const hasBody = !!p.caption?.trim() || !!p.media_url || !!p.media_urls?.length;
        if (!hasBody) return false;
        seen.add(p.post_id);
        return true;
      });
      if (list.length) out.set(tc, list);
    }
  }
  return out;
}

export function parseToolCalls(raw: unknown): ChatPart[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ChatPart[];
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

const isText = (p: ChatPart): p is ChatTextPart => p.type === 'text';
const isReasoning = (p: ChatPart): p is ChatReasoningPart => p.type === 'reasoning';

/** Just the tool calls of a turn (no text parts) — for chips, plan pointers, previews, … */
export function toolCallsOf(raw: unknown): ChatToolPart[] {
  return parseToolCalls(raw).filter(
    (p): p is ChatToolPart => !isText(p) && !isReasoning(p) && !!(p as ChatToolPart).toolName
  );
}

/**
 * The turn as ordered blocks. `content` is only used for legacy rows, where it is appended after
 * the tool calls exactly like the old renderer did.
 */
/**
 * Gli stessi blocchi, per un turno ancora in streaming. Il buffer vivo è una stringa che cresce:
 * invece di una seconda copia del testo, ogni tool call registra `textLen` — quanto testo era
 * arrivato quando è partita — e il testo fra due chiamate è una slice. Le chiamate senza (snapshot
 * di una build vecchia) riportano 0 e ricadono sul layout "prima i tool, poi il testo".
 *
 * I `reasoningSegments` si incastrano allo stesso modo, ma su `toolsBefore`: un segmento aperto con
 * N tool già esistenti sta subito prima del tool N. Nessun pareggio possibile — un segmento si apre
 * solo dopo che ciò che lo precedeva si è chiuso.
 */
export function streamBlocks(
  streamBuf: string,
  toolCalls: Array<ChatToolPart & { textLen?: number }>,
  reasoningSegments: ChatReasoningSegment[] = []
): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let cursor = 0;
  const pushText = (upTo: number) => {
    const text = streamBuf.slice(cursor, upTo);
    if (text.trim()) blocks.push({ type: 'text', text });
    cursor = Math.max(cursor, upTo);
  };
  let ti = 0;
  let ri = 0;
  while (ti < toolCalls.length || ri < reasoningSegments.length) {
    const seg = reasoningSegments[ri];
    const seatsBeforeThisTool = !seg ? false : ti >= toolCalls.length || seg.toolsBefore <= ti;
    if (seg && seatsBeforeThisTool) {
      const at = Math.min(Math.max(seg.textLen, 0), streamBuf.length);
      if (at > cursor) pushText(at);
      blocks.push({ type: 'reasoning', text: seg.text });
      ri++;
      continue;
    }
    const tc = toolCalls[ti];
    const at = Math.min(Math.max(tc.textLen ?? 0, 0), streamBuf.length);
    if (MESSAGE_TOOLS.has(tc.toolName)) {
      ti++; // l'indice avanza SEMPRE: un continue senza incremento qui è un ciclo infinito
      continue;
    }
    if (at > cursor) pushText(at);
    const last = blocks[blocks.length - 1];
    if (last?.type === 'tools') last.calls.push(tc);
    else blocks.push({ type: 'tools', calls: [tc] });
    ti++;
  }
  pushText(streamBuf.length);
  return blocks;
}

/**
 * Lo snapshot vivo come parti ordinate: serve quando si piega uno stream finito nella lista dei
 * messaggi, così il turno non rifluisce nel layout vecchio per l'istante prima del reload.
 */
export function streamParts(
  streamBuf: string,
  toolCalls: Array<ChatToolPart & { textLen?: number }>,
  reasoningSegments: ChatReasoningSegment[] = []
): ChatPart[] {
  return streamBlocks(streamBuf, toolCalls, reasoningSegments).flatMap((b): ChatPart[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text }];
    if (b.type === 'reasoning') return [{ type: 'reasoning', text: b.text }];
    return b.calls;
  });
}

/**
 * `reply` e `ask_user` NON sono attrezzi da mostrare come chip: sono IL messaggio all'utente, e il
 * loro testo arriva già nel contenuto del turno. Mostrarli anche come chiamata è la stessa cosa
 * detta due volte, una in gergo interno.
 */
export const MESSAGE_TOOLS = new Set(['reply', 'ask_user']);

export function messageBlocks(content: string | null | undefined, rawToolCalls: unknown): ChatBlock[] {
  const parts = parseToolCalls(rawToolCalls);
  const ordered: ChatPart[] = parts.some((p) => isText(p) || isReasoning(p))
    ? parts
    : [...parts, ...(content?.trim() ? [{ type: 'text' as const, text: content }] : [])];

  const blocks: ChatBlock[] = [];
  for (const p of ordered) {
    if (isText(p)) {
      if (p.text?.trim()) blocks.push({ type: 'text', text: p.text });
    } else if (isReasoning(p)) {
      if (p.text?.trim()) blocks.push({ type: 'reasoning', text: p.text });
    } else if (p.toolName) {
      if (MESSAGE_TOOLS.has(p.toolName)) continue; // il messaggio, non un attrezzo
      const last = blocks[blocks.length - 1];
      if (last?.type === 'tools') last.calls.push(p);
      else blocks.push({ type: 'tools', calls: [p] });
    }
  }
  return blocks;
}

/**
 * Gli indici della PRIMA e dell'ULTIMA bolla di testo del turno (-1 se non ce ne sono): il volto
 * dell'agente si aggancia alla prima, la riga delle azioni all'ultima. Da figli diretti del turno
 * finivano in cima e in coda a TUTTO — avatar accanto al vuoto se la risposta apriva col
 * ragionamento, azioni appese a una card se chiudeva con una.
 *
 * Un blocco di solo notice `_Goal …_` non è una bolla (diventa una card) e non conta.
 */
export function textBubbleRange(blocks: ChatBlock[]): { first: number; last: number } {
  let first = -1;
  let last = -1;
  blocks.forEach((b, i) => {
    // Né un blocco che, tolto l'indirizzo del media promosso, non ha più niente da dire.
    if (b.type !== 'text' || !splitTextMedia(splitGoalStatus(b.text).text).text.trim()) return;
    if (first < 0) first = i;
    last = i;
  });
  return { first, last };
}
