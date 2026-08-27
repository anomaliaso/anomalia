<script lang="ts">
  import { _ } from 'svelte-i18n';
  // Blog index content. `base` prefixes article links; `siteUrl` is the blog root (canonical).
  let { brand, articles, base = '', siteUrl } = $props();
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');
</script>

<svelte:head>
  <title>{brand.name}</title>
  {#if brand.description}<meta name="description" content={brand.description.slice(0, 160)} />
  <meta property="og:description" content={brand.description.slice(0, 160)} />{/if}
  <meta property="og:title" content={brand.name} />
  <meta property="og:type" content="website" />
  <link rel="canonical" href={siteUrl} />
</svelte:head>

{#if articles.length}
  <ul class="posts">
    {#each articles as a (a.slug)}
      <li>
        <a href="{base}/{a.slug}">
          <div class="thumb">
            {#if a.cover}
              <img src={a.cover} alt={a.title} loading="lazy" />
            {:else}
              <span class="thumb-ph" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.5" cy="8.5" r="1.6" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </span>
            {/if}
          </div>
          <div class="txt">
            <h2>{a.title}</h2>
            {#if a.category || a.author}
              <div class="meta-row">
                {#if a.category}<a href="{base}/category/{a.category.slug}" class="cat-badge">{a.category.name}</a>{/if}
                {#if a.author}<span class="author-name">{a.author.name}</span>{/if}
              </div>
            {/if}
            {#if a.excerpt}<p>{a.excerpt}</p>{/if}
            {#if a.tags?.length}
              <div class="tag-row">
                {#each a.tags as tag}<a href="{base}/tag/{tag.slug}" class="tag-pill">{tag.name}</a>{/each}
              </div>
            {/if}
            {#if a.publishedAt}<time>{fmt(a.publishedAt)}</time>{/if}
          </div>
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty">{$_('blog.noArticles')}</p>
{/if}

<style>
  .posts { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px 32px; }
  @media (max-width: 900px) { .posts { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .posts { grid-template-columns: 1fr; } }
  .posts a { text-decoration: none; color: inherit; display: block; }
  .thumb { aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; margin-bottom: 14px; background: #f2f2f2; display: flex; align-items: center; justify-content: center; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
  .posts a:hover .thumb img { transform: scale(1.03); }
  .thumb-ph { color: #c4c4c4; display: flex; }
  .thumb-ph svg { width: 34px; height: 34px; }
  .posts h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
  .posts a:hover h2 { color: var(--accent); }
  .posts p { margin: 0 0 8px; color: #555; font-size: 15px; line-height: 1.55; }
  .posts time { font-size: 13px; color: #999; }
  .meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .cat-badge {
    font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
    background: #f0f0f0; color: #555; text-decoration: none; transition: background 0.15s;
  }
  .cat-badge:hover { background: var(--accent); color: #fff; }
  .author-name { font-size: 12px; color: #777; }
  .tag-row { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
  .tag-pill {
    font-size: 11px; padding: 2px 8px; border-radius: 6px;
    background: #f5f5f5; color: #666; text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .tag-pill:hover { background: var(--accent); color: #fff; }
  .empty { color: #999; }
  @media (prefers-color-scheme: dark) {
    .posts p { color: #aaa; }
    .posts time, .empty { color: #888; }
    .thumb { background: #222; }
    .thumb-ph { color: #444; }
  }
</style>
