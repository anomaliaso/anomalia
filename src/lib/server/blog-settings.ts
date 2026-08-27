import { swallow } from '$lib/server/swallow';
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { FONT_KEYS, firstLogoUrl } from '$lib/server/blog-site';

const domainsApi = async () => {
  try {
    return await import('$lib/server/vercel-domains');
  } catch {
    return null;
  }
};
import { storeSecrets, loadSecrets } from '$lib/server/integration-secrets';
import { blogArticlesPerWeek, blogArticlesPerWeekMax } from '$lib/server/plans';
import { isBlogLocale, resolveBlogLocales, type BlogLocaleConfig } from '$lib/server/blog-locales';
import { readUploadImage } from '$lib/server/raster-image';

type Ev = RequestEvent;

export async function patchBlogConfig(brandId: string, patch: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data } = await admin.from('brands').select('blog_config').eq('id', brandId).maybeSingle();
  const cfg = { ...((data?.blog_config as Record<string, unknown>) ?? {}), ...patch };
  return admin.from('brands').update({ blog_config: cfg }).eq('id', brandId);
}

export async function brandBySlug(supabase: App.Locals['supabase'], slug: string) {
  const { data } = await supabase
    .from('brands')
    // `plan` and `slug` are read by the blog month job (tier gating + email links). All four extra
    // columns already exist on brands — adding a NON-existent one here would make every read of this
    // shared helper return null.
    .select('id, name, content_prefs, timezone, plan, slug, org_id')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}
const isHost = (h: string) => /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(h);

export type BlogConfigView = {
  enabled: boolean;
  title: string;
  description: string;
  accent: string;
  font: string;
  iconUrl: string | null;
  styleInstructions: string;
  articlesPerWeek: number;
  layout: 'navbar' | 'sidebar';
  navbarLinks: Array<{ label: string; url: string }>;
  showBlogLink: boolean;
  humanizerEnabled: boolean;
  backlinkNetwork: boolean;
  locales: BlogLocaleConfig;
};

export function parseBlogConfig(
  cfg: Record<string, unknown>,
  plan: string | null | undefined
): BlogConfigView {
  return {
    enabled: cfg.enabled === true,
    title: String(cfg.title ?? ''),
    description: String(cfg.description ?? ''),
    accent: String(cfg.accent ?? '') || '#111111',
    font: String(cfg.font ?? 'sans'),
    iconUrl: String(cfg.iconUrl ?? '') || null,
    styleInstructions: String(cfg.styleInstructions ?? ''),
    articlesPerWeek:
      cfg.articlesPerWeek == null
        ? blogArticlesPerWeek(plan)
        : Math.max(0, Math.min(blogArticlesPerWeekMax(plan), Number(cfg.articlesPerWeek) || 0)),
    layout: cfg.layout === 'sidebar' ? 'sidebar' : 'navbar',
    navbarLinks: Array.isArray(cfg.navbarLinks)
      ? (cfg.navbarLinks as Array<{ label: string; url: string }>)
      : [],
    showBlogLink: cfg.showBlogLink !== false,
    humanizerEnabled: cfg.humanizerEnabled !== false,
    backlinkNetwork: cfg.backlinkNetwork !== false,
    locales: resolveBlogLocales(cfg, plan)
  };
}

