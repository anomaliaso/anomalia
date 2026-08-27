<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.author.name}</title>
  {#if data.author.bio}<meta name="description" content={data.author.bio.slice(0, 160)} />{/if}
</svelte:head>

<div class="author-header">
  {#if data.author.avatarUrl}<img src={data.author.avatarUrl} alt={data.author.name} class="avatar" />{/if}
  <div>
    <h1>{data.author.name}</h1>
    {#if data.author.bio}<p class="bio">{data.author.bio}</p>{/if}
    <span class="role">{data.author.role}</span>
  </div>
</div>

<BlogIndex articles={data.articles} base="" />

<style>
  .author-header { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 36px; }
  .avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .author-header h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
  .bio { font-size: 15px; color: #555; margin: 0 0 6px; line-height: 1.55; }
  .role { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: #f0f0f0; color: #666; text-transform: capitalize; }
  :global(:root[data-theme="dark"]) .bio { color: #aaa; }
  :global(:root[data-theme="dark"]) .role { background: #222; color: #999; }
</style>
