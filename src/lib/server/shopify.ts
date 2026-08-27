// Publish brand_articles to a merchant's Shopify store blog via the Admin GraphQL API.
// Auth is the custom-app Client Credentials grant (client_id + client_secret → short-lived token),
// with a stored access_token as a legacy fallback. Body markdown is reused through the same
// sanitising renderer as the hosted blog.
// ponytail: GraphQL Admin API 2025-01; bump the version string when Shopify deprecates it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderArticleHtml } from './blog-site';
import { loadSecrets } from './integration-secrets';

const API_VERSION = '2025-01';

export type ShopifyConn = {
  store: string; // subdomain OR full myshopify domain — normalized on use
  clientId: string;
  clientSecret: string;
  accessToken?: string | null; // legacy: used directly if present, skips the token exchange
  blogId?: string | null; // GraphQL gid, e.g. 'gid://shopify/Blog/123'
  author?: string | null;
};

export type ShopifyArticleInput = {
  title: string;
  bodyMd: string;
  handle?: string | null; // slug
  summary?: string | null; // meta description
  coverImage?: string | null;
  published: boolean;
};

// Accepts 'na70yq-bn', 'na70yq-bn.myshopify.com' or 'https://na70yq-bn.myshopify.com/…' → bare sub.
export function normalizeStore(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.myshopify\.com.*$/, '')
    .replace(/\/.*$/, '');
}

const host = (store: string) => `https://${normalizeStore(store)}.myshopify.com`;

// Client Credentials grant → short-lived Admin API token. A stored access_token short-circuits it.
// ponytail: token fetched per operation (publishes are infrequent); cache in DB if rate limits bite.
async function getToken(conn: ShopifyConn): Promise<string> {
  if (conn.accessToken) return conn.accessToken;
  const res = await fetch(`${host(conn.store)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: conn.clientId,
      client_secret: conn.clientSecret,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error(`Shopify auth ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (!body?.access_token) throw new Error('Shopify auth: no access_token in response');
  return body.access_token as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gql(conn: ShopifyConn, token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${host(conn.store)}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body?.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data;
}

// List the store's blogs so the user can pick a publish target.
export async function getBlogs(conn: ShopifyConn): Promise<{ id: string; title: string }[]> {
  const token = await getToken(conn);
  const data = await gql(conn, token, `{ blogs(first: 50) { edges { node { id title } } } }`, {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.blogs?.edges ?? []).map((e: any) => ({ id: e.node.id, title: e.node.title }));
}

const ARTICLE_CREATE = `
  mutation ArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id handle }
      userErrors { field message }
    }
  }`;

// Create the article on the chosen blog. Returns the Shopify article gid (store on the source row
// so a re-publish can update instead of duplicating — the update mutation is a later follow-up).
export async function publishArticle(conn: ShopifyConn, input: ShopifyArticleInput): Promise<string> {
  if (!conn.blogId) throw new Error('Shopify: no blog selected');
  const token = await getToken(conn);
  const article: Record<string, unknown> = {
    blogId: conn.blogId,
    title: input.title,
    body: renderArticleHtml(input.bodyMd),
    isPublished: input.published,
    ...(input.handle ? { handle: input.handle } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(conn.author ? { author: { name: conn.author } } : {}),
    ...(input.coverImage ? { image: { url: input.coverImage } } : {})
  };
  const data = await gql(conn, token, ARTICLE_CREATE, { article });
  const errs = data?.articleCreate?.userErrors ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (errs.length) throw new Error(`Shopify article: ${errs.map((e: any) => e.message).join('; ')}`);
  const id = data?.articleCreate?.article?.id;
  if (!id) throw new Error('Shopify article: no id returned');
  return id as string;
}

// --- Persistence (server-only: blog_integrations holds secrets, RLS blocks anon/authed reads) ---

export type ShopifyState = {
  connected: boolean;
  store: string;
  blogId: string | null;
  author: string | null;
  publishImmediately: boolean;
};

// Read a brand's saved Shopify connection. Returns the full conn (with secrets) for server use, or
// null when there's no complete, blog-selected connection.
export async function loadConn(admin: SupabaseClient, brandId: string): Promise<(ShopifyConn & { publishImmediately: boolean }) | null> {
  const [meta, secrets] = await Promise.all([
    admin.from('blog_integrations')
      .select('store, blog_id, author, publish_immediately, active')
      .eq('brand_id', brandId).eq('platform', 'shopify').maybeSingle(),
    loadSecrets(admin, brandId, 'shopify')
  ]);
  const d = meta.data;
  if (!d?.store || !d.blog_id || d.active === false) return null;
  if (!secrets) return null;
  return {
    store: d.store,
    clientId: secrets.client_id ?? '',
    clientSecret: secrets.client_secret ?? '',
    accessToken: secrets.access_token ?? null,
    blogId: d.blog_id,
    author: d.author,
    publishImmediately: d.publish_immediately !== false
  };
}

// Publish the given (already-published) articles to Shopify, if the brand has an active connection.
// Best-effort: a failure on one article doesn't abort the rest. Stores the returned gid per article.
export async function syncArticlesToShopify(
  admin: SupabaseClient,
  brandId: string,
  articleIds: string[]
): Promise<{ pushed: number; failed: number }> {
  const conn = await loadConn(admin, brandId);
  if (!conn || articleIds.length === 0) return { pushed: 0, failed: 0 };
  const { data: arts } = await admin
    .from('brand_articles')
    .select('id, title, slug, meta_description, body_md, cover_image')
    .eq('brand_id', brandId).in('id', articleIds);
  let pushed = 0;
  let failed = 0;
  for (const a of arts ?? []) {
    try {
      const gid = await publishArticle(conn, {
        title: a.title,
        bodyMd: a.body_md ?? '',
        handle: a.slug,
        summary: a.meta_description,
        coverImage: a.cover_image,
        published: conn.publishImmediately
      });
      await admin.from('brand_articles').update({ shopify_article_id: gid }).eq('id', a.id);
      pushed++;
    } catch {
      failed++;
    }
  }
  return { pushed, failed };
}
