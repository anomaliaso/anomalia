/**
 * Pure helpers: pick knowledge chunks for a caption prompt under a hard token budget.
 * Used by content-preview so the brand corpus can influence posts without bloating prompts
 * (docs/23 §11). Billing is unchanged — only the prompt text is shaped here.
 */

export const KNOWLEDGE_CAPTION_TOKEN_BUDGET = 600;

export type KnowledgeHitLite = {
  chunkId: string;
  title: string;
  headingPath: string;
  content: string;
};

/** Rough token estimate (~4 chars/token). Deterministic for tests. */
export function estimateTokens(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

function formatHit(h: KnowledgeHitLite): string {
  const path = h.headingPath?.trim() ? ` › ${h.headingPath.trim()}` : '';
  return `- [${h.title || 'Untitled'}${path}]\n  ${h.content.trim()}`;
}

export const KNOWLEDGE_PROMPT_HEADER =
  '## DAL MATERIALE DEL BRAND (cita solo se pertinente)';

/**
 * Greedy take of hits until `maxTokens` (header included). Never exceeds the budget:
 * a single oversized first hit is truncated to fit.
 */
export function selectChunksForPrompt(
  hits: KnowledgeHitLite[],
  maxTokens = KNOWLEDGE_CAPTION_TOKEN_BUDGET
): { selected: KnowledgeHitLite[]; chunkIds: string[]; block: string; tokensUsed: number } {
  if (!hits.length || maxTokens <= 0) {
    return { selected: [], chunkIds: [], block: '', tokensUsed: 0 };
  }

  const header = KNOWLEDGE_PROMPT_HEADER;
  let used = estimateTokens(header + '\n');
  const selected: KnowledgeHitLite[] = [];

  for (const hit of hits) {
    const body = formatHit(hit);
    const cost = estimateTokens(body);
    if (used + cost <= maxTokens) {
      selected.push(hit);
      used += cost;
      continue;
    }
    if (selected.length === 0) {
      // Fit at least one truncated excerpt so retrieval isn't a no-op on a huge first hit.
      const roomChars = Math.max(0, (maxTokens - used) * 4 - 20); // leave room for title/path/ellipsis
      if (roomChars < 40) break;
      let truncated: KnowledgeHitLite = {
        ...hit,
        content: hit.content.trim().slice(0, roomChars)
      };
      // Shrink until the formatted block fits (title/path overhead varies).
      while (estimateTokens(header + '\n' + formatHit(truncated)) > maxTokens && truncated.content.length > 40) {
        truncated = { ...truncated, content: truncated.content.slice(0, Math.floor(truncated.content.length * 0.85)) };
      }
      if (truncated.content.length < hit.content.trim().length) {
        truncated = { ...truncated, content: truncated.content.replace(/\s+$/, '') + '…' };
      }
      // Final guard: if still over, drop rather than blow the budget.
      if (estimateTokens(header + '\n' + formatHit(truncated)) > maxTokens) break;
      selected.push(truncated);
      used = estimateTokens(header + '\n' + formatHit(truncated));
    }
    break;
  }

  if (!selected.length) {
    return { selected: [], chunkIds: [], block: '', tokensUsed: 0 };
  }

  const block = `${header}\n${selected.map(formatHit).join('\n')}`;
  return {
    selected,
    chunkIds: selected.map((s) => s.chunkId),
    block,
    tokensUsed: estimateTokens(block)
  };
}
