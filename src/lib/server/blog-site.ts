// Public hosted-blog rendering. The visitor is anonymous (their own domain), so everything reads
// through the admin client — the data is intentionally public. Tenant is resolved by hostname.
import { swallow } from '$lib/server/swallow';
import { Marked } from 'marked';
import { createAdminClient } from './supabase-admin';
import { BLOG_LOCALE_LANGUAGE, resolveBlogLocales, type BlogLocaleConfig } from './blog-locales';
import { referralCodeForBrand } from './referrals';

/**
 * Which language version of the blog a request is for.
 *
 * Resolved against the DATA MODEL, not against the stored language string: originals ARE the default
 * locale (whatever their `language` column happens to say — legacy rows have 'Italian', 'it' or null),
 * and translations carry their own locale. Matching originals on a language string would have made
 * every pre-0129 article vanish the day locales shipped.
 */
export type LocaleScope = { kind: 'default' } | { kind: 'translation'; language: string };

/**
 * PostgREST filter constraining a brand_articles query to one language version, as a single `.or()`
 * clause so it chains inline (every query below is awaited in one expression).
 *
 * An ABSENT scope means ORIGINALS ONLY — deliberately, not "everything": a route that hasn't been
 * localised yet then behaves exactly as it did before translations existed, instead of silently
 * listing four language versions of every post. That default is what makes 0129 safe to deploy
 * before the locale routes land.
 *
 * Language names are fixed identifiers from BLOG_LOCALE_LANGUAGE ('Italian', 'Spanish', …), so they
 * carry no commas or parentheses that could break out of the filter expression.
 */
function localeFilter(scope?: LocaleScope): string {
  if (!scope || scope.kind === 'default') return 'translation_of.is.null';
  return `and(translation_of.not.is.null,language.eq.${scope.language})`;
}

export type BlogBrand = {
  brandId: string;
  name: string;         // display title (blog_config.title override, else brand name)
  description: string;  // SEO/site description (blog_config.description override, else brand about)
  accent: string;       // accent colour
  icon: string | null;  // header mark + favicon
  font: string;         // resolved CSS font-family stack
  navbarLinks: Array<{ label: string; url: string }>;  // custom nav links
  showBlogLink: boolean;                                // show default "Blog" link
  layout: 'navbar' | 'sidebar';                        // homepage layout
  locales: BlogLocaleConfig;                            // default locale + extra languages, plan-clamped
  /** Owner referral code for the public Powered-by badge (`?ref=`). */
  referralCode: string | null;
};

export type BlogCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
};

export type BlogTag = {
  id: string;
  name: string;
  slug: string;
};

export type BlogAuthor = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  role: string;
};

// Font presets → full CSS stacks (system fonts, no external load).
const FONTS: Record<string, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"
};
export const FONT_KEYS = Object.keys(FONTS);
const resolveFont = (key: unknown) => FONTS[String(key ?? '')] ?? FONTS.sans;

export type BlogArticle = {
  id: string;
  slug: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  bodyMd: string;
  coverImage: string | null;
  publishedAt: string | null;
  category: BlogCategory | null;
  tags: BlogTag[];
  author: BlogAuthor | null;
};

