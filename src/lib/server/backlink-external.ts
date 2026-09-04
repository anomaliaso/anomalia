// External backlink acquisition — SubmitForBacklinks Agent API + manual tracking.
// Docs: https://submitforbacklinks.com/docs/api — directory listing (owner-reviewed), not paid link buys.
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasBacklinkNetwork } from '$lib/plans';
import { logAiCall } from '$lib/server/ai-log';
import { gateCredits } from '$lib/server/credits';
import { isSfbBadgeEnabled } from '$lib/server/feature-flags';

type AnyRec = Record<string, unknown>;

export const EXTERNAL_BACKLINK_CREDITS = 500;
/** USD charged to the credit ledger on successful SFB submit (credits / 100). */
export const EXTERNAL_BACKLINK_COST_USD = EXTERNAL_BACKLINK_CREDITS / 100;

const SFB_BASE = 'https://submitforbacklinks.com/api/v1/agent';

/** Order statuses we poll / rotate in cron. */
export const SFB_OPEN_STATUSES = ['submitted', 'awaiting_publish', 'awaiting_badge', 'needs_changes'] as const;

export function externalBacklinksConfigured(): boolean {
  return !!env.SUBMITFORBACKLINKS_API_KEY;
}

export { isSfbBadgeEnabled };

export type ListingFields = {
  name: string;
  tagline: string;
  shortDescription: string;
  fullDescription: string;
  primaryCategorySlug: string;
  tags: string[];
  pricingModel: string;
  platformType: string;
  productType: string;
};

export type SfbIdempotency = {
  submit?: string;
  badgeIssue?: string;
  badgeVerify?: string;
};

export type SfbBadgeMeta = {
  status?: string | null;
  targetUrl?: string | null;
  verifiedAt?: string | null;
  followActive?: boolean;
  failureReason?: string | null;
  linkPolicy?: string | null;
  listingUrl?: string | null;
  markup?: string | null;
  themes?: Array<{ id: string; label: string; imageUrl: string; markup: string }>;
};

export type SfbListingMeta = {
  status?: string | null;
  isPublished?: boolean;
  listingSlug?: string | null;
  listingUrl?: string | null;
  listingType?: string | null;
};

/** ListingFields plus durable SFB meta stored in brand_backlink_orders.listing jsonb. */
export type OrderListing = ListingFields & {
  idempotency?: SfbIdempotency;
  badge?: SfbBadgeMeta;
  sfb?: SfbListingMeta;
};

export type BacklinkOrder = {
  id: string;
  provider: string;
  target_url: string;
  topic: string | null;
  status: string;
  provider_ref: string | null;
  cost_credits: number;
  resulting_links: Array<{ url: string; domain?: string }>;
  // Always an OrderListing — normalizeOrder runs every row through asOrderListing, which
  // fills idempotency/badge/sfb. The old `| AnyRec` arm was unreachable, and because AnyRec
  // subsumes OrderListing the union collapsed to `{}` the moment it passed through a generic,
  // which is what the /backlinks page was reading `listing.sfb.status` off.
  listing: OrderListing;
  last_error: string | null;
  created_at: string;
};

export type SfbAttestations = {
  guidelinesAccepted: boolean;
  badgeRequirementAcknowledged: boolean;
  canRepresentProduct: boolean;
  reviewedGeneratedContent: boolean;
};

function sfbHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    authorization: `Bearer ${env.SUBMITFORBACKLINKS_API_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function extractError(body: AnyRec, fallback: string): string {
  const err = body?.error as AnyRec | undefined;
  if (err?.message) return String(err.message);
  if (typeof body?.message === 'string') return body.message;
  return fallback;
}

export function listingFieldsFrom(data: AnyRec): ListingFields {
  const overrides = (data.overrides ?? data.listing ?? data.draft ?? data) as AnyRec;
  const tags = Array.isArray(overrides.tags)
    ? overrides.tags.map(String)
    : typeof overrides.tags === 'string'
      ? [overrides.tags]
      : [];
  return {
    name: String(overrides.name ?? ''),
    tagline: String(overrides.tagline ?? ''),
    shortDescription: String(overrides.shortDescription ?? ''),
    fullDescription: String(overrides.fullDescription ?? ''),
    primaryCategorySlug: String(overrides.primaryCategorySlug ?? 'productivity'),
    tags,
    pricingModel: String(overrides.pricingModel ?? 'SUBSCRIPTION'),
    platformType: String(overrides.platformType ?? 'WEB'),
    productType: String(overrides.productType ?? 'SAAS')
  };
}

function asOrderListing(raw: unknown): OrderListing {
  const r = (raw && typeof raw === 'object' ? raw : {}) as AnyRec;
  const fields = listingFieldsFrom(r);
  return {
    ...fields,
    idempotency: (r.idempotency as SfbIdempotency | undefined) ?? {},
    badge: (r.badge as SfbBadgeMeta | undefined) ?? {},
    sfb: (r.sfb as SfbListingMeta | undefined) ?? {}
  };
}

function mergeListing(prev: unknown, patch: Partial<OrderListing> & ListingFields): OrderListing {
  const base = asOrderListing(prev);
  return {
    ...base,
    ...patch,
    idempotency: { ...base.idempotency, ...(patch.idempotency ?? {}) },
    badge: { ...base.badge, ...(patch.badge ?? {}) },
    sfb: { ...base.sfb, ...(patch.sfb ?? {}) }
  };
}

function hostOf(urlOrHost: string): string {
  const raw = String(urlOrHost ?? '').trim();
  if (!raw) return '';
  try {
    const withProto = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(withProto).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./i, '').toLowerCase();
  }
}

/**
 * Map SFB OpenAPI listing status + publish/badge evidence → our order status.
 * Approved without isPublished is NOT completed. Free listings need badge verify when flag on.
 */
export function mapSfbPollStatus(opts: {
  sfbStatus: string;
  isPublished: boolean;
  listingType?: string | null;
  badgeStatus?: string | null;
  badgeRequired?: boolean;
}):
  | 'submitted'
  | 'awaiting_publish'
  | 'awaiting_badge'
  | 'completed'
  | 'failed'
  | 'needs_changes'
  | 'draft' {
  const raw = String(opts.sfbStatus ?? '').trim();
  const s = raw.toLowerCase();

  if (s === 'rejected' || s.includes('reject')) return 'failed';
  if (
    s === 'needs changes' ||
    s === 'changes requested' ||
    s === 'needs_changes' ||
    s.includes('needs change')
  ) {
    return 'needs_changes';
  }
  if (s === 'draft' || s === 'changes draft') return opts.isPublished ? 'awaiting_publish' : 'draft';

  const inReview =
    s === 'submitted' ||
    s === 'under review' ||
    s === 'changes submitted' ||
    s === 'changes under review' ||
    s === 'pending' ||
    s === 'in_review' ||
    s === 'queued';

  if (!opts.isPublished) {
    if (s === 'approved' || s === 'featured' || s === 'published' || s === 'live') {
      return 'awaiting_publish';
    }
    if (inReview || !s) return 'submitted';
    return 'submitted';
  }

  // Public listing is live
  const listingType = String(opts.listingType ?? 'FREE').toUpperCase();
  const freeNeedsBadge =
    opts.badgeRequired !== false &&
    isSfbBadgeEnabled() &&
    (listingType === 'FREE' || listingType === '');
  const badgeOk =
    String(opts.badgeStatus ?? '').toUpperCase() === 'VERIFIED' ||
    String(opts.badgeStatus ?? '').toUpperCase() === 'OVERRIDDEN';

  if (freeNeedsBadge && !badgeOk) return 'awaiting_badge';
  return 'completed';
}

function badgeFromEnvelope(data: AnyRec): SfbBadgeMeta {
  const badge = (data.badge ?? data) as AnyRec;
  const themes = Array.isArray(badge.themes)
    ? (badge.themes as AnyRec[]).map((t) => ({
        id: String(t.id ?? ''),
        label: String(t.label ?? ''),
        imageUrl: String(t.imageUrl ?? ''),
        markup: String(t.markup ?? '')
      }))
    : [];
  const backlink = (badge.backlink as AnyRec | null) ?? null;
  const markup =
    themes.find((t) => t.id === 'dark')?.markup || themes[0]?.markup || null;
  return {
    status: badge.status != null ? String(badge.status) : null,
    targetUrl: badge.targetUrl != null ? String(badge.targetUrl) : null,
    verifiedAt: badge.verifiedAt != null ? String(badge.verifiedAt) : null,
    followActive: !!badge.followActive,
    failureReason: badge.failureReason != null ? String(badge.failureReason) : null,
    linkPolicy: backlink?.linkPolicy != null ? String(backlink.linkPolicy) : null,
    listingUrl: backlink?.listingUrl != null ? String(backlink.listingUrl) : null,
    markup,
    themes
  };
}

/** Stateless scan — proposed draft fields (no reservation). */
export async function scanWebsiteForListing(websiteUrl: string): Promise<ListingFields> {
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');
  // Timeout: this runs inside the publish cron (proposeBacklinkOrder) — a hung SFB request
  // must not eat the tick's budget.
  const res = await fetch(`${SFB_BASE}/scan`, {
    method: 'POST',
    headers: sfbHeaders(),
    body: JSON.stringify({ websiteUrl }),
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) throw new Error(extractError(data, `Scan failed (${res.status})`));
  return listingFieldsFrom(data);
}

/**
 * Create a draft listing via Agent API (scan → POST submissions action=draft).
 * Credits are NOT charged until submitBacklinkDraft.
 */
export async function createBacklinkDraft(
  admin: SupabaseClient,
  brand: AnyRec,
  opts: { targetUrl: string; topic?: string }
): Promise<BacklinkOrder> {
  if (!hasBacklinkNetwork(brand.plan as string)) {
    throw new Error('External backlinks require Starter or above');
  }
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');

  const targetUrl = opts.targetUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('targetUrl must be absolute http(s)');

  let fields: ListingFields;
  try {
    fields = await scanWebsiteForListing(targetUrl);
  } catch {
    fields = {
      name: String(brand.name ?? 'Product'),
      tagline: (opts.topic || String(brand.name ?? '')).slice(0, 120),
      shortDescription: (opts.topic || `Listing for ${brand.name}`).slice(0, 280),
      fullDescription: (opts.topic || `Owner-reviewed listing for ${brand.name}.`).slice(0, 2000),
      primaryCategorySlug: 'productivity',
      tags: ['SaaS'],
      pricingModel: 'SUBSCRIPTION',
      platformType: 'WEB',
      productType: 'SAAS'
    };
  }

  const idem = newIdempotencyKey();
  const res = await fetch(`${SFB_BASE}/submissions`, {
    method: 'POST',
    headers: sfbHeaders({ 'Idempotency-Key': idem }),
    body: JSON.stringify({
      websiteUrl: targetUrl,
      action: 'draft',
      listingType: 'FREE',
      overrides: fields
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) throw new Error(extractError(data, `Draft create failed (${res.status})`));

  const provider_ref = String(
    data.submissionId ?? data.id ?? (data.submission as AnyRec | undefined)?.id ?? ''
  );
  if (!provider_ref) throw new Error('Draft created but no submission id returned');

  const saved = listingFieldsFrom(data.submission ? (data.submission as AnyRec) : data);
  if (saved.name) fields = saved;

  const listing: OrderListing = {
    ...fields,
    idempotency: { submit: undefined },
    badge: {},
    sfb: { listingType: 'FREE' }
  };

  const { data: row, error } = await admin
    .from('brand_backlink_orders')
    .insert({
      brand_id: brand.id,
      provider: 'submitforbacklinks',
      target_url: targetUrl,
      topic: opts.topic ?? null,
      status: 'draft',
      provider_ref,
      cost_credits: EXTERNAL_BACKLINK_CREDITS,
      resulting_links: [],
      listing,
      last_error: null
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(row);
}

/** Patch draft listing fields before submit. */
export async function updateBacklinkDraft(
  admin: SupabaseClient,
  brandId: string,
  orderId: string,
  listing: ListingFields
): Promise<BacklinkOrder> {
  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!order) throw new Error('Order not found');
  if (order.provider !== 'submitforbacklinks' || order.status !== 'draft' || !order.provider_ref) {
    throw new Error('Order is not an editable SFB draft');
  }
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');

  const idem = newIdempotencyKey();
  const res = await fetch(`${SFB_BASE}/submissions/${order.provider_ref}`, {
    method: 'PATCH',
    headers: sfbHeaders({ 'Idempotency-Key': idem }),
    body: JSON.stringify({ overrides: listing })
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) throw new Error(extractError(data, `Draft update failed (${res.status})`));

  const nextFields = listingFieldsFrom(
    data.submission ? (data.submission as AnyRec) : { ...listing }
  );
  const next = mergeListing(order.listing, nextFields);
  const { data: updated, error } = await admin
    .from('brand_backlink_orders')
    .update({ listing: next, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(updated);
}

/**
 * Finalize an owner-reviewed draft. Charges EXTERNAL_BACKLINK_CREDITS only on success.
 * Persists Idempotency-Key on listing.idempotency.submit for safe retries.
 */
export async function submitBacklinkDraft(
  admin: SupabaseClient,
  brand: AnyRec,
  orderId: string,
  attestations: SfbAttestations
): Promise<BacklinkOrder> {
  if (!hasBacklinkNetwork(brand.plan as string)) {
    throw new Error('External backlinks require Starter or above');
  }
  const required = [
    attestations.guidelinesAccepted,
    attestations.badgeRequirementAcknowledged,
    attestations.canRepresentProduct,
    attestations.reviewedGeneratedContent
  ];
  if (required.some((v) => !v)) {
    throw new Error('All four owner attestations are required before submit');
  }

  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!order) throw new Error('Order not found');
  if (order.provider !== 'submitforbacklinks' || order.status !== 'draft' || !order.provider_ref) {
    throw new Error('Order is not a submittable SFB draft');
  }
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');

  await gateCredits(String(brand.id));

  const prev = asOrderListing(order.listing);
  const idem = prev.idempotency?.submit || newIdempotencyKey();

  // Persist key before the network call so retries reuse it.
  await admin
    .from('brand_backlink_orders')
    .update({
      listing: mergeListing(prev, { ...listingFieldsFrom(prev), idempotency: { submit: idem } }),
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);

  const t0 = Date.now();
  const res = await fetch(`${SFB_BASE}/submissions/${order.provider_ref}/submit`, {
    method: 'POST',
    headers: sfbHeaders({ 'Idempotency-Key': idem }),
    body: JSON.stringify({ attestations })
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) {
    const msg = extractError(data, `Submit failed (${res.status})`);
    await admin
      .from('brand_backlink_orders')
      .update({ last_error: msg, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    logAiCall({
      label: 'sfbSubmit',
      provider: 'submitforbacklinks',
      ms: Date.now() - t0,
      ok: false,
      error: msg,
      brandId: String(brand.id),
      flatCostUsd: 0
    });
    throw new Error(msg);
  }

  logAiCall({
    label: 'sfbSubmit',
    provider: 'submitforbacklinks',
    ms: Date.now() - t0,
    ok: true,
    brandId: String(brand.id),
    flatCostUsd: EXTERNAL_BACKLINK_COST_USD
  });

  const { data: updated, error } = await admin
    .from('brand_backlink_orders')
    .update({
      status: 'submitted',
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(updated);
}

/** Manual-only order (no SFB). */
export async function createManualBacklinkOrder(
  admin: SupabaseClient,
  brand: AnyRec,
  opts: { targetUrl: string; topic?: string }
): Promise<BacklinkOrder> {
  if (!hasBacklinkNetwork(brand.plan as string)) {
    throw new Error('External backlinks require Starter or above');
  }
  const targetUrl = opts.targetUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('targetUrl must be absolute http(s)');

  const { data, error } = await admin
    .from('brand_backlink_orders')
    .insert({
      brand_id: brand.id,
      provider: 'manual',
      target_url: targetUrl,
      topic: opts.topic ?? null,
      status: 'pending',
      provider_ref: null,
      cost_credits: 0,
      resulting_links: [],
      listing: {},
      last_error: null
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(data);
}

/**
 * Semi-automatic SFB proposal when an article goes live: plan-checked, deduped by target URL,
 * then a 0-credit draft via createBacklinkDraft. NEVER submits — the owner still reviews the
 * listing, gives the four attestations and pays EXTERNAL_BACKLINK_COST_USD at submit time.
 * Returns the new order, or null when skipped (no plan / not configured / no public URL /
 * an order for that target_url already exists).
 */
export async function proposeBacklinkOrder(
  admin: SupabaseClient,
  brandId: string,
  articleId: string
): Promise<BacklinkOrder | null> {
  const { data: brand } = await admin
    .from('brands')
    .select('id, name, plan')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand || !hasBacklinkNetwork(String((brand as AnyRec).plan ?? ''))) return null;
  if (!externalBacklinksConfigured()) return null;

  const { data: article } = await admin
    .from('brand_articles')
    .select('id, slug, title')
    .eq('id', articleId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!article?.slug) return null;

  const { publicArticleUrl } = await import('./backlink-network');
  const targetUrl = await publicArticleUrl(admin, brandId, article.slug);
  if (!targetUrl) return null;

  const { data: existing } = await admin
    .from('brand_backlink_orders')
    .select('id')
    .eq('brand_id', brandId)
    .eq('target_url', targetUrl)
    .limit(1)
    .maybeSingle();
  if (existing) return null;

  const order = await createBacklinkDraft(admin, brand as AnyRec, {
    targetUrl,
    topic: article.title ?? undefined
  });
  logAiCall({
    label: 'sfbPropose',
    provider: 'submitforbacklinks',
    ms: 0,
    ok: true,
    brandId,
    flatCostUsd: 0
  });
  return order;
}

/** Issue free-listing badge markup (POST …/badge action=issue). */
export async function issueBacklinkBadge(
  admin: SupabaseClient,
  brandId: string,
  orderId: string
): Promise<BacklinkOrder> {
  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!order) throw new Error('Order not found');
  if (order.provider !== 'submitforbacklinks' || !order.provider_ref) {
    throw new Error('Order is not an SFB submission');
  }
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');

  const prev = asOrderListing(order.listing);
  const idem = prev.idempotency?.badgeIssue || newIdempotencyKey();
  await admin
    .from('brand_backlink_orders')
    .update({
      listing: mergeListing(prev, {
        ...listingFieldsFrom(prev),
        idempotency: { badgeIssue: idem }
      }),
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);

  const res = await fetch(`${SFB_BASE}/submissions/${order.provider_ref}/badge`, {
    method: 'POST',
    headers: sfbHeaders({ 'Idempotency-Key': idem }),
    body: JSON.stringify({ action: 'issue' })
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) {
    const msg = extractError(data, `Badge issue failed (${res.status})`);
    await admin
      .from('brand_backlink_orders')
      .update({ last_error: msg, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    throw new Error(msg);
  }

  const badge = badgeFromEnvelope(data);
  const next = mergeListing(prev, {
    ...listingFieldsFrom(prev),
    idempotency: { badgeIssue: idem },
    badge
  });
  const links = linksFromMeta(next, order.resulting_links);
  const { data: updated, error } = await admin
    .from('brand_backlink_orders')
    .update({
      listing: next,
      resulting_links: links,
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(updated);
}

/** Verify badge on a public HTTPS page of the submitted domain. */
export async function verifyBacklinkBadge(
  admin: SupabaseClient,
  brandId: string,
  orderId: string,
  targetUrl: string
): Promise<BacklinkOrder> {
  const pageUrl = targetUrl.trim();
  if (!/^https:\/\//i.test(pageUrl)) throw new Error('Badge page must be an https:// URL');

  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!order) throw new Error('Order not found');
  if (order.provider !== 'submitforbacklinks' || !order.provider_ref) {
    throw new Error('Order is not an SFB submission');
  }
  if (!externalBacklinksConfigured()) throw new Error('SubmitForBacklinks is not configured');

  const prev = asOrderListing(order.listing);
  const idem = prev.idempotency?.badgeVerify || newIdempotencyKey();
  await admin
    .from('brand_backlink_orders')
    .update({
      listing: mergeListing(prev, {
        ...listingFieldsFrom(prev),
        idempotency: { badgeVerify: idem }
      }),
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);

  const res = await fetch(`${SFB_BASE}/submissions/${order.provider_ref}/badge/verify`, {
    method: 'POST',
    headers: sfbHeaders({ 'Idempotency-Key': idem }),
    body: JSON.stringify({ targetUrl: pageUrl })
  });
  const data = (await res.json().catch((error) => { swallow('res.json failed', error); return ({}); })) as AnyRec;
  if (!res.ok) {
    const msg = extractError(data, `Badge verify failed (${res.status})`);
    await admin
      .from('brand_backlink_orders')
      .update({ last_error: msg, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    throw new Error(msg);
  }

  const badge = badgeFromEnvelope(data);
  badge.targetUrl = pageUrl;
  const next = mergeListing(prev, {
    ...listingFieldsFrom(prev),
    idempotency: { badgeVerify: idem },
    badge
  });

  // Docs: verification before publication stays pending until the listing is live.
  const isPublished = !!prev.sfb?.isPublished || order.status === 'awaiting_badge';
  const finalStatus = mapSfbPollStatus({
    sfbStatus: String(prev.sfb?.status ?? (isPublished ? 'Approved' : 'Submitted')),
    isPublished,
    listingType: prev.sfb?.listingType ?? 'FREE',
    badgeStatus: badge.status
  });

  const links = linksFromMeta(next, order.resulting_links);
  const { data: updated, error } = await admin
    .from('brand_backlink_orders')
    .update({
      status: finalStatus,
      listing: next,
      resulting_links: links,
      last_error: badge.status?.toUpperCase() === 'FAILED' ? badge.failureReason || null : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return normalizeOrder(updated);
}

function linksFromMeta(
  listing: OrderListing,
  prev: unknown
): Array<{ url: string; domain?: string }> {
  const links: Array<{ url: string; domain?: string }> = [];
  const listingUrl = listing.badge?.listingUrl || listing.sfb?.listingUrl;
  if (listingUrl) {
    try {
      links.push({ url: listingUrl, domain: new URL(listingUrl).hostname });
    } catch {
      links.push({ url: listingUrl });
    }
  }
  if (!links.length && Array.isArray(prev)) {
    return prev as Array<{ url: string; domain?: string }>;
  }
  return links;
}

async function fetchBadgeState(providerRef: string): Promise<SfbBadgeMeta | null> {
  try {
    const res = await fetch(`${SFB_BASE}/submissions/${providerRef}/badge`, {
      headers: sfbHeaders()
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AnyRec;
    return badgeFromEnvelope(data);
  } catch {
    return null;
  }
}

export async function pollBacklinkOrder(
  admin: SupabaseClient,
  orderId: string,
  brandId: string
): Promise<BacklinkOrder | null> {
  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!order) return null;
  if (order.provider !== 'submitforbacklinks' || !order.provider_ref || !externalBacklinksConfigured()) {
    return normalizeOrder(order);
  }
  if (['completed', 'failed', 'cancelled', 'draft'].includes(order.status)) {
    return normalizeOrder(order);
  }

  try {
    const res = await fetch(`${SFB_BASE}/submissions/${order.provider_ref}`, {
      headers: sfbHeaders()
    });
    if (!res.ok) return normalizeOrder(order);
    const data = (await res.json()) as AnyRec;
    const submission = (data.submission ?? data) as AnyRec;

    const sfbStatus = String(submission.status ?? '');
    const isPublished = !!submission.isPublished;
    const listingType = String(submission.listingType ?? submission.liveListingType ?? 'FREE');
    const listingSlug =
      submission.listingSlug != null ? String(submission.listingSlug) : null;

    let badge = asOrderListing(order.listing).badge ?? {};
    // Refresh badge state when published / awaiting badge
    if (isPublished || order.status === 'awaiting_badge') {
      const remote = await fetchBadgeState(String(order.provider_ref));
      if (remote) badge = { ...badge, ...remote };
      // Auto-issue once when live and no markup yet
      if (isSfbBadgeEnabled() && listingType.toUpperCase() === 'FREE' && !badge.markup) {
        try {
          await issueBacklinkBadge(admin, brandId, orderId);
          const { data: refreshed } = await admin
            .from('brand_backlink_orders')
            .select('listing')
            .eq('id', orderId)
            .maybeSingle();
          if (refreshed?.listing) {
            badge = { ...badge, ...(asOrderListing(refreshed.listing).badge ?? {}) };
          }
        } catch (error) { swallow('refresh order listing', error); }
      }
    }

    const status = mapSfbPollStatus({
      sfbStatus,
      isPublished,
      listingType,
      badgeStatus: badge.status
    });

    const listing = mergeListing(order.listing, {
      ...listingFieldsFrom({
        name: submission.name,
        tagline: submission.tagline,
        shortDescription: submission.shortDescription,
        fullDescription: submission.fullDescription,
        primaryCategorySlug: submission.primaryCategorySlug,
        tags: submission.tags,
        pricingModel: submission.pricingModel,
        platformType: submission.platformType,
        productType: submission.productType
      }),
      badge,
      sfb: {
        status: sfbStatus,
        isPublished,
        listingSlug,
        listingUrl: badge.listingUrl ?? null,
        listingType
      }
    });

    // Don't wipe owner-reviewed fields with empty poll payload
    const fields = listingFieldsFrom(listing);
    if (!fields.name) {
      const prevFields = listingFieldsFrom(asOrderListing(order.listing));
      Object.assign(listing, prevFields);
    }

    const links = linksFromMeta(listing, order.resulting_links);
    const { data: updated } = await admin
      .from('brand_backlink_orders')
      .update({
        status,
        listing,
        resulting_links: links.length ? links : order.resulting_links,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .select('*')
      .single();
    return normalizeOrder(updated ?? order);
  } catch {
    return normalizeOrder(order);
  }
}

/** Poll open SFB orders for a brand — used by cron. */
export async function pollOpenBacklinkOrders(
  admin: SupabaseClient,
  brandId: string,
  limit = 10
): Promise<number> {
  const { data: orders } = await admin
    .from('brand_backlink_orders')
    .select('id')
    .eq('brand_id', brandId)
    .eq('provider', 'submitforbacklinks')
    .in('status', [...SFB_OPEN_STATUSES])
    .order('updated_at', { ascending: true })
    .limit(limit);
  let n = 0;
  for (const o of orders ?? []) {
    await pollBacklinkOrder(admin, o.id, brandId);
    n++;
  }
  return n;
}

/**
 * Brands with the oldest open SFB orders first (rotation), not "first N brands by id".
 */
export async function brandsWithOpenSfbOrders(
  admin: SupabaseClient,
  opts?: { limitBrands?: number; limitOrders?: number; brandId?: string }
): Promise<string[]> {
  const limitOrders = opts?.limitOrders ?? 40;
  const limitBrands = opts?.limitBrands ?? 12;
  let q = admin
    .from('brand_backlink_orders')
    .select('brand_id')
    .eq('provider', 'submitforbacklinks')
    .in('status', [...SFB_OPEN_STATUSES])
    .order('updated_at', { ascending: true })
    .limit(limitOrders);
  if (opts?.brandId) q = q.eq('brand_id', opts.brandId);
  const { data } = await q;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.brand_id);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limitBrands) break;
  }
  return ids;
}

export async function listBacklinkOrders(admin: SupabaseClient, brandId: string) {
  const { data } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map(normalizeOrder);
}

/**
 * Verify a manual backlink page contains an anchor toward targetUrl (host match).
 */
export async function verifyManualBacklinkPage(
  pageUrl: string,
  targetUrl: string
): Promise<{ ok: boolean; error?: string }> {
  if (!/^https?:\/\//i.test(pageUrl)) return { ok: false, error: 'Page URL must be http(s)' };
  const want = hostOf(targetUrl);
  if (!want) return { ok: false, error: 'Invalid target URL' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'AnomaliaBacklinkVerify/1.0' }
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `Page returned HTTP ${res.status}` };
    const html = await res.text();
    if (!html || html.length < 20) return { ok: false, error: 'Empty page body' };
    const hrefs = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const hit = hrefs.some((h) => {
      const host = hostOf(h);
      return host === want || host.endsWith(`.${want}`) || want.endsWith(`.${host}`);
    });
    if (!hit) return { ok: false, error: `No link to ${want} found on page` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Fetch failed' };
  }
}

export async function completeManualOrder(
  admin: SupabaseClient,
  brandId: string,
  orderId: string,
  links: Array<{ url: string; domain?: string }>,
  opts?: { targetUrl?: string; skipVerify?: boolean }
) {
  const { data: order } = await admin
    .from('brand_backlink_orders')
    .select('*')
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .eq('provider', 'manual')
    .maybeSingle();
  if (!order) throw new Error('Manual order not found');

  if (!opts?.skipVerify && links.length) {
    const target = opts?.targetUrl || String(order.target_url);
    for (const link of links) {
      const check = await verifyManualBacklinkPage(link.url, target);
      if (!check.ok) {
        throw new Error(check.error ?? `Could not verify link ${link.url}`);
      }
    }
  }

  await admin
    .from('brand_backlink_orders')
    .update({
      status: 'completed',
      resulting_links: links,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .eq('brand_id', brandId)
    .eq('provider', 'manual');
}

function normalizeOrder(row: AnyRec): BacklinkOrder {
  return {
    id: String(row.id),
    provider: String(row.provider),
    target_url: String(row.target_url),
    topic: (row.topic as string | null) ?? null,
    status: String(row.status),
    provider_ref: (row.provider_ref as string | null) ?? null,
    cost_credits: Number(row.cost_credits) || 0,
    resulting_links: Array.isArray(row.resulting_links)
      ? (row.resulting_links as Array<{ url: string; domain?: string }>)
      : [],
    listing: asOrderListing(row.listing),
    last_error: (row.last_error as string | null) ?? null,
    created_at: String(row.created_at)
  };
}
