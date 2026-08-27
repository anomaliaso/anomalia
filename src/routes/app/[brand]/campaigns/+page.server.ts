import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { remaining, addUsage, monthKey } from '$lib/server/usage';
import { createSingleContent, attachBrandMoodImages, type ContentPrefs } from '$lib/server/content-preview';
import { wallClockToUtc } from '$lib/server/schedule';
import { fetchImagePart } from '$lib/server/brand-context';
import { fileToInlineImagePart } from '$lib/server/raster-image';
import { cachedBrandPage } from '$lib/server/page-cache';

type ImagePart = { inlineData: { mimeType: string; data: string } };
const MAX_REFS = 6;

// Reference images for the campaign's 5 posts: uploaded files (device) + selected URLs (own past
// posts and/or a competitor's, picked via SocialThumbPicker) — mirrors create-single/+server.ts.
async function resolveRefs(formData: FormData): Promise<ImagePart[]> {
  const refs: ImagePart[] = [];
  for (const entry of formData.getAll('refs')) {
    if (refs.length >= MAX_REFS) break;
    if (!(entry instanceof File) || entry.size === 0) continue;
    const part = await fileToInlineImagePart(entry);
    if (part) refs.push(part);
  }

  let urls: string[] = [];
  try {
    const raw = JSON.parse(String(formData.get('ref_urls') ?? '[]'));
    if (Array.isArray(raw)) urls = raw.filter((u) => typeof u === 'string');
  } catch {
    // ignore malformed input — refs from files still work
  }
  for (const url of urls) {
    if (refs.length >= MAX_REFS) break;
    const part = await fetchImagePart(url);
    if (part) refs.push(part);
  }

  return refs.slice(0, MAX_REFS);
}