/** First usable logo URL from brand_kit.logos (string or { url }). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const firstLogoUrl = (logos: any): string | null => {
  const arr = Array.isArray(logos) ? logos : [];
  const first = arr.find((l: unknown) => {
    if (!l) return false;
    if (typeof l === 'string') return true;
    if (typeof l === 'object' && l !== null && 'url' in l) {
      const url = (l as { url?: unknown }).url;
      return typeof url === 'string' && !!url && (l as { type?: string }).type !== 'og-image';
    }
    return false;
  });
  return typeof first === 'string' ? first : (first?.url ?? null);
};

async function brandProfile(brandId: string): Promise<BlogBrand | null> {
  const admin = createAdminClient();
  const [{ data: brand }, { data: kit }, referralCode] = await Promise.all([
    // plan + content_prefs are needed to resolve the blog's locales: the extra-language allowance is
    // plan-gated, and an unconfigured blog defaults to the brand's own content language.
    admin.from('brands').select('id, name, blog_config, plan, content_prefs').eq('id', brandId).maybeSingle(),
    admin.from('brand_kit').select('about, theme_color, logos').eq('brand_id', brandId).maybeSingle(),
    referralCodeForBrand(brandId).catch((error) => { swallow('load referral code', error); return null; })
  ]);
  if (!brand) return null;
  const cfg = (brand.blog_config ?? {}) as Record<string, unknown>;
  return {
    brandId: brand.id,
    name: (String(cfg.title ?? '').trim() || brand.name) ?? '',
    description: String(cfg.description ?? '').trim() || String(kit?.about ?? ''),
    accent: String(cfg.accent ?? '').trim() || (kit?.theme_color as string | null) || '#111111',
    icon: (String(cfg.iconUrl ?? '').trim() || firstLogoUrl(kit?.logos)) || null,
    font: resolveFont(cfg.font),
    navbarLinks: Array.isArray(cfg.navbarLinks) ? (cfg.navbarLinks as Array<{ label: string; url: string }>).slice(0, 6) : [],
    showBlogLink: cfg.showBlogLink !== false,
    layout: cfg.layout === 'sidebar' ? 'sidebar' : 'navbar',
    locales: resolveBlogLocales(
      cfg,
      brand.plan as string | null,
      (brand.content_prefs as Record<string, unknown> | null)?.language as string | null
    ),
    referralCode
  };
}

// Resolve which brand a hostname serves (custom domain). Any brand_sites row means it was connected.
export async function resolveSiteBrand(host: string): Promise<BlogBrand | null> {
  const admin = createAdminClient();
  const { data: site } = await admin
    .from('brand_sites').select('brand_id').eq('host', host.toLowerCase()).maybeSingle();
  return site?.brand_id ? brandProfile(site.brand_id) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a brand for the default path-based blog URL (app-domain/blog/<key>). `key` is the unique
// blog_slug (pretty), or the brand id (uuid), or — for not-yet-provisioned brands — the raw slug.
export async function resolveSiteBrandByKey(key: string): Promise<BlogBrand | null> {
  const admin = createAdminClient();
  if (UUID_RE.test(key)) {
    const { data } = await admin.from('brands').select('id').eq('id', key).maybeSingle();
    return data?.id ? brandProfile(data.id) : null;
  }
  // blog_slug is unique → safe maybeSingle; fall back to the (possibly non-unique) slug, first match.
  const { data: bySlug } = await admin.from('brands').select('id').eq('blog_slug', key).maybeSingle();
  if (bySlug?.id) return brandProfile(bySlug.id);
  const { data: legacy } = await admin.from('brands').select('id').eq('slug', key).limit(1);
  return legacy?.[0]?.id ? brandProfile(legacy[0].id) : null;
}

// Provision a stable, globally-unique blog_slug for a brand (idempotent). Prefers the brand slug;
// adds a numeric suffix only if that's taken by another brand. Returns the slug (or the id on failure).
export async function ensureBlogSlug(brandId: string, baseSlug: string): Promise<string> {
  const admin = createAdminClient();
  const { data: b } = await admin.from('brands').select('blog_slug').eq('id', brandId).maybeSingle();
  if (b?.blog_slug) return b.blog_slug as string;
  const base = (baseSlug || 'blog').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'blog';
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { error } = await admin.from('brands').update({ blog_slug: candidate }).eq('id', brandId);
    if (!error) return candidate;
    if (error.code !== '23505') break; // not a uniqueness clash → give up
  }
  return brandId;
}

export async function listPublishedArticles(brandId: string, scope?: LocaleScope): Promise<BlogArticle[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published')
    .or(localeFilter(scope))
    .order('published_at', { ascending: false, nullsFirst: false });
  return (data ?? []).map(mapArticle);
}

/** Slug + lastmod only — used by sitemap.xml so we never load bodies/relations for crawlers. */
export async function listPublishedArticleUrls(
  brandId: string,
  scope?: LocaleScope
): Promise<Array<{ slug: string; publishedAt: string | null }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('brand_articles')
    .select('slug, published_at')
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .or(localeFilter(scope))
    .order('published_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r: { slug: string; published_at: string | null }) => ({
    slug: r.slug,
    publishedAt: r.published_at ?? null
  }));
}