/** Shared load payload for blog settings pages (appearance / domain / integrations). */
export async function loadBlogSettingsData(
  brand: { id: string; slug: string; name?: string; plan?: string | null; timezone?: string },
  url: URL,
  supabase: App.Locals['supabase']
) {
  const admin = createAdminClient();
  const [
    { data: sites },
    { data: brandRow },
    blogSlug,
    { data: shopRow },
    { data: wfRow },
    { data: wixRow },
    shopSecrets,
    wfSecrets,
    wixSecrets,
    { data: categories },
    { data: tags },
    { data: authors },
    { data: kit }
  ] = await Promise.all([
    supabase
      .from('brand_sites')
      .select('id, host, verified, created_at')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: true }),
    supabase.from('brands').select('name, blog_config, plan').eq('id', brand.id).maybeSingle(),
    import('$lib/server/blog-site')
      .then(({ ensureBlogSlug }) => ensureBlogSlug(brand.id, brand.slug))
      .catch((error) => { swallow('ensure blog slug', error); return brand.id; }),
    admin
      .from('blog_integrations')
      .select('store, blog_id, author, publish_immediately, active')
      .eq('brand_id', brand.id)
      .eq('platform', 'shopify')
      .maybeSingle(),
    admin
      .from('blog_integrations')
      .select('store, blog_id, publish_immediately, active')
      .eq('brand_id', brand.id)
      .eq('platform', 'webflow')
      .maybeSingle(),
    admin
      .from('blog_integrations')
      .select('store, publish_immediately, active')
      .eq('brand_id', brand.id)
      .eq('platform', 'wix')
      .maybeSingle(),
    loadSecrets(admin, brand.id, 'shopify'),
    loadSecrets(admin, brand.id, 'webflow'),
    loadSecrets(admin, brand.id, 'wix'),
    admin
      .from('blog_categories')
      .select('id, name, slug, description, sort_order')
      .eq('brand_id', brand.id)
      .order('sort_order', { ascending: true }),
    admin
      .from('blog_tags')
      .select('id, name, slug')
      .eq('brand_id', brand.id)
      .order('name', { ascending: true }),
    admin
      .from('blog_authors')
      .select('id, name, slug, bio, avatar_url, role')
      .eq('brand_id', brand.id)
      .order('name', { ascending: true }),
    supabase.from('brand_kit').select('logos').eq('brand_id', brand.id).maybeSingle()
  ]);

  const cfg = (brandRow?.blog_config ?? {}) as Record<string, unknown>;
  const verified = (sites ?? []).find((s) => s.verified);
  const defaultUrl = `${url.origin}/blog/${blogSlug}`;

  let shopify: {
    connected: boolean;
    active: boolean;
    store: string;
    blogId: string | null;
    author: string;
    publishImmediately: boolean;
    blogs: { id: string; title: string }[];
  } | null = null;
  if (shopRow?.store) {
    let blogs: { id: string; title: string }[] = [];
    try {
      const { getBlogs } = await import('$lib/server/shopify');
      blogs = await getBlogs({
        store: shopRow.store,
        clientId: shopSecrets?.client_id ?? '',
        clientSecret: shopSecrets?.client_secret ?? '',
        accessToken: shopSecrets?.access_token ?? null
      });
    } catch (error) { swallow('load shopify blogs', error); }
    shopify = {
      connected: true,
      active: shopRow.active !== false,
      store: shopRow.store,
      blogId: shopRow.blog_id ?? null,
      author: shopRow.author ?? '',
      publishImmediately: shopRow.publish_immediately !== false,
      blogs
    };
  }

  let webflow: {
    connected: boolean;
    active: boolean;
    siteId: string | null;
    collectionId: string | null;
    publishImmediately: boolean;
    collections: { id: string; name: string }[];
  } | null = null;
  if (wfRow?.store && wfSecrets?.access_token) {
    let collections: { id: string; name: string }[] = [];
    let siteId = (wfRow.store as string | null) ?? null;
    try {
      const { getSites, getCollections } = await import('$lib/server/webflow');
      if (!siteId) {
        const s = await getSites(wfSecrets.access_token);
        siteId = s[0]?.id ?? null;
      }
      if (siteId) collections = await getCollections(wfSecrets.access_token, siteId);
    } catch (error) { swallow('load webflow collections', error); }
    webflow = {
      connected: true,
      active: wfRow.active !== false,
      siteId,
      collectionId: wfRow.blog_id ?? null,
      publishImmediately: wfRow.publish_immediately !== false,
      collections
    };
  }

  const wix =
    wixRow?.store && wixSecrets?.access_token
      ? {
          connected: true,
          active: wixRow.active !== false,
          siteId: wixRow.store as string,
          publishImmediately: wixRow.publish_immediately !== false
        }
      : null;

  const domains = await domainsApi();

  return {
    shopify,
    webflow,
    wix,
    sites: sites ?? [],
    cnameTarget: domains?.CNAME_TARGET ?? '',
    autoDomain: domains ? domains.vercelConfigured() : false,
    defaultUrl,
    siteUrl: verified ? `https://${verified.host}` : defaultUrl,
    config: parseBlogConfig(cfg, brandRow?.plan ?? brand.plan),
    articlesPerWeekMax: blogArticlesPerWeekMax(brandRow?.plan ?? brand.plan),
    backlinkNetworkAllowed: (await import('$lib/plans')).hasBacklinkNetwork(brandRow?.plan ?? brand.plan),
    brandName: brandRow?.name ?? brand.name ?? '',
    brandLogoUrl: firstLogoUrl(kit?.logos),
    fontKeys: FONT_KEYS,
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      sortOrder: c.sort_order ?? 0
    })),
    tags: (tags ?? []).map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    authors: (authors ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      bio: a.bio ?? null,
      avatarUrl: a.avatar_url ?? null,
      role: a.role ?? 'writer'
    }))
  };
}
/* ─── Actions ─────────────────────────────────────────────────────────── */

