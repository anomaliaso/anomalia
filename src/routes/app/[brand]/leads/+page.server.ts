import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { hasProRadarLeads } from '$lib/server/plans';
import { INTENT_RANK, normalizeIntent } from '$lib/leads-intent';
import { cachedBrandPage } from '$lib/server/page-cache';

// Leads — the AI-drafted reply suggestions (Reddit/Threads/X conversations worth joining), split
// out of Radar into their own page with status filters and manual done/ignore actions.
// Finding + drafting is a plan entitlement (see /pricing leadSources) — no connected social account
// required. Anomalia drafts; the human pastes. Free matches Go.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandBySlug(supabase: any, slug: string) {
  const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  return data;
}

const TREND_DAYS = 30;

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const now = Date.now();
    const since = (days: number) => new Date(now - days * 86_400_000).toISOString();

    const [{ data: leads }, { data: recent }] = await Promise.all([
      supabase
        .from('brand_news_items')
        .select('id, title, url, source_name, snippet, gist, status, relevance, intent, suggestion, dm_draft, dm_target, created_at')
        .eq('brand_id', brand.id)
        .in('status', ['suggested', 'done', 'dismissed'])
        .not('suggestion', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200),
      // One timestamp scan covers both the 30-day trend and the 24h/3d/7d counters.
      supabase
        .from('brand_news_items')
        .select('created_at')
        .eq('brand_id', brand.id)
        .in('status', ['suggested', 'done', 'dismissed'])
        .not('suggestion', 'is', null)
        .gte('created_at', since(TREND_DAYS))
        .limit(5000)
    ]);

    // L'esito dell'ultimo controllo per ogni lead già segnato come fatto: senza mostrarlo, il loop
    // che abbiamo appena chiuso resterebbe un dato che non guarda nessuno.
    const { data: outcomes } = await supabase
      .from('lead_outcomes')
      .select('lead_id, found, upvotes, replies, removed, checked_at')
      .eq('brand_id', brand.id)
      .order('checked_at', { ascending: false })
      .limit(400);
    const outcomeByLead = new Map<string, { found: boolean; upvotes: number | null; replies: number | null; removed: boolean | null }>();
    for (const o of outcomes ?? []) {
      // Ordinati dal più recente: il primo che arriva per un lead è l'ultima parola.
      if (!outcomeByLead.has(o.lead_id as string)) {
        outcomeByLead.set(o.lead_id as string, {
          found: o.found as boolean,
          upvotes: o.upvotes as number | null,
          replies: o.replies as number | null,
          removed: o.removed as boolean | null
        });
      }
    }

    const stamps = (recent ?? []).map((r: { created_at: string }) => r.created_at);
    const perDay = new Map<string, number>();
    for (const s of stamps) {
      const k = s.slice(0, 10); // UTC day
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const days = Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = new Date(now - (TREND_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: perDay.get(date) ?? 0 };
    });
    const countSince = (d: number) => {
      const cut = now - d * 86_400_000;
      return stamps.filter((s) => Date.parse(s) >= cut).length;
    };

    // Queue order: whoever is closest to buying first, freshness second. Sorting by created_at
    // alone buried a "which tool should I use for X" thread under a day of general chatter.
    const withOutcome = (leads ?? []).map((l) => ({ ...l, outcome: outcomeByLead.get(l.id as string) ?? null }));

    const ranked = [...withOutcome].sort(
      (a, b) =>
        (INTENT_RANK[normalizeIntent(b.intent)] ?? 0) - (INTENT_RANK[normalizeIntent(a.intent)] ?? 0) ||
        Date.parse(b.created_at) - Date.parse(a.created_at)
    );

    return {
      leads: ranked,
      hasProRadarLeads: hasProRadarLeads(brand.plan),
      trend: days,
      found: { day: countSince(1), threeDays: countSince(3), week: countSince(7) }
    };
  });
};

