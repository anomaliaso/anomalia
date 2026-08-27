<script lang="ts">
  import BlogShell from '$lib/components/blog/BlogShell.svelte';
  import BlogPost from '$lib/components/blog/BlogPost.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="ribbon">
  Anteprima · {data.status === 'published' ? 'pubblicato' : 'bozza'} — non indicizzato
</div>

<BlogShell brand={data.brand} base="">
  <BlogPost brand={data.brand} article={data.article} base="" siteUrl="" />
</BlogShell>

<style>
  .ribbon {
    position: sticky; top: 0; z-index: 10;
    background: #111; color: #fff; text-align: center;
    font-size: 13px; font-weight: 600; padding: 8px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
