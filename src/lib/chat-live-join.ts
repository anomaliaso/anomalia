/**
 * Agganciarsi a un turno già partito significa leggere DUE sorgenti della stessa risposta: il
 * canale Realtime, che consegna incrementi, e il poll, che porta il testo assoluto. Appenderne
 * uno sopra l'altro senza sapere se si toccano produce testo mescolato — chi entra a metà turno
 * non è mai allineato, e un chunk perso dal canale (broadcast best-effort) lascia un buco che il
 * chunk successivo cuce sopra la parola sbagliata.
 *
 * Qui la posizione è esplicita: ogni chunk dice DOVE cominciava sul server. Si applica solo se
 * continua esattamente dove siamo; altrimenti aspetta lo snapshot che colma il buco.
 */
import { applyChatStreamEvent, mergeStreamToolCalls, type ChatStreamState, type StreamToolCallState } from '$lib/chat-stream-events';
import type { ChatReasoningSegment } from '$lib/chat-parts';

/** Lunghezze del testo e del ragionamento sul server PRIMA che il chunk fosse applicato. */
export type ChunkPosition = { text: number; reasoning: number };

type Track = 'text' | 'reasoning';

export type PendingChunk = { track: Track; at: number; evt: unknown };

/** Un buco che non si chiude (chunk perso e run finito) non deve far crescere la coda per sempre. */
const MAX_PENDING = 1000;

function trackOf(evt: unknown): Track | null {
  const e = evt as { type?: unknown; delta?: unknown } | null;
  if (!e || typeof e !== 'object' || typeof e.delta !== 'string' || !e.delta) return null;
  if (e.type === 'text-delta') return 'text';
  if (e.type === 'reasoning-delta') return 'reasoning';
  return null;
}

function drain(state: ChatStreamState, pending: PendingChunk[]): boolean {
  let changed = false;
  for (;;) {
    const i = pending.findIndex((p) => p.at === state[p.track].length);
    if (i < 0) break;
    const [next] = pending.splice(i, 1);
    changed = applyChatStreamEvent(state, next.evt) || changed;
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].at < state[pending[i].track].length) pending.splice(i, 1);
  }
  return changed;
}

/**
 * Un chunk del canale. Senza posizione (server più vecchio del client) si applica com'era prima.
 */
export function applyLiveChunk(
  state: ChatStreamState,
  pending: PendingChunk[],
  evt: unknown,
  at?: ChunkPosition | null
): boolean {
  const track = trackOf(evt);
  if (!track || !at || typeof at[track] !== 'number') return applyChatStreamEvent(state, evt);

  const here = state[track].length;
  if (at[track] === here) {
    const changed = applyChatStreamEvent(state, evt);
    return drain(state, pending) || changed;
  }
  // Già visto: il canale ha consegnato in ritardo qualcosa che lo snapshot aveva già portato.
  if (at[track] < here) return false;

  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({ track, at: at[track], evt });
  return false;
}

export type LiveSnapshot = {
  text?: string;
  reasoning?: string;
  reasoningSegments?: ChatReasoningSegment[];
  tools?: StreamToolCallState[];
};

const reasoningLength = (segments: ChatReasoningSegment[]) =>
  segments.reduce((n, s) => n + s.text.length, 0);

/** Lo snapshot assoluto del poll: va avanti, mai indietro, e fa entrare i chunk in attesa. */
export function applyLiveSnapshot(
  state: ChatStreamState,
  pending: PendingChunk[],
  snapshot: LiveSnapshot | null | undefined
): boolean {
  let changed = false;
  if (snapshot) {
    const text = String(snapshot.text ?? '');
    if (text.length > state.text.length) {
      state.text = text;
      changed = true;
    }
    // I segmenti sono il ragionamento POSIZIONATO: senza, un pensiero chiuso e quello in corso
    // tornano a essere lo stesso blocco, e la bolla viva li disegna tutti come «sta pensando».
    const segments = Array.isArray(snapshot.reasoningSegments) ? snapshot.reasoningSegments : [];
    if (reasoningLength(segments) > reasoningLength(state.reasoningSegments)) {
      state.reasoningSegments = segments;
      changed = true;
    }
    const reasoning = String(snapshot.reasoning ?? '') || state.reasoningSegments.map((s) => s.text).join('');
    if (reasoning.length > state.reasoning.length) {
      state.reasoning = reasoning;
      changed = true;
    }
    const tools = Array.isArray(snapshot.tools) ? snapshot.tools : [];
    // Anche a lunghezza invariata lo snapshot può dire qualcosa di nuovo: la chiusura di una chip
    // persa dal canale (realtime best-effort, stream morto a metà tool) è una transizione di
    // stato, non un'aggiunta.
    if (tools.length > 0 && tools.length >= state.tools.length) {
      state.tools = mergeStreamToolCalls(state.tools, tools);
      changed = true;
    }
  }
  return drain(state, pending) || changed;
}
