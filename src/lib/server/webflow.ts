// Publish brand_articles to a Webflow CMS Collection via the Data API v2. Auth is a single Site API
// token (CMS: Read & Write + Sites: Read Only) — simpler than Shopify, no token exchange.
// A Webflow blog is a CMS Collection whose fields are user-defined, so we AUTO-DETECT where the body
// and summary go by field type (name/slug are always system fields). Body markdown → HTML into the
// first Rich Text field. ponytail: cover-image field skipped — v2 image ingestion is finicky and
// would fail the whole create; in-article images already ride along inside the Rich Text HTML.
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderArticleHtml } from './blog-site';
import { loadSecrets } from './integration-secrets';

const BASE = 'https://api.webflow.com/v2';

export type WebflowConn = {
  token: string;
  siteId?: string | null;
  collectionId?: string | null;
};

export type WebflowArticleInput = {
  title: string;
  bodyMd: string;
  handle: string; // slug (unique per collection)
  summary?: string | null;
  published: boolean;
};

type WfField = { slug: string; displayName: string; type: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wfetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) throw new Error(`Webflow ${res.status}: ${await res.text()}`);
  return res.json();
}

// Sites the token can see (the picker auto-detects — usually one).
export async function getSites(token: string): Promise<{ id: string; name: string }[]> {
  const data = await wfetch(token, '/sites');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.sites ?? []).map((s: any) => ({ id: s.id, name: s.displayName ?? s.shortName ?? s.id }));
}

// CMS collections in a site — the user picks which one is the blog.
export async function getCollections(token: string, siteId: string): Promise<{ id: string; name: string }[]> {
  const data = await wfetch(token, `/sites/${siteId}/collections`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.collections ?? []).map((c: any) => ({ id: c.id, name: c.displayName ?? c.slug ?? c.id }));
}

async function getFields(token: string, collectionId: string): Promise<WfField[]> {
  const data = await wfetch(token, `/collections/${collectionId}`);
  return (data?.fields ?? []) as WfField[];
}

// Auto-detect where the article body and summary go: first Rich Text = body, a plain-text field
// whose name/slug reads like a summary = summary. name/slug are always present system fields.
export function detectFields(fields: WfField[]): { bodySlug?: string; summarySlug?: string } {
  const body = fields.find((f) => f.type === 'RichText');
  const summary = fields.find((f) => f.type === 'PlainText' && /summary|description|excerpt|meta|intro/i.test(`${f.slug} ${f.displayName}`));
  return { bodySlug: body?.slug, summarySlug: summary?.slug };
}

// Create (or update, when existingItemId is set) the CMS item. Returns the Webflow item id.
export async function publishArticle(conn: WebflowConn, input: WebflowArticleInput, existingItemId?: string | null): Promise<string> {
  if (!conn.collectionId) throw new Error('Webflow: no collection selected');
  const fields = await getFields(conn.token, conn.collectionId);
  const { bodySlug, summarySlug } = detectFields(fields);

  const fieldData: Record<string, unknown> = { name: input.title.slice(0, 256), slug: input.handle };
  if (bodySlug) fieldData[bodySlug] = renderArticleHtml(input.bodyMd);
  if (summarySlug && input.summary) fieldData[summarySlug] = input.summary;

  const live = input.published ? '/live' : '';
  const cid = conn.collectionId;
  const path = existingItemId ? `/collections/${cid}/items/${existingItemId}${live}` : `/collections/${cid}/items${live}`;
  const method = existingItemId ? 'PATCH' : 'POST';
  const data = await wfetch(conn.token, path, {
    method,
    body: JSON.stringify({ isArchived: false, isDraft: !input.published, fieldData })
  });
  const id = data?.id ?? existingItemId;
  if (!id) throw new Error('Webflow item: no id returned');
  return id as string;
}

// Read a brand's saved Webflow connection (server-only table). null if incomplete.
export async function loadConn(admin: SupabaseClient, brandId: string): Promise<(WebflowConn & { publishImmediately: boolean }) | null> {
  const [meta, secrets] = await Promise.all([
    admin.from('blog_integrations')
      .select('store, blog_id, publish_immediately, active')
      .eq('brand_id', brandId).eq('platform', 'webflow').maybeSingle(),
    loadSecrets(admin, brandId, 'webflow')
  ]);
  const d = meta.data;
  if (!d?.store || !d.blog_id || d.active === false) return null;
  if (!secrets?.access_token) return null;
  return { token: secrets.access_token, siteId: d.store, collectionId: d.blog_id, publishImmediately: d.publish_immediately !== false };
}

// Push the given (published) articles to Webflow if connected. Best-effort; stores the item id so a
// re-publish updates the same item instead of hitting a slug conflict.
export async function syncArticlesToWebflow(admin: SupabaseClient, brandId: string, articleIds: string[]): Promise<{ pushed: number; failed: number }> {
  const conn = await loadConn(admin, brandId);
  if (!conn || articleIds.length === 0) return { pushed: 0, failed: 0 };
  const { data: arts } = await admin
    .from('brand_articles')
    .select('id, title, slug, meta_description, body_md, webflow_item_id')
    .eq('brand_id', brandId).in('id', articleIds);
  let pushed = 0;
  let failed = 0;
  for (const a of arts ?? []) {
    try {
      const itemId = await publishArticle(
        conn,
        { title: a.title, bodyMd: a.body_md ?? '', handle: a.slug, summary: a.meta_description, published: conn.publishImmediately },
        a.webflow_item_id
      );
      await admin.from('brand_articles').update({ webflow_item_id: itemId }).eq('id', a.id);
      pushed++;
    } catch {
      failed++;
    }
  }
  return { pushed, failed };
}
