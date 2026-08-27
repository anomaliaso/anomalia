import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { brandContacts } from '$lib/server/scheduler';
import { buildDailyDigest, sendDailyDigest, digestDayWindow } from '$lib/server/publish-digest';

// Daily digest tick: every morning (08:00 UTC) emails each brand that published at least one
// post the previous UTC day. Auth matches the other ticks (CRON_SECRET Bearer / X-Autopilot-Secret,
// dev bypass); ?brand=<slug> narrows the run to a single brand (tests, manual runs).

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function runTick(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const brandSlug = url.searchParams.get('brand');
  const { start, end } = digestDayWindow('yesterday');

  // Which brands actually published yesterday — one cheap fleet query, so brands with a quiet
  // day never even reach the per-brand digest build (no emails, no noise).
  const { data: publishedRows, error: postsError } = await admin
    .from('posts')
    .select('brand_id')
    .eq('status', 'published')
    .gte('published_at', start)
    .lt('published_at', end);
  if (postsError) {
    console.error('[digest tick] could not load published posts:', postsError.message);
    return new Response(JSON.stringify({ ok: false, error: postsError.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
  const withPosts = new Set((publishedRows ?? []).map((r) => r.brand_id as string));

  let query = admin.from('brands').select('id, name, slug, org_id, last_digest_sent_at').in('status', ['active', 'trial']);
  if (brandSlug) query = query.eq('slug', brandSlug);
  const { data: brands, error } = await query;
  if (error) {
    console.error('[digest tick] could not load brands:', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  // Best-effort per brand: one failure (contacts lookup, build, send) never blocks the others.
  const eligible = (brands ?? []).filter((b) => withPosts.has(b.id));
  let sent = 0;
  const errors: { brand: string; reason: string }[] = [];

  // Idempotency: claim the brand BEFORE building/sending (a double-fired cron must not email
  // the fleet twice). The claim is also the cursor for `?brand=` retries: a brand whose send
  // failed mid-way is claimed, so it is NOT re-emailed by the next run — acceptable for a
  // best-effort daily digest (the weekly recap email still covers the content).
  const today = new Date().toISOString().slice(0, 10);
  for (const brand of eligible) {
    // Conditional claim: the UPDATE itself carries the guard (null or before today) so two
    // overlapping cron runs can't both claim and double-send — the loser updates 0 rows.
    const { data: claimedRows } = await admin
      .from('brands')
      .update({ last_digest_sent_at: new Date().toISOString() })
      .eq('id', brand.id)
      .or(`last_digest_sent_at.is.null,last_digest_sent_at.lt.${today}`)
      .select('id');
    if (!(claimedRows ?? []).length) continue; // loser of a concurrent double-fire claims 0 rows
    try {
      const contacts = await brandContacts(admin, brand.org_id, brand.id);
      if (!contacts.length) continue;
      const digest = await buildDailyDigest(admin, brand.id);
      if (digest.count === 0) continue;
      const emailed = await sendDailyDigest(admin, brand, contacts, digest);
      sent += emailed;
      console.log(`[digest tick] ${brand.slug}: ${digest.count} post(s) yesterday, ${emailed} email(s)`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'digest threw';
      errors.push({ brand: brand.slug, reason });
      console.error(`[digest tick] ${brand.slug} threw:`, reason);
    }
  }

  return new Response(JSON.stringify({ ok: true, brands: eligible.length, sent, errors }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => runTick(request);
export const POST: RequestHandler = ({ request }) => runTick(request);
