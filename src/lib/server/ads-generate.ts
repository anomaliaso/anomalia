import type { SupabaseClient } from '@supabase/supabase-js';
import { PROOF_DISCIPLINE_RULE } from '$lib/server/proof-discipline';
import { disruptiveBriefSection } from '$lib/disruptive';
import { genaiClient, structured } from './research';
import { PIN_GEMINI } from './xiaomi';
import { parseAdsSettings, SUPPORTED_GOALS, type AdsChannel } from './ads';
import { normalizeUrl } from '$lib/ads-fee';

// AI-written ad campaigns. The user picks a channel and (optionally) says what to push; everything
// a platform needs — name, objective, copy variants, keywords, targeting, budget — comes back
// filled from brand context. The draft is editable and still lands as a `proposed` campaign: this
// writes nothing to Meta/Google and spends no ad money on its own.

export type CampaignDraft = {
  name: string;
  goal: string;
  campaignType?: 'SEARCH' | 'DISPLAY';
  budgetAmount: number;
  headline: string;
  additionalHeadlines: string[];
  body: string;
  additionalDescriptions: string[];
  keywords: string[];
  landingPageUrl: string;
  businessName: string;
  countries: string[];
  ageMin: number;
  ageMax: number;
  rationale: string;
};

const DRAFT_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    goal: { type: 'string' as const },
    budgetAmount: { type: 'number' as const },
    headline: { type: 'string' as const },
    additionalHeadlines: { type: 'array' as const, items: { type: 'string' as const } },
    body: { type: 'string' as const },
    additionalDescriptions: { type: 'array' as const, items: { type: 'string' as const } },
    keywords: { type: 'array' as const, items: { type: 'string' as const } },
    countries: { type: 'array' as const, items: { type: 'string' as const } },
    ageMin: { type: 'number' as const },
    ageMax: { type: 'number' as const },
    rationale: { type: 'string' as const }
  },
  required: ['name', 'goal', 'budgetAmount', 'headline', 'body', 'rationale']
};

const SYSTEM =
  'You are a senior paid-media strategist. You write ad campaigns that respect each platform\'s ' +
  'hard limits to the character, and you never invent claims, offers, discounts, prices or ' +
  'guarantees that the brand context does not support. Plain, concrete language — no hype, no ' +
  'emoji, no ALL CAPS. Write in the language of the brand and its audience.\n\n' +
  // Paid copy is where an invented number stops being embarrassing and becomes a legal exposure:
  // it is a claim the brand is PAYING to broadcast, under advertising rules that treat it as such.
  PROOF_DISCIPLINE_RULE +
  // Il paid è dove un annuncio corretto costa: una variante che qualunque concorrente potrebbe
  // pubblicare cambiando il logo si paga a CPM pieno per non farsi ricordare. Il contrasto qui ha
  // limiti più stretti, non più larghi — la dottrina li porta con sé.
  '\n\n' +
  disruptiveBriefSection() +
  '\nAlmeno UNA delle headline o dei testi alternativi deve essere costruita su una leva di contrasto. Nel paid i limiti valgono doppio: nessun concorrente nominato o riconoscibile, nessuna prova non supportata dal contesto di brand, nessuna urgenza inventata.';

/** Goals each network accepts on create, from the one list we can actually deliver (see ads.ts). */
const GOALS: Record<AdsChannel, string[]> = {
  google: [...SUPPORTED_GOALS],
  social: [...SUPPORTED_GOALS]
};