// Image generation × 5 steps is slow — give the action room to finish.
export const config = { maxDuration: 300 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// The fixed, deterministic 5-step arc. dayOffset is relative to the event date; brief() combines
// the step's intent with the user's own brief so createSingleContent gets a self-contained ask.
const ARC_STEPS: { key: string; dayOffset: number; brief: (name: string, userBrief: string) => string }[] = [
  {
    key: 'announcement',
    dayOffset: -7,
    brief: (name, userBrief) => `Announce the upcoming event "${name}". ${userBrief} This is the reveal post — introduce the event and build excitement that it's coming.`
  },
  {
    key: 'countdown',
    dayOffset: -3,
    brief: (name, userBrief) => `Countdown post for the event "${name}" — only a few days left. ${userBrief} Build anticipation, mention the days-to-go feeling.`
  },
  {
    key: 'spotlight',
    dayOffset: -2,
    brief: (name, userBrief) => `Spotlight post for the event "${name}". ${userBrief} Highlight one specific offering, menu item, or moment tied to the event.`
  },
  {
    key: 'day_of',
    dayOffset: 0,
    brief: (name, userBrief) => `It's today! Final reminder post for the event "${name}", happening today. ${userBrief} Urgent, don't-miss-it energy.`
  },
  {
    key: 'recap',
    dayOffset: 1,
    brief: (name, userBrief) => `Thank-you and recap post the day after the event "${name}". ${userBrief} Thank everyone who joined, recap the highlights.`
  }
];

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildProfile(supabase: any, brandRow: AnyRec): Promise<AnyRec> {
  const brandId = brandRow.id as string;
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, fonts, ai_character, ai_context, visual_style, site_type')
    .eq('brand_id', brandId)
    .maybeSingle();
  const profile: AnyRec = {
    name: brandRow.name ?? '',
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    brand_colors: kit?.brand_colors ?? [],
    fonts: kit?.fonts ?? [],
    ai_character: kit?.ai_character ?? {},
    ai_context: kit?.ai_context ?? '',
    visual_style: kit?.visual_style ?? '',
    site_type: kit?.site_type ?? 'generic'
  };
  await attachBrandMoodImages(profile, supabase, brandId);
  return profile;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateArc(args: {
  supabase: any;
  userId: string;
  brandId: string;
  profile: AnyRec;
  prefs: ContentPrefs;
  tz: string;
  name: string;
  eventDate: string;
  platform: string;
  brief: string;
  maxPosts: number;
  referenceImages?: ImagePart[];
}): Promise<number> {
  const { supabase, userId, brandId, profile, prefs, tz, name, eventDate, platform, brief, maxPosts, referenceImages } = args;

  const steps = ARC_STEPS.slice(0, Math.min(ARC_STEPS.length, maxPosts));
  const campaignId = crypto.randomUUID();
  let created = 0;

  for (const step of steps) {
    const scheduledFor = wallClockToUtc(addDays(eventDate, step.dayOffset), '10:00', tz);
    try {
      const result = await createSingleContent({
        supabase,
        userId,
        brandId,
        profile,
        platform,
        format: 'post',
        brief: step.brief(name, brief),
        prefs,
        referenceImages
      });
      if (!result.imageUrl) continue;

      const { error: insErr } = await supabase.from('posts').insert({
        brand_id: brandId,
        platform,
        content_type: 'generated_image',
        format: 'single_image',
        source: 'manual',
        caption: result.caption || null,
        image_prompt: result.imagePrompt || null,
        media_url: result.imageUrl,
        status: 'pending_user',
        scheduled_for: scheduledFor,
        campaign_id: campaignId,
        campaign_name: name,
        campaign_step: step.key
      });
      if (!insErr) {
        created += 1;
        await addUsage(supabase, brandId, monthKey(tz), { posts: 1, videos: 0 });
      }
    } catch (error) { swallow('create campaign arc step', error); }
  }

  return created;
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: rows }, { data: brandRow }, { data: ownThumbRows }] = await Promise.all([
      supabase
        .from('posts')
        .select('id, campaign_id, campaign_name, campaign_step, caption, media_url, status, scheduled_for, platform, created_at')
        .eq('brand_id', brand.id)
        .not('campaign_id', 'is', null)
        .order('scheduled_for', { ascending: true }),
      supabase.from('brands').select('target_platforms').eq('id', brand.id).maybeSingle(),
      supabase
        .from('posts')
        .select('media_url')
        .eq('brand_id', brand.id)
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(12)
    ]);
    const ownThumbs = (ownThumbRows ?? []).map((r: AnyRec) => r.media_url as string).filter(Boolean);

    // Group posts sharing a campaign_id into one campaign — the campaign IS the group, no table.
    const byId = new Map<string, AnyRec>();
    for (const r of rows ?? []) {
      const id = r.campaign_id as string;
      if (!byId.has(id)) byId.set(id, { campaign_id: id, campaign_name: r.campaign_name, posts: [] });
      byId.get(id)!.posts.push({
        id: r.id,
        campaign_step: r.campaign_step,
        caption: r.caption,
        media_url: r.media_url,
        status: r.status,
        scheduled_for: r.scheduled_for,
        platform: r.platform
      });
    }
    const campaigns = [...byId.values()].sort((a, b) => {
      const earliest = (c: AnyRec) => Math.min(...c.posts.map((p: AnyRec) => (p.scheduled_for ? new Date(p.scheduled_for).getTime() : Infinity)));
      return earliest(b) - earliest(a);
    });

    const platforms = Array.isArray(brandRow?.target_platforms) && brandRow.target_platforms.length
      ? (brandRow!.target_platforms as string[]).map((p) => String(p).toLowerCase())
      : ['instagram'];

    return { campaigns, platforms, ownThumbs };
  });
};

