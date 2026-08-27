<script lang="ts">
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';

  let {
    tiles
  }: {
    tiles: {
      label: string;
      value: number | string;
      format?: (n: number) => string;
      delta: string;
      up?: boolean;
    }[];
  } = $props();
</script>

<div class="stats">
  {#each tiles as t}
    <div class="tile">
      <div class="lbl">{t.label}</div>
      <div class="val">
        {#if typeof t.value === 'number'}
          <AnimatedNum value={t.value} format={t.format} />
        {:else}
          {t.value}
        {/if}
      </div>
      <div class="delta" class:up={t.up}>{t.delta}</div>
    </div>
  {/each}
</div>

<style>
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 26px; }
  .tile { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; }
  .lbl { font-size: 12.5px; color: var(--ink-faint); font-weight: 500; display: flex; align-items: center; gap: 7px; }
  .val { font-size: 2rem; font-weight: 700; letter-spacing: -0.04em; margin-top: 12px; line-height: 1; font-variant-numeric: tabular-nums; }
  .delta { font-size: 12.5px; margin-top: 8px; color: var(--ink-faint); }
  .delta.up { color: var(--accent); }

  @container workbench (max-width: 1080px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  @container workbench (max-width: 600px) { .stats { grid-template-columns: 1fr; } }
</style>
