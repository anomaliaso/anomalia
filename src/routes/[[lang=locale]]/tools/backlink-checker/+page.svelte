<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
</script>

<ToolPage toolKey="backlink-checker" endpoint="/api/tools/backlink-checker">
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.backlink-checker.stats.referringDomains'), value: d.referringDomains.toLocaleString() },
        { label: $_('tools.backlink-checker.stats.backlinks'), value: d.backlinks.toLocaleString() },
        { label: $_('tools.backlink-checker.stats.rank'), value: d.rank },
        { label: $_('tools.backlink-checker.stats.spam'), value: `${d.spamScore}%` }
      ]}
    />

    <div class="split">
      <div class="card">
        <h3>{$_('tools.backlink-checker.followSplit')}</h3>
        <div class="bar">
          <div class="do" style="width: {d.backlinks ? (d.dofollow / d.backlinks) * 100 : 0}%"></div>
        </div>
        <p>
          <strong>{d.dofollow.toLocaleString()}</strong> dofollow ·
          <strong>{d.nofollow.toLocaleString()}</strong> nofollow
        </p>
      </div>

      {#if d.topTlds.length}
        <div class="card">
          <h3>{$_('tools.backlink-checker.topTlds')}</h3>
          <div class="chips">
            {#each d.topTlds as t}<span class="chip">.{t.tld} · {t.count.toLocaleString()}</span>{/each}
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</ToolPage>

<style>
  .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .card { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
  .card h3 { margin: 0 0 12px; font-size: 0.92rem; }
  .bar { height: 10px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
  .do { height: 100%; background: #16a34a; }
  .card p { margin: 10px 0 0; font-size: 0.86rem; color: var(--ink-soft); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    background: var(--wash); border: 1px solid var(--line); border-radius: 999px;
    padding: 3px 10px; font-size: 0.8rem;
  }
</style>
