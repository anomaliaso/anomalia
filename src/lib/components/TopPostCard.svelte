<script lang="ts">
  import PlatformGlyph from './PlatformGlyph.svelte';
  import { getPlatform } from './platform-meta';

  let { post }: {
    post: { platform: string; caption: string; thumbnail?: string; metrics: { label: string; value: string }[]; date: string }
  } = $props();
  const meta = $derived(getPlatform(post.platform));
</script>

<div class="top-card">
  <div class="top-thumb" style={post.thumbnail ? `background-image:url(${post.thumbnail})` : `background:${meta.bg};`}>
    <span class="badge-wrap">
      <PlatformGlyph platform={post.platform} />
    </span>
  </div>
  <div class="top-body">
    <div class="top-cap">{post.caption}</div>
    <div class="top-meta">
      {#each post.metrics as m}
        <span class="tm">{m.value} {m.label}</span>
      {/each}
    </div>
    <div class="top-date">{post.date}</div>
  </div>
</div>

<style>
  .top-card { display: flex; flex-direction: column; border: 1px solid var(--line, #ececef); border-radius: 16px;
    overflow: hidden; transition: box-shadow .15s, transform .15s; }
  .top-card:hover { box-shadow: 0 14px 30px -20px rgba(0,0,0,.3); transform: translateY(-2px); }
  .top-thumb { position: relative; aspect-ratio: 16 / 10; background-size: cover; background-position: center; background-repeat: no-repeat; }
  .badge-wrap { position: absolute; top: 8px; left: 8px;
    width: 22px; height: 22px; border-radius: 7px; overflow: hidden;
    box-shadow: 0 2px 6px rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; }
  .badge-wrap :global(.pglyph) { width: 22px; height: 22px; border-radius: 7px; }
  .badge-wrap :global(.pglyph svg) { width: 13px; height: 13px; }
  .top-body { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
  .top-cap { font-size: 13px; line-height: 1.35; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .top-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .tm { font-size: 12px; font-weight: 600; color: var(--accent); }
  .top-date { font-size: 11.5px; color: var(--ink-faint); }
</style>
