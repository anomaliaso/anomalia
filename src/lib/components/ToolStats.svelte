<script lang="ts">
  // The headline-numbers row every tool result opens with.
  let { stats }: { stats: Array<{ label: string; value: string | number; hint?: string }> } = $props();
</script>

<div class="stats">
  {#each stats as s (s.label)}
    <div class="stat">
      <span class="v">{s.value}</span>
      <span class="l">{s.label}</span>
      {#if s.hint}<span class="h">{s.hint}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .v { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; line-height: 1.1; }
  .l { font-size: 0.82rem; color: var(--ink-soft); }
  .h { font-size: 0.75rem; color: var(--ink-faint); }
</style>
