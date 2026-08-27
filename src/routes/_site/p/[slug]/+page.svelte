<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.page.metaTitle}</title>
  {#if data.page.metaDescription}
    <meta name="description" content={data.page.metaDescription} />
  {/if}
  <link rel="canonical" href={data.page.canonical} />
</svelte:head>

<article class="site-page">
  <header>
    <p class="kind">{data.page.kind.replaceAll('_', ' ')}</p>
    <h1>{data.page.title}</h1>
  </header>
  <div class="body">
    {@html data.page.html}
  </div>
</article>

<style>
  .site-page { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
  .kind { text-transform: uppercase; letter-spacing: 0.06em; font-size: 12px; opacity: 0.6; margin: 0 0 8px; }
  h1 { margin: 0 0 24px; font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.15; }
  .body :global(h2) { margin-top: 1.6em; }
  .body :global(p) { line-height: 1.65; }
</style>
