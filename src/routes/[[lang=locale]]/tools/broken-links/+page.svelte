<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
</script>

<ToolPage toolKey="broken-links" endpoint="/api/tools/broken-links">
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.broken-links.stats.found'), value: d.totalLinks },
        { label: $_('tools.broken-links.stats.checked'), value: d.checked },
        { label: $_('tools.broken-links.stats.broken'), value: d.brokenCount }
      ]}
    />

    <div class="links">
      {#each d.links as l}
        <div class="link" class:bad={!l.ok}>
          <span class="code">{l.status || '×'}</span>
          <span class="u">{l.url}</span>
          <span class="tag">{l.external ? $_('tools.broken-links.external') : $_('tools.broken-links.internal')}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</ToolPage>

<style>
  .links { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .link {
    display: grid; grid-template-columns: 48px 1fr auto; gap: 12px; align-items: center;
    padding: 10px 16px; border-bottom: 1px solid var(--line); font-size: 0.86rem;
  }
  .link:last-child { border-bottom: 0; }
  .link.bad { background: #fef2f2; }
  .code {
    font-weight: 700; font-size: 0.8rem; text-align: center;
    border-radius: 6px; padding: 3px 0; background: #dcfce7; color: #166534;
  }
  .link.bad .code { background: #fee2e2; color: #b91c1c; }
  .u { word-break: break-all; }
  .tag { font-size: 0.72rem; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  @media (max-width: 600px) { .link { grid-template-columns: 48px 1fr; } .tag { display: none; } }
</style>
