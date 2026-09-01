/**
 * Il reducer di uno stream SSE di chat.
 *
 * Le due parti piegano gli stessi eventi nella stessa forma: il browser per dipingere il turno
 * vivo, e il server, che ne tiene copia sulla riga del job perché un client che si riconnette
 * riprenda lo stream invece di guardare uno spinner. Un posto solo è ciò che rende il buffer
 * ripreso identico a quello perso.
 */

import type { ChatReasoningSegment } from './chat-parts';

export type StreamToolCallState = {
  toolCallId: string;
  toolName: string;
  status?: 'running' | 'done' | 'error';
  /** Length of `text` when the call fired — lets the UI slot it back into the transcript. */
  textLen?: number;
  /** Params the model passed, so a chip opens while the tool is still running. */
  input?: unknown;
  /** What the tool answered. Same field the persisted `tool-call` part uses, so the chip panel
   *  does not care whether the turn is live or replayed. */
  output?: unknown;
  /** Message of a failed call, when the stream reported one. */
  errorText?: string;
};

export type ChatStreamState = {
  text: string;
  tools: StreamToolCallState[];
  /** Ogni pensiero di seguito all'altro. Legacy: chi non sa dei segmenti legge ancora questa. */
  reasoning: string;
  /** Gli stessi pensieri, ma uno per volta e ciascuno al suo posto fra testo e tool. */
  reasoningSegments: ChatReasoningSegment[];
  /** L'ultimo segmento accetta ancora delta: chiuso, il prossimo delta ne apre uno nuovo. */
  reasoningOpen: boolean;
  /** Provider/stream failure seen in the events. */
  failed: boolean;
};

export const emptyStreamState = (): ChatStreamState => ({
  text: '',
  tools: [],
  reasoning: '',
  reasoningSegments: [],
  reasoningOpen: false,
  failed: false
});

/** Fold one parsed SSE event into `state`. Returns true when something visible changed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyChatStreamEvent(state: ChatStreamState, evt: any): boolean {
  const changed = foldStreamEvent(state, evt);
  return foldReasoningSegments(state, evt) || changed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function foldReasoningSegments(state: ChatStreamState, evt: any): boolean {
  const type = evt && typeof evt === 'object' ? String(evt.type ?? '') : '';

  if (type === 'reasoning-start' || type === 'reasoning-delta') {
    const delta = type === 'reasoning-delta' ? String(evt.delta ?? '') : '';
    if (!state.reasoningOpen) {
      if (!delta && type === 'reasoning-delta') return false;
      state.reasoningSegments = [
        ...state.reasoningSegments,
        { text: delta, textLen: state.text.length, toolsBefore: state.tools.length }
      ];
      state.reasoningOpen = true;
      return true;
    }
    if (!delta) return false;
    const last = state.reasoningSegments[state.reasoningSegments.length - 1];
    state.reasoningSegments = [
      ...state.reasoningSegments.slice(0, -1),
      { ...last, text: last.text + delta }
    ];
    return true;
  }

  if (state.reasoningOpen && ((type === 'text-delta' && evt.delta) || type.startsWith('tool-'))) {
    state.reasoningOpen = false;
    return false;
  }

  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function foldStreamEvent(state: ChatStreamState, evt: any): boolean {
  if (!evt || typeof evt !== 'object') return false;

  switch (evt.type) {
    case 'error':
      state.failed = true;
      return true;

    case 'finish':
      if (evt.finishReason === 'error') state.failed = true;
      return false;

    case 'text-delta':
      if (!evt.delta) return false;
      state.text += evt.delta;
      return true;

    case 'tool-input-start':
    case 'tool-input-available': {
      // AI SDK 6 uses toolCallId; older mocks / transports may send id.
      const toolCallId = String(evt.toolCallId ?? evt.id ?? '');
      const toolName = String(evt.toolName ?? 'tool');
      if (!toolCallId && !toolName) return false;
      const idx = state.tools.findIndex((t) => t.toolCallId && t.toolCallId === toolCallId);
      const next: StreamToolCallState = {
        toolCallId: toolCallId || `anon-${state.tools.length}`,
        toolName,
        status: 'running',
        textLen: state.text.length
      };
      // `tool-input-start` has no params yet; they land with `tool-input-available`. Only assign
      // when the event actually carries them, so the second event cannot blank the first.
      if (evt.input !== undefined) next.input = evt.input;
      // `reply` È il messaggio all'utente, ma viaggia negli ARGOMENTI del tool: senza questo ramo
      // la diretta mostra la chip e nessuna bolla, e il testo compare solo al reload. Entra nel
      // flusso come se fosse stato streammato; nessun doppione, perché il fold di fine turno
      // sostituisce i buffer col messaggio salvato.
      if (toolName === 'reply' && evt.input && typeof (evt.input as { message?: unknown }).message === 'string') {
        const msg = (evt.input as { message: string }).message;
        if (msg && !state.text.endsWith(msg)) {
          state.text += (state.text ? '\n\n' : '') + msg;
        }
      }
      // start then available hit the same call: keep the FIRST textLen, the point in the text
      // where the model actually stopped writing to call the tool.
      state.tools =
        idx >= 0
          ? state.tools.map((t, i) => (i === idx ? { ...t, ...next, textLen: t.textLen ?? next.textLen } : t))
          : [...state.tools, next];
      return true;
    }

    case 'tool-output-available':
    case 'tool-output-error': {
      const toolCallId = String(evt.toolCallId ?? evt.id ?? '');
      if (!toolCallId) return false;
      const status = evt.type === 'tool-output-error' ? 'error' : 'done';
      const errorText =
        typeof evt.errorText === 'string' ? evt.errorText : evt.error ? String(evt.error) : undefined;
      state.tools = state.tools.map((t) =>
        t.toolCallId === toolCallId
          ? {
              ...t,
              status,
              ...(evt.output !== undefined ? { output: evt.output } : {}),
              ...(errorText ? { errorText } : {})
            }
          : t
      );
      return true;
    }

    case 'reasoning-start':
      // Show the thinking panel before the first delta (ZWSP = placeholder).
      if (state.reasoning) return false;
      state.reasoning = '​';
      return true;

    case 'reasoning-delta':
      if (!evt.delta) return false;
      state.reasoning = (state.reasoning === '​' ? '' : state.reasoning) + evt.delta;
      return true;

    default:
      return false;
  }
}

/**
 * Spezza il testo SSE grezzo in eventi, restituendo la riga parziale finale da anteporre alla
 * prossima. Stesso framing per entrambi i lettori: nessuno può perdere metà evento su un confine.
 */
