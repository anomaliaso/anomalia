import { siteUrl } from '$lib/seo';

// 32 symbols, no 0/O and no 1/I/L confusion — these codes get read aloud and retyped.
// 8 chars ≈ 1.1e12 combinations, which is the whole security boundary for a /a/ link.
export const MEDIA_SHORT_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;
export const MEDIA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The link to hand out for a library asset. Short and permanent, unlike the signed storage URL:
 * it survives being copied through an agent's output, and it never expires.
 */
export function mediaUrl(shortCode: string | null | undefined): string | null {
  return shortCode ? `${siteUrl()}/a/${shortCode}` : null;
}
