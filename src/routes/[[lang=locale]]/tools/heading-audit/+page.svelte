<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
</script>

<ToolPage toolKey="heading-audit" endpoint="/api/tools/heading-audit">
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.heading-audit.stats.words'), value: d.wordCount.toLocaleString() },
        { label: $_('tools.heading-audit.stats.headings'), value: d.headings.length },
        { label: $_('tools.heading-audit.stats.images'), value: d.images.total, hint: `${d.images.missingAlt} ${$_('tools.heading-audit.stats.noAlt')}` },
        { label: $_('tools.heading-audit.stats.internalLinks'), value: d.links.internal }
      ]}
    />

    <h3 class="sec">{$_('tools.heading-audit.outline')}</h3>
    <div class="outline">
      {#each d.headings as h}
        <div class="h" style="padding-left: {(h.level - 1) * 18}px">
          <span class="lvl">H{h.level}</span>
          <span>{h.text}</span>
        </div>
      {:else}
        <p class="empty">{$_('tools.heading-audit.noHeadings')}</p>
      {/each}
    </div>

    {#if d.images.samples.length}
      <h3 class="sec">{$_('tools.heading-audit.missingAltTitle')}</h3>
      <ul class="samples">
        {#each d.images.samples as s}<li><code>{s}</code></li>{/each}
      </ul>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .sec { font-size: 1.05rem; margin: 28px 0 12px; }
  .outline { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .h {
    display: flex; gap: 10px; align-items: baseline; padding: 9px 16px;
    border-bottom: 1px solid var(--line); font-size: 0.9rem;
  }
  .h:last-child { border-bottom: 0; }
  .lvl {
    font-size: 0.7rem; font-weight: 700; color: var(--ink-faint);
    background: var(--wash); border-radius: 6px; padding: 2px 6px; flex-shrink: 0;
  }
  .empty { padding: 16px; margin: 0; color: var(--ink-faint); }
  .samples { margin: 0; padding-left: 20px; }
  .samples code { font-size: 0.82rem; word-break: break-all; }
</style>