export async function getPublishedArticle(brandId: string, slug: string, scope?: LocaleScope): Promise<BlogArticle | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published').eq('slug', slug)
    .or(localeFilter(scope)).maybeSingle();
  return data ? mapArticle(data) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapArticle(r: any): BlogArticle {
  const cat = r.category;
  const tagRows = Array.isArray(r.tags) ? r.tags.map((t: any) => t.blog_tags).filter(Boolean) : [];
  const author = r.author;
  return {
    id: r.id, slug: r.slug, title: r.title, metaTitle: r.meta_title ?? null,
    metaDescription: r.meta_description ?? null, bodyMd: r.body_md ?? '',
    coverImage: r.cover_image ?? null, publishedAt: r.published_at ?? null,
    category: cat ? { id: cat.id, name: cat.name, slug: cat.slug, description: cat.description ?? null, sortOrder: cat.sort_order ?? 0 } : null,
    tags: tagRows.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })),
    author: author ? { id: author.id, name: author.name, slug: author.slug, bio: author.bio ?? null, avatarUrl: author.avatar_url ?? null, role: author.role ?? 'writer' } : null
  };
}

// Markdown → HTML for the article body. The content is our own AI-authored markdown (no raw HTML
// requested), but this is a public page served via {@html} — so raw HTML in the source is ESCAPED,
// not filtered. Denylists (script/style/on*/javascript:) are provably bypassable (single-quote
// handlers, entity-encoded schemes, object/embed/svg payloads); escaping the html token renders
// any embedded markup as text, which closes every vector at once.
// Quotes are escaped too: the same helper fills href="…"/title="…" below, where a bare " ends the
// attribute and lets a link title inject an event handler. Inside escaped text they're harmless.
const escapeHtmlText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Only schemes safe to click on a public page survive; everything else (javascript:,
// data:, vbscript:) becomes a dead link.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/)/i;

const articleMarked = new Marked({
  renderer: {
    html(token) {
      return escapeHtmlText(typeof token === 'string' ? token : token.text ?? token.raw ?? '');
    },
    link(token) {
      const href = String(token.href ?? '');
      const safe = SAFE_HREF.test(href.trim()) ? href : '#';
      const title = token.title ? ` title="${escapeHtmlText(String(token.title))}"` : '';
      // Re-render the label from its inline tokens instead of emitting token.text raw: raw text is
      // the source markdown, so `[<img src=x onerror=…>](https://a.com)` would ship live markup.
      // Going back through the parser sends any embedded HTML through the `html` renderer above.
      const label = this.parser.parseInline(token.tokens ?? []);
      return `<a href="${escapeHtmlText(safe)}"${title}>${label}</a>`;
    }
  }
});

export function renderArticleHtml(md: string): string {
  return articleMarked.parse(md) as string;
}

// --- Categories ---

export async function listCategories(brandId: string): Promise<BlogCategory[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('blog_categories')
    .select('id, name, slug, description, sort_order')
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, slug: r.slug, description: r.description ?? null, sortOrder: r.sort_order ?? 0
  }));
}

