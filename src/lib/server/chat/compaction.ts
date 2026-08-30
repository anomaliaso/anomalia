// Auto-compaction of long chat threads (docs/24 §6).
//
// The old turns stay in chat_messages and stay scrollable — what gets compacted is the
// model's context, not the user's history. A summary the user cannot read is a summary
// whose mistakes nobody can catch.
import { harnessGenerateText } from '$lib/server/harness';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { compactionModel } from './model';
import { logAiCall } from '$lib/server/ai-log';
import { CHAT_CONTEXT_CAP_TOKENS, hasFullChatContext } from '$lib/plans';
import { COMPACT_AT, estimateTokens, rowContextChars, type ContextRow } from '$lib/chat-context';

// Re-exported so the server keeps its one import for compaction, while the composer's context
// meter reads the same functions from the client-safe module.
export { COMPACT_AT, estimateTokens, rowContextChars };

/**
 * What the provider itself accepts. Grok 4.6 is 500k on kie; older Grok ids stay on a
 * cautious 256k default. An env override means a wrong guess costs one extra compaction,
 * not a 400 from the provider.
 */
export function modelContextWindow(modelId: string): number {
  if (modelId.startsWith('deepseek')) return 1_000_000;
  // Misurato dal vivo su Luna: 768k token di input serviti con recupero esatto, 500 poco sopra.
  // Si tiene 1M perché la compattazione scatta a COMPACT_AT (60%) = 600k, cioè sotto il tetto
  // verificato; abbassare la finestra qui comprerebbe solo compattazioni più frequenti.
  // ponytail: tetto noto a ~768k — se kie alza il limite, questo numero diventa vero da solo.
  if (modelId.startsWith('gpt-5')) return 1_000_000;
  if (modelId.startsWith('grok-4-6')) return Number(env.GROK_CONTEXT_WINDOW || 500_000);
  if (modelId.startsWith('grok')) return Number(env.GROK_CONTEXT_WINDOW || 256_000);
  if (modelId.startsWith('gemini')) return 1_000_000;
  return 128_000;
}

/**
 * Context the thread is allowed to fill before compacting: the model's window on
 * Starter/Pro/scale, capped at CHAT_CONTEXT_CAP_TOKENS (256k) on free and Go.
 *
 * The plan is optional only so callers that genuinely have no brand in hand still type-check;
 * an absent plan is a free brand here, so the default is the capped window — the failure mode
 * of a missed call site is a shorter thread, never a 400 from the provider.
 */
export function contextWindowFor(modelId: string, plan?: string | null): number {
  const full = modelContextWindow(modelId);
  return hasFullChatContext(plan) ? full : Math.min(full, CHAT_CONTEXT_CAP_TOKENS);
}

/** Compaction keeps the last 12 turns verbatim (the 60% trigger is COMPACT_AT, shared). */
export const KEEP_TAIL = 12;
/** Floor when the verbatim tail itself blows ~half the window (huge tool outputs). */
export const KEEP_TAIL_MIN = 2;
/** Verbatim tail should stay under this fraction of the session model's window. */
export const TAIL_BUDGET = 0.5;
/** Cap each tool output in the summary transcript so one 12k read doesn't dominate the call. */
export const TOOL_TRANSCRIPT_CAP = 8_000;
/** Below this, compacting frees nothing worth an AI call — unless the tail was shrunk (fat tools). */
export const MIN_COMPACTABLE = 6;

export type CompactableRow = ContextRow;

function asToolParts(raw: unknown): unknown[] {
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

/** Tool outputs for the summary prompt — the text bubble never held the read slice. */
export function toolOutputTranscript(toolCalls: unknown): string {
  const chunks: string[] = [];
  for (const p of asToolParts(toolCalls)) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as { type?: string; toolName?: string; output?: unknown };
    if (rec.type === 'text' || !rec.toolName || rec.output === undefined) continue;
    const raw = typeof rec.output === 'string' ? rec.output : JSON.stringify(rec.output);
    chunks.push(`[tool ${rec.toolName}]\n${raw.slice(0, TOOL_TRANSCRIPT_CAP)}`);
  }
  return chunks.join('\n');
}

