/**
 * Context accounting for a chat thread — client-safe on purpose.
 *
 * `chat/compaction.ts` imports these functions: quanto pesa un thread lo dice un conto solo.
 *
 * What is counted is what the model is handed: the running summary plus every message after
 * `summary_upto`. The turns above the compaction divider are still on screen and still
 * scrollable — they just aren't in the window any more, so they don't count here either.
 * The system prompt is not counted (the client cannot see it), same as in `shouldCompact`.
 */

/** Compact at 60% of the window, so a long turn still has room to land. */
export const COMPACT_AT = 0.6;

/** Newest live messages `loadHistory` hands the model on top of the summary. */
export const CHAT_HISTORY_LIMIT = 50;

export type ContextRow = {
  role?: string | null;
  content?: string | null;
  tool_calls?: unknown;
  created_at?: string | null;
};

/**
 * chars/4. No tokenizer: this decides *when* to compact and what to draw in a 16px ring,
 * it does not bill anyone — and a tokenizer dependency to pick a threshold would be the
 * tail wagging the dog.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Text + persisted tool_calls (includes outputs) — the whole cost of a row in the window. */
export function rowContextChars(row: ContextRow): number {
  const text = row.content?.length ?? 0;
  if (row.tool_calls == null) return text;
  if (typeof row.tool_calls === 'string') return text + row.tool_calls.length;
  try {
    return text + JSON.stringify(row.tool_calls).length;
  } catch {
    return text;
  }
}

