<script lang="ts">
  import { getAiSurface } from '$lib/ai-surfaces';

  let {
    engine,
    size = 'sm'
  }: {
    engine: string | null | undefined;
    size?: 'sm' | 'md';
  } = $props();

  const meta = $derived(getAiSurface(engine ?? null));
</script>

<span
  class="ai-glyph"
  class:md={size === 'md'}
  style={`--ai-bg:${meta.bg}`}
  title={meta.label}
  role="img"
  aria-label={meta.label}
>
  {#if meta.icon?.paths}
    <svg viewBox={meta.icon.viewBox ?? '0 0 24 24'} fill="currentColor" aria-hidden="true">
      {#each meta.icon.paths as d, i (i)}
        <path {d} />
      {/each}
    </svg>
  {:else if meta.icon?.path}
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={meta.icon.path} /></svg>
  {:else}
    <span class="ai-glyph-txt" aria-hidden="true">{meta.short}</span>
  {/if}
</span>

<style>
  .ai-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--ai-bg) 14%, var(--paper-2));
    border: 1px solid color-mix(in srgb, var(--ai-bg) 28%, var(--line));
    color: var(--ink);
    flex: 0 0 auto;
  }
  .ai-glyph svg {
    width: 11px;
    height: 11px;
  }
  .ai-glyph-txt {
    font-size: 7px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .ai-glyph.md {
    width: 22px;
    height: 22px;
    border-radius: 6px;
  }
  .ai-glyph.md svg {
    width: 13px;
    height: 13px;
  }
  .ai-glyph.md .ai-glyph-txt {
    font-size: 8px;
  }
</style>
