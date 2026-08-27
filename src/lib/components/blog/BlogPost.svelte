<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { setDrawerToc, setDrawerScrollTo } from './blog-drawer.svelte';

  let { brand, article, base = '', siteUrl } = $props();
  const canonical = $derived(`${siteUrl}/${article.slug}`);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');
  const jsonLd = $derived(JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: article.title, datePublished: article.publishedAt, url: canonical,
    author: { '@type': 'Organization', name: brand.name },
    publisher: { '@type': 'Organization', name: brand.name },
    ...(article.cover ? { image: article.cover } : {}),
    ...(article.metaDescription ? { description: article.metaDescription } : {})
  }));

  interface TocItem { id: string; text: string; level: number }

  let activeId = $state('');
  let bodyEl: HTMLDivElement;

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9à-öø-ÿ]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function decodeHtml(html: string): string {
    return html.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }

  function buildToc(html: string): { html: string; items: TocItem[] } {
    const items: TocItem[] = [];
    const seen = new Set<string>();
    const patched = html.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag, attrs, content) => {
      const text = decodeHtml(content.replace(/<[^>]+>/g, '').trim());
      if (!text) return _match;
      let id = slugify(text);
      if (seen.has(id)) id += '-' + seen.size;
      seen.add(id);
      items.push({ id, text, level: tag === 'h2' ? 2 : 3 });
      return `<${tag}${attrs} id="${id}">${content}</${tag}>`;
    });
    return { html: patched, items };
  }

  const processed = $derived(buildToc(article.html));

  $effect(() => {
    setDrawerToc(processed.items);
    setDrawerScrollTo(scrollTo);
    // The TOC lives in shared module state; clear it when leaving the article so the homepage (and
    // any non-article page) doesn't keep showing this article's stale index in the drawer.
    return () => setDrawerToc([]);
  });

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  onMount(() => {
    // Anonymous view counter (no cookies — see /api/v1/blog/hit). siteUrl is empty in the
    // admin preview route, which must not count.
    if (siteUrl && article.id) {
      try { navigator.sendBeacon('/api/v1/blog/hit', JSON.stringify({ id: article.id })); } catch { /* ad-blocked → fine */ }
    }
    if (!bodyEl) return;
    const headings = bodyEl.querySelectorAll('h2[id], h3[id]');
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) activeId = (e.target as HTMLElement).id;
        }
      },
      { rootMargin: '-80px 0px -60% 0px' }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  });
</script>

