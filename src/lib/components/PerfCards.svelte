<script lang="ts">
  import PlatformGlyph from './PlatformGlyph.svelte';
  import { getPlatform } from './platform-meta';

  let { cards, postsLabel = 'posts tracked' }: { cards: { platform: string; posts: number; metrics: { key: string; label: string; value: string }[] }[]; postsLabel?: string } = $props();
</script>

<div class="perf-grid">
  {#each cards as c}
    {@const meta = getPlatform(c.platform)}
    <div class="perf-card">
      <div class="perf-head">
        <PlatformGlyph platform={c.platform} size="lg" />
        <div class="perf-id">
          <div class="perf-name">{meta.label}</div>
          <div class="perf-posts">{c.posts} {postsLabel}</div>
        </div>
      </div>
      {#if c.metrics.length}
        <div class="perf-metrics">
          {#each c.metrics as m}
            <div class="metric">
              <div class="mv">{m.value}</div>
              <div class="ml">{m.label}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .perf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; padding: 16px; }
  .perf-card { border: 1px solid var(--line, #ececef); border-radius: 16px; padding: 14px; }
  .perf-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .perf-name { font-size: 14px; font-weight: 700; }
  .perf-posts { font-size: 11.5px; color: var(--ink-faint); }
  .perf-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .metric .mv { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
  .metric .ml { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; }
</style>
