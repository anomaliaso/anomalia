import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { SET_BLOG_SETTINGS, statusForFailure } from '@anomalia/api-contracts';
import { blogConfigPatch, parseBlogConfig, patchBlogConfig } from '$lib/server/blog-settings';
import { FONT_KEYS } from '$lib/server/blog-site';
import { BLOG_LOCALES, isBlogLocale } from '$lib/server/blog-locales';
import {
  blogArticlesPerWeekMax,
  blogTranslationLanguages,
  hasBlogCustomDomain
} from '$lib/server/plans';
import { createAdminClient } from '$lib/server/supabase-admin';

// Come si vede e come scrive il blog del brand. La configurazione vive in `brands.blog_config`
// (jsonb), le tre liste in tabelle loro. Il client admin serve solo per quelle tre letture, che
// sono service-role; l'autorizzazione l'ha già fatta `loadBrandForUser`.

// I nomi delle chiavi jsonb sono in camelCase da quando la pagina esiste; l'API parla snake_case
// come il resto del registry. La corrispondenza sta qui, una volta, e non in venti punti.
const FIELD_KEYS: Record<string, string> = {
  enabled: 'enabled',
  title: 'title',
  description: 'description',
  accent: 'accent',
  font: 'font',
  layout: 'layout',
  show_blog_link: 'showBlogLink',
  humanizer_enabled: 'humanizerEnabled',
  backlink_network: 'backlinkNetwork',
  style_instructions: 'styleInstructions',
  articles_per_week: 'articlesPerWeek',
  default_locale: 'defaultLocale',
  locales: 'locales',
  navbar_links: 'navbarLinks',
  analytics: 'analytics'
};

type Cfg = Record<string, unknown>;

function view(cfg: Cfg, plan: string | null) {
  const parsed = parseBlogConfig(cfg, plan);
  return {
    enabled: parsed.enabled,
    title: parsed.title || null,
    description: parsed.description || null,
    accent: parsed.accent,
    font: parsed.font,
    layout: parsed.layout,
    show_blog_link: parsed.showBlogLink,
    humanizer_enabled: parsed.humanizerEnabled,
    backlink_network: parsed.backlinkNetwork,
    style_instructions: parsed.styleInstructions || null,
    articles_per_week: cfg.articlesPerWeek == null ? null : parsed.articlesPerWeek,
    // `defaultLocale` è sempre risolto (ripiega su una lingua vera); qui interessa se il brand
    // ne ha SCELTA una, e le lingue extra sono già ridotte al permesso del piano.
    default_locale: typeof cfg.defaultLocale === 'string' ? parsed.locales.defaultLocale : null,
    locales: parsed.locales.extraLocales,
    navbar_links: parsed.navbarLinks,
    icon_url: parsed.iconUrl,
    analytics: parsed.analytics
  };
}

async function lists(brandId: string) {
  const admin = createAdminClient();
  const [categories, tags, authors] = await Promise.all([
    admin.from('blog_categories').select('id, name, slug, description').eq('brand_id', brandId).order('sort_order'),
    admin.from('blog_tags').select('id, name, slug').eq('brand_id', brandId).order('name'),
    admin.from('blog_authors').select('id, name, slug, role, bio, avatar_url').eq('brand_id', brandId).order('name')
  ]);
  return {
    categories: categories.data ?? [],
    tags: tags.data ?? [],
    authors: authors.data ?? []
  };
}

async function currentConfig(brandId: string): Promise<Cfg> {
  const { data } = await createAdminClient()
    .from('brands')
    .select('blog_config')
    .eq('id', brandId)
    .maybeSingle();
  return (data?.blog_config ?? {}) as Cfg;
}

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const [cfg, rows] = await Promise.all([currentConfig(brand.id), lists(brand.id)]);

  return json({
    brand: brand.slug,
    plan: brand.plan,
    config: view(cfg, brand.plan),
    limits: {
      articles_per_week_max: blogArticlesPerWeekMax(brand.plan),
      translation_languages: blogTranslationLanguages(brand.plan),
      custom_domain: hasBlogCustomDomain(brand.plan)
    },
    choices: { fonts: FONT_KEYS, layouts: ['navbar', 'sidebar'], locales: [...BLOG_LOCALES] },
    ...rows
  });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_BLOG_SETTINGS.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const input = parsed.data as Record<string, unknown>;
  if (Object.keys(input).length === 0) {
    return json({ error: 'no_fields' }, { status: statusForFailure(SET_BLOG_SETTINGS, 'no_fields') });
  }

  // Una lingua che il blog non serve viene RIFIUTATA qui invece di essere scartata in silenzio:
  // scartarla lascerebbe l'agente convinto di aver acceso una traduzione che non esiste.
  const wanted = [
    ...(typeof input.default_locale === 'string' ? [input.default_locale] : []),
    ...(Array.isArray(input.locales) ? (input.locales as string[]) : [])
  ];
  const unknown = wanted.filter((l) => !isBlogLocale(String(l).toLowerCase()));
  if (unknown.length) {
    return json(
      { error: 'unknown_locale', unknown, allowed: [...BLOG_LOCALES] },
      { status: statusForFailure(SET_BLOG_SETTINGS, 'unknown_locale') }
    );
  }

  const current = await currentConfig(brand.id);
  const inner: Cfg = {};
  for (const [apiKeyName, cfgKey] of Object.entries(FIELD_KEYS)) {
    if (apiKeyName in input) inner[cfgKey] = input[apiKeyName];
  }

  const patch = blogConfigPatch(inner, brand.plan, current);
  const { error: updateError } = await patchBlogConfig(brand.id, patch);
  if (updateError) {
    return json(
      { error: 'update_failed', detail: updateError.message },
      { status: statusForFailure(SET_BLOG_SETTINGS, 'update_failed') }
    );
  }

  return json({ ok: true, config: view({ ...current, ...patch }, brand.plan) });
};