export async function listArticlesByCategory(brandId: string, categorySlug: string, scope?: LocaleScope): Promise<{ category: BlogCategory | null; articles: BlogArticle[] }> {
  const admin = createAdminClient();
  const { data: cat } = await admin
    .from('blog_categories')
    .select('id, name, slug, description, sort_order')
    .eq('brand_id', brandId).eq('slug', categorySlug).maybeSingle();
  if (!cat) return { category: null, articles: [] };
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published').eq('category_id', cat.id)
    .or(localeFilter(scope))
    .order('published_at', { ascending: false, nullsFirst: false });
  return {
    category: { id: cat.id, name: cat.name, slug: cat.slug, description: cat.description ?? null, sortOrder: cat.sort_order ?? 0 },
    articles: (data ?? []).map(mapArticle)
  };
}

// --- Tags ---

export async function listTags(brandId: string): Promise<BlogTag[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('blog_tags')
    .select('id, name, slug')
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, slug: r.slug }));
}

export async function listArticlesByTag(brandId: string, tagSlug: string, scope?: LocaleScope): Promise<{ tag: BlogTag | null; articles: BlogArticle[] }> {
  const admin = createAdminClient();
  const { data: tag } = await admin
    .from('blog_tags')
    .select('id, name, slug')
    .eq('brand_id', brandId).eq('slug', tagSlug).maybeSingle();
  if (!tag) return { tag: null, articles: [] };
  // Get article IDs that have this tag
  const { data: links } = await admin
    .from('brand_article_tags')
    .select('article_id')
    .eq('tag_id', tag.id);
  const articleIds = (links ?? []).map((l: any) => l.article_id);
  if (!articleIds.length) return { tag: { id: tag.id, name: tag.name, slug: tag.slug }, articles: [] };
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published').in('id', articleIds)
    .or(localeFilter(scope))
    .order('published_at', { ascending: false, nullsFirst: false });
  return {
    tag: { id: tag.id, name: tag.name, slug: tag.slug },
    articles: (data ?? []).map(mapArticle)
  };
}

// --- Authors ---

export async function listAuthors(brandId: string): Promise<BlogAuthor[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('blog_authors')
    .select('id, name, slug, bio, avatar_url, role')
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, slug: r.slug, bio: r.bio ?? null, avatarUrl: r.avatar_url ?? null, role: r.role ?? 'writer'
  }));
}

export async function getAuthor(brandId: string, authorSlug: string): Promise<BlogAuthor | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('blog_authors')
    .select('id, name, slug, bio, avatar_url, role')
    .eq('brand_id', brandId).eq('slug', authorSlug).maybeSingle();
  if (!data) return null;
  return { id: data.id, name: data.name, slug: data.slug, bio: data.bio ?? null, avatarUrl: data.avatar_url ?? null, role: data.role ?? 'writer' };
}

export async function listArticlesByAuthor(brandId: string, authorSlug: string, scope?: LocaleScope): Promise<{ author: BlogAuthor | null; articles: BlogArticle[] }> {
  const admin = createAdminClient();
  const author = await getAuthor(brandId, authorSlug);
  if (!author) return { author: null, articles: [] };
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published').eq('author_id', author.id)
    .or(localeFilter(scope))
    .order('published_at', { ascending: false, nullsFirst: false });
  return { author, articles: (data ?? []).map(mapArticle) };
}

// --- Search (full-text) ---

export async function searchArticles(brandId: string, query: string, limit = 20, scope?: LocaleScope): Promise<BlogArticle[]> {
  const admin = createAdminClient();
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];
  const { data } = await admin
    .from('brand_articles')
    .select(`
      id, slug, title, meta_title, meta_description, body_md, cover_image, published_at,
      category:blog_categories(id, name, slug, description, sort_order),
      tags:brand_article_tags(blog_tags(id, name, slug)),
      author:blog_authors(id, name, slug, bio, avatar_url, role)
    `)
    .eq('brand_id', brandId).eq('status', 'published')
    .or(localeFilter(scope))
    .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []).map(mapArticle);
}