export async function toggleBlog({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const enabled = String((await request.formData()).get('enabled') ?? '') === 'true';
  const { error } = await patchBlogConfig(brand.id, { enabled });
  if (error) return fail(500, { error: error.message });
  return { blogToggled: enabled };
}

/** Parse blog appearance form fields into a blog_config patch. */
export function customizationPatchFromFormData(
  fd: FormData,
  plan?: string | null
): Record<string, unknown> {
  const title = String(fd.get('title') ?? '')
    .trim()
    .slice(0, 80);
  const description = String(fd.get('description') ?? '')
    .trim()
    .slice(0, 300);
  const accent = String(fd.get('accent') ?? '').trim();
  const font = String(fd.get('font') ?? 'sans').trim();
  const styleInstructions = String(fd.get('styleInstructions') ?? '')
    .trim()
    .slice(0, 1500);
  const apwRaw = String(fd.get('articlesPerWeek') ?? '').trim();
  const weekMax = blogArticlesPerWeekMax(plan);
  const articlesPerWeek =
    apwRaw === '' ? null : Math.max(0, Math.min(weekMax, Math.round(Number(apwRaw) || 0)));
  const layout = String(fd.get('layout') ?? 'navbar').trim() === 'sidebar' ? 'sidebar' : 'navbar';
  // Unchecked checkboxes are omitted from FormData — treat missing as false.
  const showBlogLink = fd.get('showBlogLink') === 'true';
  const humanizerEnabled = fd.get('humanizerEnabled') === 'true';
  const backlinkNetwork = fd.get('backlinkNetwork') === 'true';
  // Blog locales. defaultLocale is what the bare blog URL redirects to; `locales` are the extra
  // languages articles get translated into. The plan clamp lives in resolveBlogLocales (applied on
  // READ too), so a downgrade stops serving the extras without destroying the user's choice.
  const defaultLocaleRaw = String(fd.get('defaultLocale') ?? '').trim().toLowerCase();
  const defaultLocale = isBlogLocale(defaultLocaleRaw) ? defaultLocaleRaw : null;
  const locales = fd
    .getAll('locales')
    .map((v) => String(v).trim().toLowerCase())
    .filter((v, i, arr) => isBlogLocale(v) && v !== defaultLocale && arr.indexOf(v) === i);

  const navbarLinks: Array<{ label: string; url: string }> = [];
  for (let i = 0; i < 6; i++) {
    const label = String(fd.get(`nav_label_${i}`) ?? '').trim();
    const url = String(fd.get(`nav_url_${i}`) ?? '').trim();
    if (label && url) navbarLinks.push({ label, url });
  }
  return {
    title: title || null,
    description: description || null,
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#111111',
    font: FONT_KEYS.includes(font) ? font : 'sans',
    styleInstructions: styleInstructions || null,
    articlesPerWeek,
    defaultLocale,
    locales,
    layout,
    showBlogLink,
    navbarLinks,
    humanizerEnabled,
    backlinkNetwork
  };
}

export async function saveCustomization({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const patch = customizationPatchFromFormData(await request.formData(), brand.plan);
  const { error } = await patchBlogConfig(brand.id, patch);
  if (error) return fail(500, { error: error.message });
  return { customized: true };
}

export async function uploadIcon({
  request,
  params,
  locals: { supabase, safeGetSession }
}: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const file = (await request.formData()).get('icon');
  if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'no_file' });
  const img = await readUploadImage(file, { maxOutBytes: 2_000_000 });
  if (!img.ok) return fail(400, { error: img.error === 'too_large' ? 'too_large' : 'not_image' });
  const { user } = await safeGetSession();
  if (!user) return fail(401, { error: 'unauthorized' });
  const ext = img.mime.includes('png') ? 'png' : 'jpg';
  const path = `${user.id}/blog/icon-${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from('media')
    .upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (up.error) return fail(400, { error: up.error.message });
  const iconUrl = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  const { error } = await patchBlogConfig(brand.id, { iconUrl });
  if (error) return fail(500, { error: error.message });
  return { iconUploaded: true };
}

export async function removeIcon({ params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { error } = await patchBlogConfig(brand.id, { iconUrl: null });
  if (error) return fail(500, { error: error.message });
  return { iconRemoved: true };
}

export async function createCategory({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const name = String(fd.get('name') ?? '')
    .trim()
    .slice(0, 80);
  if (!name) return fail(400, { error: 'name_required' });
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const description =
    String(fd.get('description') ?? '')
      .trim()
      .slice(0, 300) || null;
  const { error } = await createAdminClient()
    .from('blog_categories')
    .insert({ brand_id: brand.id, name, slug, description });
  if (error) return fail(500, { error: error.message });
  return { categoryCreated: true };
}

export async function deleteCategory({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const id = String((await request.formData()).get('id') ?? '');
  if (!id) return fail(400, { error: 'Missing id' });
  const { error } = await createAdminClient()
    .from('blog_categories')
    .delete()
    .eq('id', id)
    .eq('brand_id', brand.id);
  if (error) return fail(500, { error: error.message });
  return { categoryDeleted: true };
}

export async function createTag({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const name = String((await request.formData()).get('name') ?? '')
    .trim()
    .slice(0, 50);
  if (!name) return fail(400, { error: 'name_required' });
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const { error } = await createAdminClient()
    .from('blog_tags')
    .insert({ brand_id: brand.id, name, slug });
  if (error) return fail(500, { error: error.message });
  return { tagCreated: true };
}

export async function deleteTag({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const id = String((await request.formData()).get('id') ?? '');
  if (!id) return fail(400, { error: 'Missing id' });
  const { error } = await createAdminClient()
    .from('blog_tags')
    .delete()
    .eq('id', id)
    .eq('brand_id', brand.id);
  if (error) return fail(500, { error: error.message });
  return { tagDeleted: true };
}

export async function createAuthor({
  request,
  params,
  locals: { supabase, safeGetSession }
}: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const name = String(fd.get('name') ?? '')
    .trim()
    .slice(0, 100);
  if (!name) return fail(400, { error: 'name_required' });
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const bio =
    String(fd.get('bio') ?? '')
      .trim()
      .slice(0, 500) || null;
  const role = String(fd.get('role') ?? 'writer')
    .trim()
    .slice(0, 30);
  const file = fd.get('avatar');
  let avatarUrl: string | null = null;
  if (
    file instanceof File &&
    file.size > 0
  ) {
    const { user } = await safeGetSession();
    if (user) {
      const img = await readUploadImage(file, { maxOutBytes: 2_000_000 });
      if (img.ok) {
        const ext = img.mime.includes('png') ? 'png' : 'jpg';
        const path = `${user.id}/blog/author-${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage
          .from('media')
          .upload(path, img.bytes, { contentType: img.mime, upsert: false });
        if (!up.error) avatarUrl = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
      }
    }
  }
  const { error } = await createAdminClient()
    .from('blog_authors')
    .insert({ brand_id: brand.id, name, slug, bio, role, avatar_url: avatarUrl });
  if (error) return fail(500, { error: error.message });
  return { authorCreated: true };
}

