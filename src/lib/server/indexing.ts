// Instant indexing for hosted blogs: on publish, ping Bing/Yandex/Naver/Seznam (IndexNow) and
// Exa (AI-engine index) so new articles are discoverable in minutes instead of days.
// Google has no instant-index API for regular pages — for Google the sitemap discovery path
// (robots.txt Sitemap: lines per blog) is what makes crawls start promptly.
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { createAdminClient } from './supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// ── IndexNow key ────────────────────────────────────────────────────────────────────────────────
// The key is derived from APP_SECRET (sha256 of a namespaced seed, 32 hex chars) so it is stable
// across deploys and needs no extra env var. The domain prefix keeps the published key from being
// a plain digest of the secret itself — this value is served at a public URL. The key file is at
// https://<host>/<key>.txt via the [key=indexnow].txt route — on the apex AND on every custom blog
// domain. Rotating APP_SECRET invalidates the key everywhere and forces re-verification in Bing.
// No secret → empty key: fail closed (no key file, no ping) instead of a per-instance random key
// that can never match the file the crawler fetches.

export function indexnowKey(): string {
  const secret = (env.APP_SECRET ?? '').trim();
  if (!secret) return '';
  return crypto.createHash('sha256').update(`indexnow:${secret}`).digest('hex').slice(0, 32);
}

export const indexnowKeyLocation = (host: string) => `https://${host}/${indexnowKey()}.txt`;

// ── URL resolution ───────────────────────────────────────────────────────────────────────────────

// Full public URLs for the articles just published: the subpath blog on anomalia.so plus any
// custom domain the brand has connected (brand_sites). Translations live on the same path shapes.
export async function articlePublicUrls(
  admin: SupabaseClient,
  brandId: string,
  slugs: string[]
): Promise<Record<string, string[]>> {
  if (!slugs.length) return {};
  const [{ data: brand }, { data: sites }] = await Promise.all([
    admin.from('brands').select('blog_slug').eq('id', brandId).maybeSingle(),
    // verified only (same filter as backlink-network): an unverified host doesn't serve the key
    // file yet, so pinging it just collects rejections.
    admin.from('brand_sites').select('host').eq('brand_id', brandId).eq('verified', true)
  ]);
  const hosts: string[] = [];
  if (brand?.blog_slug) {
    const appBase = (env.PUBLIC_FALLBACK_APP_URL || 'https://www.anomalia.so').replace(/\/$/, '');
    hosts.push(`${appBase}/blog/${brand.blog_slug}`);
  }
  for (const s of sites ?? []) hosts.push(`https://${String(s.host).toLowerCase()}`);
  const byHost: Record<string, string[]> = {};
  for (const base of hosts) {
    byHost[base] = slugs.map((slug) => `${base}/${slug}`);
  }
  return byHost;
}

// ── IndexNow (Bing, Yandex, Naver, Seznam) ────────────────────────────────────────────────────────

async function pingHostIndexNow(host: string, urls: string[]): Promise<void> {
  const key = indexnowKey();
  if (!key) return; // no APP_SECRET → the key file 404s, IndexNow would reject the submission
  await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: indexnowKeyLocation(host),
      urlList: urls.slice(0, 10_000)
    }),
    signal: AbortSignal.timeout(10_000)
  });
}

// ── Exa index (AI engines: LLM search, ChatGPT/Perplexity-style grounders) ───────────────────────

async function pingExaIndex(urls: string[]): Promise<void> {
  const key = env.EXA_API_KEY;
  if (!key) return;
  // Exa caps index submissions; send the freshest (recently published) few and never block on it.
  for (const url of urls.slice(0, 20)) {
    try {
      await fetch('https://api.exa.ai/index', {
        method: 'POST',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) { swallow('ping indexnow', error); }
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────────────────────────────

// Fire-and-forget: never throws, never blocks the publish tick. Ping everything for a brand in
// parallel; failures are swallowed (the per-blog sitemap + robots Sitemap: lines remain the
// crawlable fallback).
export async function notifyIndexers(admin: SupabaseClient, brandId: string, slugs: string[]): Promise<void> {
  if (!slugs.length) return;
  try {
    const byHost = await articlePublicUrls(admin, brandId, slugs);
    const all = Object.values(byHost).flat();
    if (!all.length) return;
    await Promise.allSettled([
      ...Object.entries(byHost).map(([base, urls]) =>
        pingHostIndexNow(new URL(base).host, urls).catch(swallow('URL failed'))
      ),
      pingExaIndex(all).catch(swallow('pingExaIndex failed'))
    ]);
  } catch (error) { swallow('notify indexers', error); }
}

// Small helper so callers don't need to import createAdminClient twice.
export async function notifyIndexersForBrand(brandId: string, slugs: string[]): Promise<void> {
  await notifyIndexers(createAdminClient(), brandId, slugs);
}