export const actions: Actions = {
  create: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Not authenticated' });

    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const eventDate = String(form.get('event_date') ?? '').trim();
    const platform = String(form.get('platform') ?? '').trim().toLowerCase();
    const brief = String(form.get('brief') ?? '').trim();

    if (!name || !eventDate || !platform) return fail(400, { error: 'Missing fields' });
    if (Number.isNaN(Date.parse(eventDate))) return fail(400, { error: 'Invalid date' });

    const { data: brandRow } = await supabase
      .from('brands')
      .select('id, name, plan, timezone, content_prefs')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brandRow) return fail(404, { error: 'Brand not found' });
    const brandId = brandRow.id as string;
    const tz = brandRow.timezone ?? 'Europe/Rome';

    const budget = await remaining(supabase, brandId, brandRow.plan, tz);
    if (budget.posts <= 0) return fail(400, { error: 'Hai raggiunto il limite mensile di post.' });
    if (budget.credits.remaining <= 0) return fail(400, { error: 'Crediti esauriti. Aggiorna il piano per continuare.' });

    const profile = await buildProfile(supabase, brandRow);
    const prefs: ContentPrefs = (brandRow.content_prefs as ContentPrefs) ?? {};
    const referenceImages = await resolveRefs(form);

    const created = await generateArc({
      supabase,
      userId: user.id,
      brandId,
      profile,
      prefs,
      tz,
      name,
      eventDate,
      platform,
      brief,
      maxPosts: budget.posts,
      referenceImages
    });

    if (created === 0) return fail(500, { error: 'Generazione fallita. Riprova.' });
    const requested = Math.min(ARC_STEPS.length, budget.posts);
    return { success: true, count: created, requested, campaignName: name };
  },

  createBulk: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Not authenticated' });

    const form = await request.formData();
    const eventsText = String(form.get('events') ?? '').trim();

    if (!eventsText) return fail(400, { error: 'Missing events' });

    // Parse events: each line is "Name | YYYY-MM-DD | optional brief"
    const lines = eventsText.split('\n').map(l => l.trim()).filter(l => l);
    const events: Array<{ name: string; date: string; brief: string }> = [];

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      const name = parts[0];
      const date = parts[1];
      const brief = parts[2] ?? '';

      if (!name || !date) continue; // skip invalid lines
      if (Number.isNaN(Date.parse(date))) continue; // skip invalid dates

      events.push({ name, date, brief });
      if (events.length >= 3) break; // cap at 3
    }

    if (events.length === 0) return fail(400, { error: 'Nessun evento valido trovato.' });

    const { data: brandRow } = await supabase
      .from('brands')
      .select('id, name, plan, timezone, content_prefs, target_platforms')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brandRow) return fail(404, { error: 'Brand not found' });
    const brandId = brandRow.id as string;
    const tz = brandRow.timezone ?? 'Europe/Rome';

    const budget = await remaining(supabase, brandId, brandRow.plan, tz);
    if (budget.posts <= 0) return fail(400, { error: 'Hai raggiunto il limite mensile di post.' });
    if (budget.credits.remaining <= 0) return fail(400, { error: 'Crediti esauriti. Aggiorna il piano per continuare.' });

    const profile = await buildProfile(supabase, brandRow);
    const prefs: ContentPrefs = (brandRow.content_prefs as ContentPrefs) ?? {};

    // Determine the platform to use for all events
    const platforms = Array.isArray(brandRow?.target_platforms) && brandRow.target_platforms.length
      ? (brandRow!.target_platforms as string[]).map((p) => String(p).toLowerCase())
      : ['instagram'];
    const platform = platforms[0];

    let postsLeft = budget.posts;
    let campaignsCreated = 0;
    let totalCreated = 0;

    for (const event of events) {
      if (postsLeft <= 0) break;

      const created = await generateArc({
        supabase,
        userId: user.id,
        brandId,
        profile,
        prefs,
        tz,
        name: event.name,
        eventDate: event.date,
        platform,
        brief: event.brief,
        maxPosts: Math.min(5, postsLeft)
      });

      if (created > 0) {
        campaignsCreated += 1;
        totalCreated += created;
        postsLeft -= created;
      }
    }

    if (totalCreated === 0) return fail(500, { error: 'Generazione fallita. Riprova.' });
    return { success: true, campaigns: campaignsCreated, count: totalCreated };
  }
};