export function readSseEvents(buffered: string): { events: unknown[]; rest: string } {
  const lines = buffered.split('\n');
  const rest = lines.pop() ?? '';
  const events: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!trimmed.startsWith('data: ')) continue;
    const raw = trimmed.slice(6);
    if (raw === '[DONE]') continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      /* skip malformed */
    }
  }
  return { events, rest };
}

/** Un input più lungo di così non è un parametro: è un payload travestito. */
const MAX_MIRRORED_PAYLOAD_CHARS = 2_000;

/**
 * La stessa lista di tool con PARAMETRI e RISULTATI, entrambi sotto un tetto.
 *
 * La riga rispecchiata è riscritta di continuo per tutto il turno, quindi non può portarsi dietro
 * un risultato intero: il brief di un sotto-agente è un chilobyte, la sua risposta ottomila. Ma è
 * anche l'unica riga da cui il turno si ricostruisce quando la scheda NON è attaccata all'SSE —
 * turno finito nel worker, tab riaperta, riconnessione, e il checkpoint che diventa messaggio.
 * Una chip che si apre e non dice né con cosa è partita né cosa ha risposto non serve a niente:
 * era il caso di ogni turno lungo, cioè quelli per cui la riga esiste.
 *
 * Il tetto è uno solo per input e output: oltre, si tronca e lo si DICHIARA invece di far sparire
 * il campo. Un valore tagliato si legge lo stesso, uno assente no.
 */
function clampMirrored(value: unknown): unknown {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (raw.length <= MAX_MIRRORED_PAYLOAD_CHARS) return value;
  return `${raw.slice(0, MAX_MIRRORED_PAYLOAD_CHARS)}…[+${raw.length - MAX_MIRRORED_PAYLOAD_CHARS}]`;
}

export function toolsForMirror(tools: StreamToolCallState[]): StreamToolCallState[] {
  return tools.map(({ output, errorText, input, ...rest }) => ({
    ...rest,
    ...(input === undefined ? {} : { input: clampMirrored(input) }),
    ...(output === undefined ? {} : { output: clampMirrored(output) }),
    ...(errorText === undefined ? {} : { errorText: String(clampMirrored(errorText)) })
  }));
}

/**
 * A stream finito non esiste una chip «running»: o il risultato è arrivato, o non arriverà mai.
 * La sessione può morire a metà di un tool (il turno ripreso con una sessione fresca non
 * riemette il risultato del call precedente) — senza questo gesto il partial conserva il loading
 * perpetuo che l'utente ha visto il 27/8. `true` se qualcosa è cambiato.
 */
export function closeDanglingToolCalls(state: ChatStreamState): boolean {
  let changed = false;
  state.tools = state.tools.map((t) => {
    if (t.status !== 'running' && t.status !== undefined) return t;
    changed = true;
    return { ...t, status: 'error' as const, errorText: t.errorText ?? 'the turn ended before this result arrived' };
  });
  return changed;
}

/** Lo snapshot decide lo STATO di ogni chip; i payload interi li tiene chi li ha già letti. */
export function mergeStreamToolCalls(
  held: StreamToolCallState[],
  snapshot: StreamToolCallState[]
): StreamToolCallState[] {
  const byId = new Map(held.map((t) => [t.toolCallId, t]));
  return snapshot.map((fromSnapshot) => {
    const mine = byId.get(fromSnapshot.toolCallId);
    if (!mine) return fromSnapshot;
    return {
      ...fromSnapshot,
      input: mine.input ?? fromSnapshot.input,
      output: mine.output ?? fromSnapshot.output,
      errorText: mine.errorText ?? fromSnapshot.errorText
    };
  });
}
