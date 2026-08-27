/** Max length for a website carried through login → onboarding query params. */
const MAX_LEN = 300;

/**
 * Sanitize a website URL from a query/form param. Accepts bare hosts (`acme.com`) or
 * full http(s) URLs. Rejects empty values, other schemes, and junk that won't parse.
 * Returns the trimmed original (without forcing https) so onboarding can show what the
 * user typed; returns '' when invalid.
 */
export function sanitizeWebsiteParam(raw: string | null | undefined): string {
  if (!raw) return '';
  const v = String(raw).trim().slice(0, MAX_LEN);
  if (!v) return '';
  if (/[\s<>"']/.test(v)) return '';
  if (/^(javascript|data|vbscript|file):/i.test(v)) return '';
  try {
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname || !u.hostname.includes('.')) return '';
    return v;
  } catch {
    return '';
  }
}