<svelte:head>
  <title>{article.metaTitle || article.title}</title>
  {#if article.metaDescription}<meta name="description" content={article.metaDescription} />{/if}
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={article.metaTitle || article.title} />
  {#if article.metaDescription}<meta property="og:description" content={article.metaDescription} />{/if}
  <meta property="og:url" content={canonical} />
  {#if article.cover}
    <meta property="og:image" content={article.cover} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={article.cover} />
  {/if}
  {@html `<script type="application/ld+json">${jsonLd}<` + `/script>`}
</svelte:head>

<article>
  <div class="layout">
    {#if processed.items.length}
      <nav class="toc" aria-label={$_('blog.tableOfContents')}>
        <p class="toc-title">{$_('blog.tableOfContents')}</p>
        <ul>
          {#each processed.items as item (item.id)}
            <li class="toc-{item.level === 3 ? 'sub' : 'top'}">
              <a
                href="#{item.id}"
                class:active={activeId === item.id}
                onclick={(e) => { e.preventDefault(); scrollTo(item.id); }}
              >{item.text}</a>
            </li>
          {/each}
        </ul>
      </nav>
    {/if}

    <div class="content">
      <h1>{article.title}</h1>
      {#if article.category || article.author}
        <div class="meta-row">
          {#if article.category}<a href="{base}/category/{article.category.slug}" class="cat-badge">{article.category.name}</a>{/if}
          {#if article.author}
            <a href="{base}/author/{article.author.slug}" class="author-link">
              {#if article.author.avatarUrl}<img src={article.author.avatarUrl} alt={article.author.name} class="author-avatar" />{/if}
              <span>{article.author.name}</span>
            </a>
          {/if}
          {#if article.publishedAt}<time class="meta">{fmt(article.publishedAt)}</time>{/if}
        </div>
      {:else if article.publishedAt}<time class="meta">{fmt(article.publishedAt)}</time>{/if}
      {#if article.tags?.length}
        <div class="tag-row">
          {#each article.tags as tag}<a href="{base}/tag/{tag.slug}" class="tag-pill">{tag.name}</a>{/each}
        </div>
      {/if}
      {#if article.cover}<img class="hero" src={article.cover} alt={article.title} />{/if}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="body" bind:this={bodyEl}>{@html processed.html}</div>
    </div>
  </div>
</article>

<style>
  .hero { width: 100%; height: auto; max-height: 460px; object-fit: cover; border-radius: 16px; margin: 0 0 28px; display: block; }
  h1 { font-size: 48px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; margin: 0 0 12px; }
  .meta { display: block; font-size: 14px; color: #999; margin-bottom: 36px; }
  .meta-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .cat-badge {
    font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px;
    background: #f0f0f0; color: #555; text-decoration: none; transition: background 0.15s;
  }
  .cat-badge:hover { background: var(--accent); color: #fff; }
  .author-link {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 14px; font-weight: 500; color: #555; text-decoration: none;
    transition: color 0.15s;
  }
  .author-link:hover { color: var(--accent); }
  .author-avatar { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
  .tag-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; }
  .tag-pill {
    font-size: 12px; padding: 3px 10px; border-radius: 8px;
    background: #f5f5f5; color: #666; text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .tag-pill:hover { background: var(--accent); color: #fff; }

  .layout { display: flex; gap: 64px; align-items: flex-start; }

  .toc {
    position: sticky;
    top: 100px;
    flex: 0 0 300px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    padding: 0;
    margin: 0;
  }
  .toc-title {
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #999;
    margin: 0 0 14px;
  }
  .toc ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .toc-sub { padding-left: 20px; }
  .toc a {
    display: block;
    font-size: 18px;
    font-weight: 500;
    line-height: 1.4;
    color: #888;
    text-decoration: none;
    padding: 6px 12px;
    border-left: 2px solid transparent;
    border-radius: 0 4px 4px 0;
    letter-spacing: 0.02em;
    transition: color 0.15s, border-color 0.15s;
  }
  .toc a:hover { color: var(--accent); }
  .toc a.active { color: var(--accent); border-left-color: var(--accent); font-weight: 600; }

  .content { flex: 1; min-width: 0; padding: 0; }
  .body { font-size: 19px; line-height: 1.85; font-weight: 300; letter-spacing: 0.02em; }
  .body :global(h2) { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin: 40px 0 14px; scroll-margin-top: 90px; }
  .body :global(h3) { font-size: 21px; font-weight: 600; margin: 30px 0 10px; scroll-margin-top: 90px; }
  .body :global(p) { margin: 0 0 20px; }
  .body :global(ul), .body :global(ol) { margin: 0 0 20px; padding-left: 24px; }
  .body :global(li) { margin: 0 0 8px; }
  .body :global(a) { color: var(--accent); text-decoration: underline; }
  .body :global(img) { max-width: 100%; height: auto; border-radius: 10px; }
  .body :global(blockquote) { margin: 0 0 20px; padding-left: 18px; border-left: 3px solid #ddd; color: #666; }
  .body :global(pre) { overflow-x: auto; background: #f5f5f5; padding: 14px; border-radius: 10px; }
  .body :global(hr) { display: none; }
  .body :global(hr + *) { margin-top: 48px; }
  .body :global(table) { border-collapse: collapse; width: 100%; margin: 0 0 20px; }
  .body :global(th), .body :global(td) { border: 1px solid #ddd; padding: 10px 14px; text-align: left; vertical-align: top; font-size: 16px; }
  .body :global(th) { font-weight: 600; background: #f9f9f9; }

  @media (max-width: 900px) {
    .layout { flex-direction: column; gap: 24px; }
    .toc { display: none; }
  }
  /* Follow the app's resolved theme (data-theme), NOT the raw OS preference — see BlogShell. */
  :global(:root[data-theme="dark"]) .meta { color: #888; }
  :global(:root[data-theme="dark"]) .toc a { color: #888; }
  :global(:root[data-theme="dark"]) .toc a.active { color: var(--accent); border-left-color: var(--accent); }
  :global(:root[data-theme="dark"]) .toc-title { color: #777; }
  :global(:root[data-theme="dark"]) .body :global(p) { color: rgb(187, 187, 187); }
  :global(:root[data-theme="dark"]) .body :global(blockquote) { border-color: #333; color: #aaa; }
  :global(:root[data-theme="dark"]) .body :global(pre) { background: #1a1a1a; }
  :global(:root[data-theme="dark"]) .body :global(th), :global(:root[data-theme="dark"]) .body :global(td) { border-color: #333; }
  :global(:root[data-theme="dark"]) .body :global(th) { background: #222; }
</style>