export async function deleteAuthor({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const id = String((await request.formData()).get('id') ?? '');
  if (!id) return fail(400, { error: 'Missing id' });
  const { error } = await createAdminClient()
    .from('blog_authors')
    .delete()
    .eq('id', id)
    .eq('brand_id', brand.id);
  if (error) return fail(500, { error: error.message });
  return { authorDeleted: true };
}

export async function connectDomain({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { hasBlogCustomDomain } = await import('$lib/server/plans');
  if (!hasBlogCustomDomain(brand.plan)) return fail(403, { error: 'paid_plan_required' });
  const host = normalizeHost(String((await request.formData()).get('host') ?? ''));
  if (!isHost(host)) return fail(400, { error: 'invalid_host' });
  const admin = createAdminClient();
  const domains = await domainsApi();
  if (!domains) return fail(400, { error: 'domain_automation_unavailable' });
  const reg = await domains.addProjectDomain(host);
  const { error } = await admin.from('brand_sites').insert({
    brand_id: brand.id,
    host,
    verified: reg.verified,
    vercel_domain_id: reg.ok ? host : null
  });
  if (error) {
    if (error.code === '23505') return fail(409, { error: 'host_taken' });
    return fail(500, { error: error.message });
  }
  return { connected: true, host, regError: reg.ok ? null : reg.error, verification: reg.verification };
}

export async function verifyDomain({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { hasBlogCustomDomain } = await import('$lib/server/plans');
  if (!hasBlogCustomDomain(brand.plan)) return fail(403, { error: 'paid_plan_required' });
  const host = normalizeHost(String((await request.formData()).get('host') ?? ''));
  const domains = await domainsApi();
  if (!domains) return fail(400, { error: 'domain_automation_unavailable' });
  const { verified, verification } = await domains.getProjectDomainStatus(host);
  if (verified)
    await createAdminClient()
      .from('brand_sites')
      .update({ verified: true })
      .eq('brand_id', brand.id)
      .eq('host', host);
  return { verifyChecked: true, verified, verification };
}

export async function disconnectDomain({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { hasBlogCustomDomain } = await import('$lib/server/plans');
  if (!hasBlogCustomDomain(brand.plan)) return fail(403, { error: 'paid_plan_required' });
  const host = normalizeHost(String((await request.formData()).get('host') ?? ''));
  const domains = await domainsApi();
  if (!domains) return fail(400, { error: 'domain_automation_unavailable' });
  await domains.removeProjectDomain(host);
  const { error } = await createAdminClient()
    .from('brand_sites')
    .delete()
    .eq('brand_id', brand.id)
    .eq('host', host);
  if (error) return fail(500, { error: error.message });
  return { disconnected: true };
}

export async function connectShopify({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const { normalizeStore, getBlogs } = await import('$lib/server/shopify');
  const store = normalizeStore(String(fd.get('store') ?? ''));
  const clientId = String(fd.get('client_id') ?? '').trim();
  const clientSecret = String(fd.get('client_secret') ?? '').trim();
  if (!store || !clientId || !clientSecret) return fail(400, { error: 'shopify_fields' });
  try {
    await getBlogs({ store, clientId, clientSecret });
  } catch (e) {
    return fail(400, {
      error: 'shopify_auth',
      detail: String((e as Error).message).slice(0, 200)
    });
  }
  const admin2 = createAdminClient();
  await storeSecrets(admin2, brand.id, 'shopify', {
    client_id: clientId,
    client_secret: clientSecret
  });
  const { error } = await admin2.from('blog_integrations').upsert(
    { brand_id: brand.id, platform: 'shopify', store, updated_at: new Date().toISOString() },
    { onConflict: 'brand_id,platform' }
  );
  if (error) return fail(500, { error: error.message });
  return { shopifyConnected: true };
}

export async function saveShopifyBlog({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const blogId = String(fd.get('blog_id') ?? '').trim();
  const author = String(fd.get('author') ?? '')
    .trim()
    .slice(0, 120);
  const publishImmediately = String(fd.get('publish_immediately') ?? '') === 'true';
  if (!blogId) return fail(400, { error: 'shopify_blog_required' });
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({
      blog_id: blogId,
      author: author || null,
      publish_immediately: publishImmediately,
      updated_at: new Date().toISOString()
    })
    .eq('brand_id', brand.id)
    .eq('platform', 'shopify');
  if (error) return fail(500, { error: error.message });
  return { shopifyBlogSaved: true };
}

export async function toggleShopify({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const active = String((await request.formData()).get('active') ?? '') === 'true';
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('brand_id', brand.id)
    .eq('platform', 'shopify');
  if (error) return fail(500, { error: error.message });
  return { shopifyToggled: active };
}

export async function disconnectShopify({ params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .delete()
    .eq('brand_id', brand.id)
    .eq('platform', 'shopify');
  if (error) return fail(500, { error: error.message });
  return { shopifyDisconnected: true };
}

export async function connectWebflow({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const token = String((await request.formData()).get('token') ?? '').trim();
  if (!token) return fail(400, { error: 'webflow_token' });
  let siteId: string | null = null;
  try {
    const { getSites } = await import('$lib/server/webflow');
    const sites = await getSites(token);
    siteId = sites[0]?.id ?? null;
    if (!siteId) return fail(400, { error: 'webflow_no_site' });
  } catch (e) {
    return fail(400, {
      error: 'webflow_auth',
      detail: String((e as Error).message).slice(0, 200)
    });
  }
  const admin2 = createAdminClient();
  await storeSecrets(admin2, brand.id, 'webflow', { access_token: token });
  const { error } = await admin2.from('blog_integrations').upsert(
    {
      brand_id: brand.id,
      platform: 'webflow',
      store: siteId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'brand_id,platform' }
  );
  if (error) return fail(500, { error: error.message });
  return { webflowConnected: true };
}

export async function saveWebflowCollection({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const collectionId = String(fd.get('collection_id') ?? '').trim();
  const publishImmediately = String(fd.get('publish_immediately') ?? '') === 'true';
  if (!collectionId) return fail(400, { error: 'webflow_collection_required' });
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({
      blog_id: collectionId,
      publish_immediately: publishImmediately,
      updated_at: new Date().toISOString()
    })
    .eq('brand_id', brand.id)
    .eq('platform', 'webflow');
  if (error) return fail(500, { error: error.message });
  return { webflowCollectionSaved: true };
}

export async function toggleWebflow({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const active = String((await request.formData()).get('active') ?? '') === 'true';
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('brand_id', brand.id)
    .eq('platform', 'webflow');
  if (error) return fail(500, { error: error.message });
  return { webflowToggled: active };
}

export async function disconnectWebflow({ params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .delete()
    .eq('brand_id', brand.id)
    .eq('platform', 'webflow');
  if (error) return fail(500, { error: error.message });
  return { webflowDisconnected: true };
}

export async function connectWix({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const fd = await request.formData();
  const siteId = String(fd.get('site_id') ?? '').trim();
  const apiKey = String(fd.get('api_key') ?? '').trim();
  if (!siteId || !apiKey) return fail(400, { error: 'wix_fields' });
  try {
    const { verify } = await import('$lib/server/wix');
    await verify({ apiKey, siteId });
  } catch (e) {
    return fail(400, {
      error: 'wix_auth',
      detail: String((e as Error).message).slice(0, 200)
    });
  }
  const admin2 = createAdminClient();
  await storeSecrets(admin2, brand.id, 'wix', { access_token: apiKey });
  const { error } = await admin2.from('blog_integrations').upsert(
    {
      brand_id: brand.id,
      platform: 'wix',
      store: siteId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'brand_id,platform' }
  );
  if (error) return fail(500, { error: error.message });
  return { wixConnected: true };
}

export async function saveWix({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const publishImmediately =
    String((await request.formData()).get('publish_immediately') ?? '') === 'true';
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({
      publish_immediately: publishImmediately,
      updated_at: new Date().toISOString()
    })
    .eq('brand_id', brand.id)
    .eq('platform', 'wix');
  if (error) return fail(500, { error: error.message });
  return { wixSaved: true };
}

export async function toggleWix({ request, params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const active = String((await request.formData()).get('active') ?? '') === 'true';
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('brand_id', brand.id)
    .eq('platform', 'wix');
  if (error) return fail(500, { error: error.message });
  return { wixToggled: active };
}

export async function disconnectWix({ params, locals: { supabase } }: Ev) {
  const brand = await brandBySlug(supabase, params.brand!);
  if (!brand) return fail(404, { error: 'Brand not found' });
  const { error } = await createAdminClient()
    .from('blog_integrations')
    .delete()
    .eq('brand_id', brand.id)
    .eq('platform', 'wix');
  if (error) return fail(500, { error: error.message });
  return { wixDisconnected: true };
}
