import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from '$lib/seo';

// Short-code click path for post CTAs. A produced post's link_url gets UTM tags appended at
// persist time (enrichCtaWithUtm in content-preview.ts) and a post_links row is created here,
// pairing the short /l/[code] redirect code with the target. Two counters per link:
//   clicks_redirect — hits on the public /l/[code] 302 (noisy: platform unfurl crawlers prefetch
//     caption links, so this over-counts human clicks).
//   clicks_landing  — hits on the anonymous landing beacon (clean: only real page loads report).
// The weekly recap sums both.

// randomBytes(6) → 8 base64url chars; also covers hand-written codes in [6..12].
export const SHORT_CODE_RE = /^[A-Za-z0-9_-]{6,12}$/;

/**
 * Strict bio-URL validation (used by the bio manager PUT). Returns null when valid, or an error
 * message. Empty string = clear the bio (valid). Rejects: control chars, >500 chars, non-http(s)
 * schemes, and unparsable URLs. `bio_url` is never fetched server-side, but it WILL be rendered
 * in future UI — validating at the boundary keeps it safe.
 */
export function validateBioUrl(raw: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null) return { ok: false, error: 'bio_url is required' };
  const value = raw.trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: 'bio_url is invalid' };
  }
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
      return { ok: false, error: 'bio_url must be an http(s) URL or empty' };
    }
  } catch {
    return { ok: false, error: 'bio_url must be an http(s) URL or empty' };
  }
  return { ok: true, value };
}

export type PostLinkInput = {
  brandId: string;
  postId?: string | null; // null when the post row doesn't exist yet (persist-time enrichment)
  targetUrl: string; // the ORIGINAL target (UTM-free); the UTM lives in the column fields
  utmCampaign?: string | null;
  utmContent?: string | null;
  label?: string | null;
};

export type CreatedPostLink = {
  code: string;
  url: string; // absolute short URL: <origin>/l/<code>
};

// Build a UTM query string (no leading '?') for a post CTA:
// ?utm_source=<platform>&utm_medium=post&utm_campaign=<weekKey>&utm_content=<postSlug>
// Values are URL-encoded; the caller appends it to the target URL.
export function buildUtm(input: {
  brandSlug: string; // unused today, kept in the signature so campaigns can be brand-scoped later
  weekKey: string; // e.g. '2026-W33' — the campaign bucket
  postSlug: string; // short slug identifying the post within the campaign
  platform: string; // utm_source — the network the link rides on (instagram, x, linkedin…)
}): string {
  const params = new URLSearchParams();
  params.set('utm_source', input.platform || 'social');
  params.set('utm_medium', 'post');
  params.set('utm_campaign', input.weekKey);
  params.set('utm_content', input.postSlug);
  return params.toString();
}

/** ISO-8601 week key 'YYYY-Www' (Monday-based), used as the UTM campaign bucket. */
export function weekKeyOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Slugify a post angle/pillar into a short utm_content token (lowercase, dashes, ≤40 chars). */
export function postSlugOf(text: string | null | undefined): string {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'post';
}

// Insert a post_links row and return the short code + absolute URL. Retries once on the code's
// unique constraint (48-bit codes can collide at scale). Throws on failure — callers decide
// whether that's fatal (persist-time enrichment treats it as non-fatal).
export async function createPostLink(
  supabase: SupabaseClient,
  input: PostLinkInput
): Promise<CreatedPostLink> {
  let code = randomBytes(6).toString('base64url');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) code = randomBytes(6).toString('base64url');
    const { data, error } = await supabase
      .from('post_links')
      .insert({
        brand_id: input.brandId,
        post_id: input.postId ?? null,
        code,
        target_url: input.targetUrl,
        utm_source: 'social',
        utm_medium: 'post',
        utm_campaign: input.utmCampaign ?? null,
        utm_content: input.utmContent ?? null,
        label: input.label ?? null
      })
      .select('code')
      .single();
    if (error?.message?.includes('duplicate key') && attempt === 0) continue;
    if (error) throw error;
    return { code: data.code, url: `${siteUrl()}/l/${data.code}` };
  }
  throw new Error('createPostLink: could not allocate a unique short code');
}

// Atomically bump one counter via the security-definer RPC (service-role only). The public
// /l/[code] redirect and the anonymous landing beacon have no session — they pass the admin
// client. Errors are swallowed by callers; a missed count must never break a redirect.
export async function bumpLinkClick(
  admin: SupabaseClient,
  code: string,
  kind: 'redirect' | 'landing'
): Promise<void> {
  await admin.rpc('bump_link_click', { code, kind });
}

/**
 * Best link for the brand's bio right now: the post_link with the most clicks (redirect +
 * landing) in the last 7 days. FUTURE "copy in bio" flow: an agent (or the studio UI) reads this
 * and writes the result onto social_accounts.bio_url (the column ships with 0151) — NO email is
 * sent automatically. Returns null when the brand has no clicked links this week.
 */
export async function suggestBioUrl(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ code: string; url: string; clicks: number; targetUrl: string } | null> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('post_links')
    .select('code, target_url, clicks_redirect, clicks_landing')
    .eq('brand_id', brandId)
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!data?.length) return null;
  let best: (typeof data)[number] | null = null;
  for (const row of data) {
    const clicks = (row.clicks_redirect ?? 0) + (row.clicks_landing ?? 0);
    if (!best || clicks > (best.clicks_redirect ?? 0) + (best.clicks_landing ?? 0)) best = row;
  }
  if (!best) return null;
  const code = best.code;
  const clicks = (best.clicks_redirect ?? 0) + (best.clicks_landing ?? 0);
  return { code, url: `${siteUrl()}/l/${code}`, clicks, targetUrl: best.target_url };
}