// brand_news_items RLS is SELECT-only for users (Radar writes it server-side), so status updates
// go through the admin client — the brand_id eq() below is the authorization guard, proven by the
// user-scoped brandBySlug lookup above it.
async function setStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { brand: string },
  request: Request,
  status: 'done' | 'dismissed' | 'suggested'
) {
  const brand = await brandBySlug(supabase, params.brand);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const id = String(fd.get('id') ?? '');
  if (!id) return fail(400, { error: 'Missing id' });
  const { createAdminClient } = await import('$lib/server/supabase-admin');
  // `done_at` è il momento in cui il commento è stato (presumibilmente) incollato: è da lì che si
  // contano le 48h prima di tornare a vedere com'è andata. Solo su 'done' — ignorare e ripristinare
  // non sono eventi da misurare. Riportare a 'suggested' lo azzera, così un "fatto" per sbaglio non
  // lascia dietro un esito che nessuno ha mai prodotto.
  const patch: Record<string, unknown> = { status };
  if (status === 'done') patch.done_at = new Date().toISOString();
  if (status === 'suggested') patch.done_at = null;
  const { error } = await createAdminClient().from('brand_news_items').update(patch).eq('id', id).eq('brand_id', brand.id);
  if (error) return fail(500, { error: error.message });
  return { saved: true };
}

// "Non contattare mai più": soppressione globale (ogni brand dell'istanza) per l'autore del lead,
// poi il lead esce dalla coda come gli altri ignorati. Senza handle noto niente da sopprimere:
// resta comunque un dismiss.
async function suppressLead(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { brand: string },
  request: Request
) {
  const brand = await brandBySlug(supabase, params.brand);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const id = String(fd.get('id') ?? '');
  if (!id) return fail(400, { error: 'Missing id' });
  const { createAdminClient } = await import('$lib/server/supabase-admin');
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from('brand_news_items')
    .select('url, dm_target, author_handle, author_platform')
    .eq('id', id)
    .eq('brand_id', brand.id)
    .maybeSingle();
  const handle = lead?.author_handle || lead?.dm_target;
  if (lead && handle) {
    const { suppressAuthor, platformOf } = await import('$lib/server/lead-contact');
    await suppressAuthor(admin, {
      platform: lead.author_platform ?? platformOf(String(lead.url ?? '')),
      handle: String(handle),
      source: 'manual',
      reason: 'marked by the brand in /leads'
    });
  }
  const { error } = await admin.from('brand_news_items').update({ status: 'dismissed' }).eq('id', id).eq('brand_id', brand.id);
  if (error) return fail(500, { error: error.message });
  return { saved: true };
}

