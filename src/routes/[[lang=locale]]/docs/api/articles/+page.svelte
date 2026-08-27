<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  const listBody = `{
  "articles": [
    { "id": "uuid", "slug": "article-slug", "title": "Sample title",
      "metaTitle": "SEO title", "metaDescription": "SEO description",
      "coverImage": "https://…/cover.jpg", "publishedAt": "2026-07-01T09:00:00Z" }
  ],
  "total": 42, "limit": 50, "offset": 0
}`;

  const oneBody = `{
  "id": "uuid", "slug": "article-slug", "title": "Sample title",
  "metaTitle": "SEO title", "metaDescription": "SEO description",
  "coverImage": "https://…/cover.jpg", "publishedAt": "2026-07-01T09:00:00Z",
  "contentMarkdown": "# Sample…",
  "contentHtml": "<h1>Sample…</h1>",
  "jsonLd": { "@context": "https://schema.org", "@type": "Article", "headline": "Sample title" }
}`;
</script>

<svelte:head><title>{$_('docs.api_articles.s0')}</title></svelte:head>

<h1>{$_('docs.api_articles.s1')}</h1>
<p class="docs-lead">
  {$_('docs.api_articles.s2')} <a href={lp('/docs/api')}>{$_('docs.api_articles.s3')}</a>.
</p>

<ApiEndpoint method="GET" path="/brands/:slug/articles"
  description={$_('docs.api_articles.s4')}
  responses={[{ status: 200, desc: $_('docs.api_articles.s5'), body: listBody }]}
/>
<ApiEndpoint method="GET" path="/brands/:slug/articles/:id"
  description={$_('docs.api_articles.s6')}
  responses={[{ status: 200, desc: $_('docs.api_articles.s7'), body: oneBody }, { status: 404, desc: $_('docs.api_articles.s8'), body: '{ "error": "Article not found" }' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
