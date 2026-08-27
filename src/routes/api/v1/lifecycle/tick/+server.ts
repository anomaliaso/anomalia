import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import type { SupabaseClient } from '@supabase/supabase-js';
import { brandContacts } from '$lib/server/scheduler';
import { brandStage } from '$lib/server/lifecycle';
import {
  welcomeEmailSubject,
  welcomeEmailHtml,
  welcomeEmailText,
  day1EmailSubject,
  day1EmailHtml,
  day1EmailText,
  stepEmailSubject,
  stepEmailHtml,
  stepEmailText
} from '$lib/server/email';
import { senderEmailDomain } from '$lib/server/support-config';

// Lifecycle drip: welcome (T+0), day-1 call-insist, day-2/3 next-step. Runs every 10 min so the
// welcome lands within minutes of signup. Each (brand, step) is sent at most once (dedup ledger,
// migration 0097). Gated behind the app_flag 'lifecycle_emails' for the scheduled run; test any
// single brand with ?brand=<slug> (bypasses the flag), and ?force=1&step=<step> to re-send.

export const config = { maxDuration: 300 };

const CALL_URL = env.CALENDLY_URL || 'https://calendly.com/marco-anomalia/call-conoscitiva-anomalia';
const unsubHeaders = (): Record<string, string> => ({
  'List-Unsubscribe': `<mailto:unsubscribe@${senderEmailDomain()}?subject=unsubscribe>`
});

type Step = 'welcome' | 'day1_call' | 'day2_step' | 'day3_step';
const THRESHOLD_H: Record<Step, number> = { welcome: 0, day1_call: 24, day2_step: 48, day3_step: 72 };
const ORDER: Step[] = ['welcome', 'day1_call', 'day2_step', 'day3_step'];
// Don't back-blast trials older than the drip window when the flag is first switched on.
const DRIP_MAX_AGE_H = 24 * 5;

type BrandRow = { id: string; name: string; slug: string; org_id: string; created_at: string };

async function ownerName(admin: SupabaseClient, brand: BrandRow): Promise<string> {
  const { data: org } = await admin.from('organizations').select('owner_id').eq('id', brand.org_id).maybeSingle();
  if (!org?.owner_id) return brand.name;
  const { data: p } = await admin.from('profiles').select('full_name, email').eq('id', org.owner_id).maybeSingle();
  return p?.full_name?.trim() || (p?.email ? p.email.split('@')[0] : brand.name);
}

