/**
 * Small pure helpers shared by the commands. Kept separate from the command modules so they
 * can be unit-tested without a session or a live API.
 */

export type PrefixMatch<T> =
  | { ok: true; item: T }
  | { ok: false; reason: 'none' | 'ambiguous'; count: number };

/**
 * Tables print short id prefixes (a full UUID column is unreadable), so `--id` accepts a prefix.
 * Ambiguity must be an error, never a silent "first match": picking the wrong post or article
 * would publish or delete the wrong thing.
 */
export function resolveByPrefix<T extends { id: string }>(items: T[], prefix: string): PrefixMatch<T> {
  const p = prefix.trim();
  if (!p) return { ok: false, reason: 'none', count: 0 };
  // An exact id always wins, even if it happens to prefix another id.
  const exact = items.find((i) => i.id === p);
  if (exact) return { ok: true, item: exact };
  const matches = items.filter((i) => i.id.startsWith(p));
  if (matches.length === 1) return { ok: true, item: matches[0] };
  return { ok: false, reason: matches.length ? 'ambiguous' : 'none', count: matches.length };
}

/**
 * Parse repeatable `key=value` flags (e.g. --platformCaption x="short cut").
 * The value may itself contain '=', so only the FIRST separator splits.
 * Returns null on a malformed pair so the caller can fail loudly instead of dropping input.
 */
export function parseKeyValuePairs(pairs: string[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i < 1) return null;
    const key = pair.slice(0, i).trim().toLowerCase();
    const value = pair.slice(i + 1).trim();
    if (!key) return null;
    if (value) out[key] = value; // empty value = clear that key
  }
  return out;
}