export async function generateCampaignDraft(
  supabase: SupabaseClient,
  brand: {
    id: string;
    name: string;
    website: string | null;
    ads_settings?: unknown;
  },
  opts: {
    channel: AdsChannel;
    campaignType?: 'SEARCH' | 'DISPLAY';
    /** Free-text steer from the user ("push the new autumn menu"). Optional by design. */
    brief?: string;
    budgetAmount?: number;
    landingUrl?: string;
  }
): Promise<CampaignDraft> {
  const settings = parseAdsSettings(brand.ads_settings);
  const isGoogle = opts.channel === 'google';
  const countries = settings.defaultCountries?.length ? settings.defaultCountries : ['IT'];
  const cap = settings.dailyBudgetCap ?? 25;

  const { data: kit } = await supabase
    .from('brand_kit')
    .select('about, target_audience, brand_style, ai_character')
    .eq('brand_id', brand.id)
    .maybeSingle();

  // What already worked organically is the cheapest angle research available.
  const { data: winners } = await supabase
    .from('posts')
    .select('caption, platform')
    .eq('brand_id', brand.id)
    .eq('status', 'published')
    .order('scheduled_for', { ascending: false })
    .limit(5);

  const limits = isGoogle
    ? `GOOGLE ${opts.campaignType === 'DISPLAY' ? 'RESPONSIVE DISPLAY' : 'RESPONSIVE SEARCH'} LIMITS (hard):
- headline: max 30 characters. additionalHeadlines: 4 to 8 more, each max 30 characters, each a DIFFERENT angle (no restating the same promise).
- body: max 90 characters. additionalDescriptions: 2 to 3 more, each max 90 characters.
- keywords: 8 to 15 search queries a buyer would actually type, lowercase, no brackets or symbols (broad match). ${opts.campaignType === 'DISPLAY' ? 'Display ignores keywords — return an empty array.' : ''}`
    : `META / SOCIAL LIMITS (hard):
- headline: max 40 characters, the single strongest hook.
- additionalHeadlines: 2 to 4 alternatives, each max 40 characters, for testing.
- body: the primary text, 1 to 3 short sentences, max 280 characters.
- additionalDescriptions: 1 to 2 alternative primary texts.
- keywords: not used on this channel — return an empty array.`;

  const prompt = `Write one complete ad campaign for this brand.

BRAND: ${brand.name}
WEBSITE: ${brand.website ?? '(none)'}
WHAT THEY DO: ${kit?.about ?? '(unknown)'}
AUDIENCE: ${kit?.target_audience ?? '(unknown)'}
VOICE: ${kit?.ai_character ?? kit?.brand_style ?? '(neutral, professional)'}
${winners?.length ? `\nRECENT ORGANIC POSTS (reuse the angles that already speak to this audience):\n${winners.map((w) => `- [${w.platform}] ${String(w.caption ?? '').slice(0, 180)}`).join('\n')}\n` : ''}
CHANNEL: ${isGoogle ? `Google Ads, ${opts.campaignType ?? 'SEARCH'} campaign` : 'Meta (Facebook + Instagram) and other social networks'}
${opts.brief ? `WHAT TO PUSH (the user's instruction, follow it): ${opts.brief}` : 'No specific instruction — pick the offer or angle most likely to convert for this brand.'}
DESTINATION URL: ${opts.landingUrl || brand.website || '(none — write copy that works without a link)'}
COUNTRIES: ${countries.join(', ')}
DAILY BUDGET CAP: ${cap} ${settings.defaultCurrency ?? 'EUR'} — budgetAmount must be a whole number, at least 5 and never above this cap.${opts.budgetAmount ? ` The user asked for about ${opts.budgetAmount}.` : ''}

${limits}

Also return:
- name: an internal campaign name, max 60 characters, in the format "[channel] angle — country".
- goal: exactly one of ${GOALS[opts.channel].join(', ')}. Pick what the business actually needs, NOT 'traffic' by reflex: 'engagement' to build an audience, 'awareness' to be discovered, 'video_views' when the asset is a video.
- ageMin / ageMax: the realistic buying age range for this audience.
- countries: ISO-2 codes, normally the ones above.
- rationale: 1 or 2 sentences, in the brand's language, explaining the angle and the budget to the person who has to approve the spend.

Return JSON.`;

  const out = await structured<Record<string, unknown>>(genaiClient(), prompt, DRAFT_SCHEMA, SYSTEM, {
    label: 'ads_campaign_draft',
    brandId: brand.id,
    ...PIN_GEMINI
  });

  const strList = (v: unknown, max: number, limit: number) =>
    Array.isArray(v)
      ? v.map((s) => String(s).trim()).filter(Boolean).map((s) => s.slice(0, max)).slice(0, limit)
      : [];
  const headlineMax = isGoogle ? 30 : 40;
  const bodyMax = isGoogle ? 90 : 280;
  const goal = GOALS[opts.channel].includes(String(out.goal)) ? String(out.goal) : 'traffic';
  const budget = Math.max(5, Math.min(cap, Math.round(Number(out.budgetAmount) || 0) || 10));
  // An empty array is truthy — check length, or a model that skipped `countries` would silently
  // target nowhere instead of falling back to the brand's default markets.
  const modelCountries = strList(out.countries, 2, 10)
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));

  return {
    name: String(out.name ?? `${isGoogle ? 'Google' : 'Meta'} — ${brand.name}`).slice(0, 60),
    goal,
    campaignType: isGoogle ? (opts.campaignType ?? 'SEARCH') : undefined,
    budgetAmount: budget,
    headline: String(out.headline ?? '').slice(0, headlineMax),
    additionalHeadlines: strList(out.additionalHeadlines, headlineMax, 8),
    body: String(out.body ?? '').slice(0, bodyMax),
    additionalDescriptions: strList(out.additionalDescriptions, bodyMax, 3),
    keywords: isGoogle && opts.campaignType !== 'DISPLAY' ? strList(out.keywords, 80, 15) : [],
    // Models write "anomalia.so"; the form and the platform both want a full URL.
    landingPageUrl: normalizeUrl(opts.landingUrl || brand.website || ''),
    businessName: brand.name.slice(0, 25),
    countries: modelCountries.length ? modelCountries : countries,
    ageMin: Math.max(13, Math.min(65, Math.round(Number(out.ageMin) || 25))),
    ageMax: Math.max(18, Math.min(65, Math.round(Number(out.ageMax) || 55))),
    rationale: String(out.rationale ?? '')
  };
}