async function processBrand(
  admin: SupabaseClient,
  brand: BrandRow,
  opts: { origin?: string; force: boolean; forcedStep: Step | null; ignoreAgeCap: boolean }
): Promise<{ slug: string; sent: boolean; step?: Step; skipped?: boolean; error?: string }> {
  const ageH = (Date.now() - new Date(brand.created_at).getTime()) / 3.6e6;
  if (!opts.ignoreAgeCap && ageH > DRIP_MAX_AGE_H) return { slug: brand.slug, sent: false, skipped: true };

  const contacts = await brandContacts(admin, brand.org_id, brand.id);
  if (!contacts.length) return { slug: brand.slug, sent: false, skipped: true };

  // Which step to send: forced, or the first eligible-by-age step not already sent (one per run).
  let step: Step | null = null;
  if (opts.force) {
    step = opts.forcedStep ?? 'welcome';
  } else {
    const { data: sentRows } = await admin.from('lifecycle_emails').select('step').eq('brand_id', brand.id);
    const done = new Set((sentRows ?? []).map((r) => r.step as Step));
    step = ORDER.find((s) => ageH >= THRESHOLD_H[s] && !done.has(s)) ?? null;
  }
  if (!step) return { slug: brand.slug, sent: false, skipped: true };

  // Next-step nudges only make sense while the brand is still stuck in the funnel.
  let stage: Awaited<ReturnType<typeof brandStage>> | null = null;
  if (step === 'day2_step' || step === 'day3_step') {
    stage = await brandStage(admin, brand);
    if (stage.stage === 'done') return { slug: brand.slug, sent: false, skipped: true };
  }

  // Claim the step before sending so overlapping runs can't double-send (unique brand_id+step).
  if (!opts.force) {
    const { error: claimErr } = await admin.from('lifecycle_emails').insert({ brand_id: brand.id, step });
    if (claimErr) return { slug: brand.slug, sent: false, skipped: true }; // already claimed/sent
  }

  const name = await ownerName(admin, brand);
  const stepUrl = stage ? `${(publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '')}${stage.nextPath}` : '';
  const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const pushUrl =
    step === 'welcome' || step === 'day1_call'
      ? appBase
        ? `${appBase}/app/${brand.slug}`
        : ''
      : stepUrl || (appBase ? `${appBase}/app/${brand.slug}` : '');

  const { notifyBrandContacts } = await import('$lib/server/brand-notify');
  const sent = await notifyBrandContacts(admin, contacts, {
    logPrefix: `[lifecycle tick] ${step}`,
    buildEmail: (l, to) => {
      const common = { name, brandName: brand.name, brandSlug: brand.slug, callUrl: CALL_URL };
      let msg: { subject: string; html: string; text: string };
      if (step === 'welcome') {
        msg = {
          subject: welcomeEmailSubject(l, brand.name),
          html: welcomeEmailHtml(l, common, opts.origin),
          text: welcomeEmailText(l, common, opts.origin)
        };
      } else if (step === 'day1_call') {
        msg = {
          subject: day1EmailSubject(l, name, brand.name),
          html: day1EmailHtml(l, common, opts.origin),
          text: day1EmailText(l, common, opts.origin)
        };
      } else {
        const day = step === 'day3_step' ? 3 : 2;
        const stepOpts = { name, brandName: brand.name, stage: stage!.stage, stepUrl, callUrl: CALL_URL, day: day as 2 | 3 };
        msg = {
          subject: stepEmailSubject(l, brand.name, stage!.stage),
          html: stepEmailHtml(l, stepOpts, opts.origin),
          text: stepEmailText(l, stepOpts, opts.origin)
        };
      }
      return { to, ...msg, headers: unsubHeaders() };
    },
    push: pushUrl ? { url: pushUrl, tag: `lifecycle-${brand.id}-${step}` } : undefined
  });

  return { slug: brand.slug, sent: sent > 0, step };
}

async function runTick(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const brandSlug = url.searchParams.get('brand');
  const force = url.searchParams.get('force') === '1';
  const forcedStep = (url.searchParams.get('step') as Step | null) ?? null;
  const origin = publicEnv.PUBLIC_APP_URL || undefined;

  // Scheduled run stays off until the flag is flipped; ?brand=<slug> always runs (for testing).
  if (!brandSlug) {
    const { data: flag } = await admin.from('app_flags').select('enabled').eq('key', 'lifecycle_emails').maybeSingle();
    if (flag?.enabled !== true) {
      return new Response(JSON.stringify({ ok: true, disabled: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }

  let query = admin.from('brands').select('id, name, slug, org_id, created_at');
  query = brandSlug ? query.eq('slug', brandSlug) : query.eq('status', 'trial');
  const { data: brands, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  const results = await Promise.allSettled(
    (brands ?? []).map((b) => processBrand(admin, b as BrandRow, { origin, force, forcedStep, ignoreAgeCap: !!brandSlug }))
  );

  let sent = 0;
  let skipped = 0;
  const errors: { brand: string; reason: string }[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.sent) sent += 1;
      else skipped += 1;
    } else {
      errors.push({ brand: 'unknown', reason: r.reason?.message ?? 'rejected' });
    }
  }

  return new Response(JSON.stringify({ ok: true, total: brands?.length ?? 0, sent, skipped, errors }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => runTick(request);
export const POST: RequestHandler = ({ request }) => runTick(request);
