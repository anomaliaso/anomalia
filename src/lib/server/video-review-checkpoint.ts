/**
 * Slim, JSON-safe transcript of the media-review agent (no frames / mp4).
 * A killed Vercel invocation stores this on `video_reviews.progress`; the next
 * worker rebuilds the media user message and continues from these turns.
 */

export const REVIEW_CHECKPOINT_VERSION = 1;
const MAX_JSON_BYTES = 180_000;

export type ReviewCheckpoint = {
  v: typeof REVIEW_CHECKPOINT_VERSION;
  steps: number;
  webLeft: number;
  adsLeft: number;
  notes: string[];
  toolsUsed: string[];
  /** Assistant + tool turns after the media user message. */
  rest: unknown[];
};

export function parseReviewCheckpoint(raw: unknown): ReviewCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== REVIEW_CHECKPOINT_VERSION) return null;
  const steps = Number(o.steps);
  if (!Number.isFinite(steps) || steps < 1) return null;
  const rest = Array.isArray(o.rest) ? o.rest : [];
  if (!rest.length) return null;
  return {
    v: REVIEW_CHECKPOINT_VERSION,
    steps: Math.max(0, Math.trunc(steps)),
    webLeft: Math.max(0, Number(o.webLeft) || 0),
    adsLeft: Math.max(0, Number(o.adsLeft) || 0),
    notes: Array.isArray(o.notes) ? o.notes.map((n) => String(n)).slice(0, 12) : [],
    toolsUsed: Array.isArray(o.toolsUsed) ? o.toolsUsed.map((n) => String(n)).slice(0, 24) : [],
    rest
  };
}

export function slimReviewMessages(messages: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: string }).role;
    if (role === 'user' || role === 'system') continue;
    if (role !== 'assistant' && role !== 'tool') continue;
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string') {
      const t = content.trim();
      if (t) out.push({ role, content: t });
      continue;
    }
    if (!Array.isArray(content)) continue;
    const parts = content.map(slimPart).filter((p): p is Record<string, unknown> => !!p);
    if (!parts.length) continue;
    out.push({ role, content: parts });
  }
  return out;
}

function slimPart(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== 'object') return null;
  const t = String((p as { type?: string }).type ?? '');
  if (t === 'image' || t === 'file' || t === 'media' || t === 'reasoning') return null;
  return p as Record<string, unknown>;
}

export function buildReviewCheckpoint(input: {
  steps: number;
  webLeft: number;
  adsLeft: number;
  notes: string[];
  toolsUsed: string[];
  messages: unknown[];
}): ReviewCheckpoint | null {
  const rest = slimReviewMessages(input.messages);
  if (!rest.length || input.steps < 1) return null;
  const cp: ReviewCheckpoint = {
    v: REVIEW_CHECKPOINT_VERSION,
    steps: input.steps,
    webLeft: input.webLeft,
    adsLeft: input.adsLeft,
    notes: input.notes.slice(0, 12),
    toolsUsed: input.toolsUsed.slice(0, 24),
    rest
  };
  try {
    if (JSON.stringify(cp).length > MAX_JSON_BYTES) return null;
  } catch {
    return null;
  }
  return cp;
}

export function isAbortLikeError(e: unknown): boolean {
  if (!e) return false;
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  return name === 'AbortError' || /aborted|abort(?:ed)?/i.test(msg);
}