export function rowTranscript(row: CompactableRow): string {
  const who = row.role === 'user' ? 'UTENTE' : 'AI';
  const text = row.content ?? '';
  const tools = toolOutputTranscript(row.tool_calls);
  return tools ? `${who}: ${text}\n${tools}` : `${who}: ${text}`;
}

/**
 * How many newest rows to keep verbatim. Shrinks below KEEP_TAIL when those rows
 * (tool outputs included) would themselves eat ~half the thread's window (model × plan).
 */
export function chooseKeepCount(
  rows: CompactableRow[],
  modelId: string,
  opts?: { maxKeep?: number; minKeep?: number; tailBudget?: number; plan?: string | null }
): number {
  const maxKeep = opts?.maxKeep ?? KEEP_TAIL;
  const minKeep = opts?.minKeep ?? KEEP_TAIL_MIN;
  const tokenBudget = (opts?.tailBudget ?? TAIL_BUDGET) * contextWindowFor(modelId, opts?.plan);
  let keep = Math.min(maxKeep, rows.length);
  if (rows.length <= minKeep) return keep;
  while (keep > minKeep) {
    const tailChars = rows.slice(-keep).reduce((n, r) => n + rowContextChars(r), 0);
    if (estimateTokens(tailChars) <= tokenBudget) break;
    keep -= 1;
  }
  return keep;
}

export function shouldCompact(opts: {
  chars: number;
  /** Rows eligible for summarizing — the tail is excluded by the caller. */
  compactableCount: number;
  modelId: string;
  /** Brand plan — free/Go compact at the 256k cap, Starter/Pro at the model's full window. */
  plan?: string | null;
  /** True when KEEP_TAIL was reduced because the verbatim tail itself is huge. */
  keepShrunk?: boolean;
}): boolean {
  if (opts.compactableCount < 1) return false;
  const over = estimateTokens(opts.chars) > COMPACT_AT * contextWindowFor(opts.modelId, opts.plan);
  if (!over) return false;
  if (opts.keepShrunk) return true;
  return opts.compactableCount >= MIN_COMPACTABLE;
}

const SUMMARY_PROMPT = `Riassumi questa parte di conversazione fra un utente e l'AI che gestisce il suo brand.
Mantieni, in forma di elenco:
- decisioni prese e loro motivazione
- vincoli, preferenze e correzioni espressi dall'utente
- fatti sul brand emersi (prodotti, numeri, date, nomi)
- lavoro completato (post creati, piani aggiornati) con i riferimenti
- questioni aperte
Ometti convenevoli e passaggi intermedi. Max 400 parole. Italiano se la conversazione è in italiano.`;

type ThreadCompactionRow = {
  summary: string | null;
  summary_upto: string | null;
  summary_message_count: number | null;
  compact_count: number | null;
};

/** Header the summary carries into the model context. */
export function summaryBlock(summary: string, messageCount: number): string {
  return `## RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE (${messageCount} messaggi)\n\n${summary}`;
}

/**
 * Compact a thread if it has grown past the budget. Runs BEFORE the model call —
 * compacting afterwards would mean the turn that overflowed already failed.
 * Returns true when a new summary was written (the caller must reload history).
 */
