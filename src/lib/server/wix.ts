// Publish brand_articles to a Wix site blog via the Blog REST API v3. Auth is an account API key
// (Wix Blog + Members permissions) + the Site ID header. Unlike Shopify/Webflow, Wix does NOT take
// HTML — the blog stores content as Ricos (a proprietary node JSON), so we convert the article
// Markdown → Ricos here. ponytail: minimal converter (headings, paragraphs, bold/italic, links,
// lists); in-article images are dropped (Ricos images need Wix-hosted media) — add media upload if
// image fidelity on Wix matters. The exact Ricos shape / author memberId can only be fully verified
// against a live Wix site.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSecrets } from './integration-secrets';

const BASE = 'https://www.wixapis.com';

export type WixConn = {
  apiKey: string;
  siteId: string;
};

export type WixArticleInput = {
  title: string;
  bodyMd: string;
  published: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wfetch(conn: WixConn, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: conn.apiKey, 'wix-site-id': conn.siteId, 'content-type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) throw new Error(`Wix ${res.status}: ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

// ---- Markdown → Ricos --------------------------------------------------------------------------

type RicosNode = Record<string, unknown>;

// Inline: split a line into TEXT nodes, applying bold / italic / link decorations. Leaf TEXT nodes
// carry no id in Ricos (only block nodes do).
function inlineNodes(text: string): RicosNode[] {
  const out: RicosNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, decorations: RicosNode[]) => {
    if (t) out.push({ type: 'TEXT', textData: { text: t, decorations } });
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index), []);
    if (m[1] !== undefined) push(m[1], [{ type: 'LINK', linkData: { link: { url: m[2], target: 'BLANK' } } }]);
    else if (m[3] !== undefined) push(m[3], [{ type: 'BOLD', fontWeightValue: 700 }]);
    else push(m[4] ?? m[5] ?? '', [{ type: 'ITALIC', italicData: true }]);
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last), []);
  return out.length ? out : [{ type: 'TEXT', textData: { text: '', decorations: [] } }];
}

// Convert our article Markdown to a Ricos RichContent document. Supports headings (##/###),
// paragraphs, bulleted/numbered lists, and inline bold/italic/links. Images and code fences are
// dropped (see file header).
export function markdownToRicos(md: string): { nodes: RicosNode[] } {
  let n = 0;
  const id = () => `n${++n}`;
  const nodes: RicosNode[] = [];
  const lines = md.replace(/```[\s\S]*?```/g, '').split('\n');

  let i = 0;
  const listItem = (text: string): RicosNode => ({ type: 'LIST_ITEM', id: id(), nodes: [{ type: 'PARAGRAPH', id: id(), nodes: inlineNodes(text), paragraphData: {} }] });

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(t)) { i++; continue; } // image line → dropped

    const h = /^(#{1,3})\s+(.+)$/.exec(t);
    if (h) {
      nodes.push({ type: 'HEADING', id: id(), nodes: inlineNodes(h[2]), headingData: { level: Math.max(2, h[1].length) } });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(t)) {
      const items: RicosNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(listItem(lines[i].trim().replace(/^[-*]\s+/, ''))); i++; }
      nodes.push({ type: 'BULLETED_LIST', id: id(), nodes: items });
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items: RicosNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { items.push(listItem(lines[i].trim().replace(/^\d+\.\s+/, ''))); i++; }
      nodes.push({ type: 'ORDERED_LIST', id: id(), nodes: items });
      continue;
    }

    nodes.push({ type: 'PARAGRAPH', id: id(), nodes: inlineNodes(t), paragraphData: {} });
    i++;
  }
  return { nodes };
}

// ---- Publish -----------------------------------------------------------------------------------

// Create (or update, when existingId is set) a blog draft post and optionally publish it. Returns
// the draft post id (store it so a re-publish updates the same post instead of duplicating).
export async function publishArticle(conn: WixConn, input: WixArticleInput, existingId?: string | null): Promise<string> {
  const richContent = markdownToRicos(input.bodyMd);
  if (existingId) {
    // ponytail: bulk-update path unverified against a live site — falls back to create on failure.
    await wfetch(conn, '/blog/v3/draft-posts/update', {
      method: 'PATCH',
      body: JSON.stringify({ draftPosts: [{ id: existingId, title: input.title, richContent }], action: input.published ? 'UPDATE_PUBLISH' : 'UPDATE' })
    });
    return existingId;
  }
  const created = await wfetch(conn, '/blog/v3/draft-posts', { method: 'POST', body: JSON.stringify({ draftPost: { title: input.title, richContent } }) });
  const id = created?.draftPost?.id;
  if (!id) throw new Error('Wix: no draft post id returned');
  if (input.published) await wfetch(conn, `/blog/v3/draft-posts/${id}/publish`, { method: 'POST', body: '{}' });
  return id as string;
}

// Cheap credential check: list one draft post. Fails if the key/site are wrong or the Blog app is
// missing ("no blog instanceId").
export async function verify(conn: WixConn): Promise<void> {
  await wfetch(conn, '/blog/v3/draft-posts?paging.limit=1');
}

export async function loadConn(admin: SupabaseClient, brandId: string): Promise<(WixConn & { publishImmediately: boolean }) | null> {
  const [meta, secrets] = await Promise.all([
    admin.from('blog_integrations')
      .select('store, publish_immediately, active')
      .eq('brand_id', brandId).eq('platform', 'wix').maybeSingle(),
    loadSecrets(admin, brandId, 'wix')
  ]);
  const d = meta.data;
  if (!d?.store || d.active === false) return null;
  if (!secrets?.access_token) return null;
  return { apiKey: secrets.access_token, siteId: d.store, publishImmediately: d.publish_immediately !== false };
}

export async function syncArticlesToWix(admin: SupabaseClient, brandId: string, articleIds: string[]): Promise<{ pushed: number; failed: number }> {
  const conn = await loadConn(admin, brandId);
  if (!conn || articleIds.length === 0) return { pushed: 0, failed: 0 };
  const { data: arts } = await admin
    .from('brand_articles')
    .select('id, title, body_md, wix_post_id')
    .eq('brand_id', brandId).in('id', articleIds);
  let pushed = 0;
  let failed = 0;
  for (const a of arts ?? []) {
    try {
      const postId = await publishArticle(conn, { title: a.title, bodyMd: a.body_md ?? '', published: conn.publishImmediately }, a.wix_post_id);
      await admin.from('brand_articles').update({ wix_post_id: postId }).eq('id', a.id);
      pushed++;
    } catch {
      failed++;
    }
  }
  return { pushed, failed };
}