// AI rewrite — re-drafts the comment/DM incorporating user feedback, using stored context.
async function rewriteSuggestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: { brand: string },
  request: Request
) {
  const brand = await brandBySlug(supabase, params.brand);
  if (!brand) return fail(404, { error: 'Brand not found' });

  const fd = await request.formData();
  const id = String(fd.get('id') ?? '');
  const feedback = String(fd.get('feedback') ?? '').trim();
  const field = String(fd.get('field') ?? 'comment'); // 'comment' | 'dm'
  if (!id) return fail(400, { error: 'Missing id' });
  if (!feedback) return fail(400, { error: 'Missing feedback' });

  const { createAdminClient } = await import('$lib/server/supabase-admin');
  const admin = createAdminClient();

  // Fetch the lead (brand_id guard = authorization).
  const { data: lead, error: leadErr } = await admin
    .from('brand_news_items')
    .select('id, title, url, source_name, snippet, gist, suggestion, dm_draft, dm_target')
    .eq('id', id)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (leadErr || !lead) return fail(404, { error: 'Lead not found' });

  // Fetch brand context for the AI prompt.
  const [{ data: kit }, { data: brandRow }] = await Promise.all([
    admin.from('brand_kit').select('about, ai_context').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brands').select('website, name').eq('id', brand.id).maybeSingle()
  ]);

  const siteRaw = brand.website ?? brandRow?.website ?? '';
  let siteUrl = '';
  if (siteRaw) {
    try { siteUrl = `https://${new URL(/^https?:\/\//i.test(siteRaw) ? siteRaw : `https://${siteRaw}`).hostname.replace(/^www\./, '')}`; } catch { /* */ }
  }

  const currentText = field === 'dm' ? (lead.dm_draft ?? '') : (lead.suggestion ?? '');
  const isThreads = lead.url.includes('threads.net');
  const isX = lead.url.includes('x.com') || lead.url.includes('twitter.com');
  const platform = isThreads ? 'Threads' : isX ? 'X' : 'Reddit';

  return withBrandContext(brand.id, async () => {
  const { genaiClient } = await import('$lib/server/brand-context');
  const { aiStructured } = await import('$lib/server/xiaomi');
  const ai = genaiClient();

  const REWRITE_SCHEMA = {
    type: 'object' as const,
    properties: {
      text: { type: 'string' as const, description: field === 'dm' ? 'The rewritten DM, 30-90 words.' : 'The rewritten comment, 60-150 words.' }
    },
    required: ['text']
  };

  const result = await aiStructured<{ text?: string }>(
    ai,
    `You are rewriting a ${field === 'dm' ? 'private DM to the post author' : 'public reply comment'} for a brand engaging in an online conversation on ${platform}.

Brand: ${brandRow?.name ?? ''} — ${String(kit?.about ?? '').slice(0, 300)}
${siteUrl ? `Brand site: ${siteUrl}\n` : ''}${kit?.ai_context ? `Voice & expertise:\n${String(kit.ai_context).slice(0, 1200)}\n` : ''}
THREAD "${lead.title}":
${(lead.gist || lead.snippet || '').slice(0, 1500) || '(no body — title only)'}
${lead.source_name ? `SOURCE: ${lead.source_name}` : ''}
${lead.dm_target ? `POST AUTHOR: ${lead.dm_target}` : ''}

CURRENT ${field.toUpperCase()}:
${currentText}

USER FEEDBACK (apply this):
${feedback}

Rewrite the ${field} incorporating the feedback. Keep it natural, platform-appropriate, value-first — never marketing phrasing. Same language as the thread. ${field === 'dm' ? '30-90 words, warm and personal.' : '60-150 words.'}`,
    REWRITE_SCHEMA,
    'You write authentic online replies that earn engagement because they help. You would rather say nothing than sound like an ad.',
    'return_rewrite'
  );

  const newText = String(result?.text ?? '').trim();
  if (!newText) return fail(500, { error: 'AI returned empty' });

  // Update the lead.
  const updatePayload = field === 'dm' ? { dm_draft: newText } : { suggestion: newText };
  const { error: updErr } = await admin.from('brand_news_items').update(updatePayload).eq('id', id).eq('brand_id', brand.id);
  if (updErr) return fail(500, { error: updErr.message });

  // La riscrittura è l'unico punto in cui vediamo il prima→dopo dell'utente su una bozza radar:
  // è ground truth su cosa non andava. La coppia finisce in content_prefs.radar.editPairs (jsonb
  // già esistente — niente tabelle nuove, le migration non si applicano da sole al deploy) e il
  // drafter la rilegge al giro successivo (buildEngagePrompt) per assorbire il gusto dell'utente.
  // Solo il campo comment: è quello che il drafter genera; i DM hanno vincoli propri.
  // ponytail: read-modify-write senza lock — le riscritture sono rare e manuali, un conflitto al
  // massimo perde una coppia di learning, mai dati dell'utente.
  if (field === 'comment' && currentText.trim()) {
    try {
      const { data: b } = await admin.from('brands').select('content_prefs').eq('id', brand.id).maybeSingle();
      const cp = (b?.content_prefs ?? {}) as Record<string, unknown>;
      const radar = (cp.radar && typeof cp.radar === 'object' ? cp.radar : {}) as Record<string, unknown>;
      const prev = Array.isArray(radar.editPairs) ? radar.editPairs : [];
      const pairs = [
        ...prev,
        { before: currentText.slice(0, 600), after: newText.slice(0, 600), feedback: feedback.slice(0, 200), at: new Date().toISOString() }
      ].slice(-5); // le ultime 5 bastano: il drafter ne legge 3, e il jsonb non deve crescere per sempre
      await admin.from('brands').update({ content_prefs: { ...cp, radar: { ...radar, editPairs: pairs } } }).eq('id', brand.id);
    } catch (e) {
      // Il learning è best-effort: non deve mai far fallire la riscrittura che l'utente ha davanti.
      console.warn('[leads] editPairs capture failed:', e instanceof Error ? e.message : e);
    }
  }

  return { rewritten: true, field, text: newText };
  });
}

export const actions: Actions = {
  markDone: ({ request, params, locals: { supabase } }) => setStatus(supabase, params as { brand: string }, request, 'done'),
  dismiss: ({ request, params, locals: { supabase } }) => setStatus(supabase, params as { brand: string }, request, 'dismissed'),
  restore: ({ request, params, locals: { supabase } }) => setStatus(supabase, params as { brand: string }, request, 'suggested'),
  suppress: ({ request, params, locals: { supabase } }) => suppressLead(supabase, params as { brand: string }, request),
  rewrite: ({ request, params, locals: { supabase } }) => rewriteSuggestion(supabase, params as { brand: string }, request)
};