export async function maybeCompactThread(
  supabase: SupabaseClient,
  opts: {
    threadId: string;
    brandId: string;
    userId: string;
    modelId: string;
    /** Brand plan — sets the context ceiling (free/Go 256k, Starter/Pro the model's max). */
    plan?: string | null;
  }
): Promise<boolean> {
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('summary, summary_upto, summary_message_count, compact_count')
    .eq('id', opts.threadId)
    .eq('brand_id', opts.brandId)
    .eq('user_id', opts.userId)
    .maybeSingle<ThreadCompactionRow>();

  if (!thread) return false;

  // Live rows not yet summarized, oldest first — the same slice loadHistory feeds the model.
  let query = supabase
    .from('chat_messages')
    .select('id, role, content, created_at, tool_calls')
    .eq('brand_id', opts.brandId)
    .eq('user_id', opts.userId)
    .eq('thread_id', opts.threadId)
    .eq('superseded', false)
    .order('created_at', { ascending: true });
  if (thread.summary_upto) query = query.gt('created_at', thread.summary_upto);

  const { data: rows, error } = await query;
  if (error) {
    console.error('[compaction] load', error.message);
    return false;
  }
  if (!rows?.length) return false;

  const keep = chooseKeepCount(rows, opts.modelId, { plan: opts.plan });
  const defaultKeep = Math.min(KEEP_TAIL, rows.length);
  const compactable = rows.slice(0, Math.max(0, rows.length - keep));
  const chars =
    (thread.summary?.length ?? 0) + rows.reduce((n, r) => n + rowContextChars(r), 0);

  if (
    !shouldCompact({
      chars,
      compactableCount: compactable.length,
      modelId: opts.modelId,
      plan: opts.plan,
      keepShrunk: keep < defaultKeep
    })
  ) {
    return false;
  }

  // Il requisito è «il riassunto non lo fa mai il modello della conversazione», e vale anche nel
  // caso degradato: senza nessuna chiave non si compatta e non si paga di nascosto un modello
  // premium per farlo. compactionModel() sceglie Luna, o Gemini Flash se manca kie.
  const model = compactionModel();
  if (!model) {
    console.warn(
      `[compaction] no KIE_API_KEY / GEMINI_API_KEY — thread ${opts.threadId} left uncompacted (${rows.length} live messages)`
    );
    return false;
  }

  const transcript = compactable.map((r) => rowTranscript(r)).join('\n\n');

  const t0 = Date.now();
  let summary: string;
  try {
    const res = await harnessGenerateText({
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.threadId,
      agent: 'chat_compact',
      mode: 'compact',
      model: model.modelId,
      provider: model.provider,
      surface: 'compact'
    }, {
      model: model.model,
      system: SUMMARY_PROMPT,
      prompt: thread.summary
        ? // Merge into the previous summary rather than chaining summaries of summaries,
          // which loses a little more on every pass.
          `Riassunto precedente:\n${thread.summary}\n\nNuovi messaggi da integrare:\n${transcript}`
        : transcript,
      ...model.callOptions
    });
    summary = res.text.trim();
    logAiCall({
      label: 'chatCompact',
      provider: model.provider,
      model: model.modelId,
      ms: Date.now() - t0,
      ok: true,
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.threadId,
      context: 'chat:compact'
    });
  } catch (e) {
    logAiCall({
      label: 'chatCompact',
      provider: model.provider,
      model: model.modelId,
      ms: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.threadId,
      context: 'chat:compact'
    });
    console.error('[compaction] generate', e);
    return false;
  }

  if (!summary) return false;

  const upto = compactable[compactable.length - 1].created_at;
  const { error: writeError } = await supabase
    .from('chat_threads')
    .update({
      summary,
      summary_upto: upto,
      summary_message_count: (thread.summary_message_count ?? 0) + compactable.length,
      compacted_at: new Date().toISOString(),
      compact_count: (thread.compact_count ?? 0) + 1
    })
    .eq('id', opts.threadId)
    .eq('brand_id', opts.brandId)
    .eq('user_id', opts.userId);

  if (writeError) {
    console.error('[compaction] write', writeError.message);
    return false;
  }

  console.log(
    `[compaction] thread=${opts.threadId} summarized=${compactable.length} kept=${rows.length - compactable.length}`
  );
  return true;
}
