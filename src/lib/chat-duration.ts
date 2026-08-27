/** Format generation time for the chat action row: `1.2s` / `12s` / `1m 04s`. */
export function formatChatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Tooltip under the duration: `model · tier · in/out tokens`. */
export function formatChatMetaTooltip(opts: {
  model?: string | null;
  tier?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): string {
  const parts: string[] = [];
  if (opts.model) parts.push(opts.model);
  if (opts.tier) parts.push(opts.tier);
  if (opts.inputTokens != null || opts.outputTokens != null) {
    parts.push(`${opts.inputTokens ?? '—'}→${opts.outputTokens ?? '—'}`);
  }
  return parts.join(' · ');
}
