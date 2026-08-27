<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
</script>

<ToolPage
  toolKey="ai-visibility"
  endpoint="/api/tools/ai-visibility"
  fields={[{ name: 'url' }, { name: 'keywords' }]}
>
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.ai-visibility.stats.withOverview'), value: `${d.aiOverviewCount}/${d.rows.length}` },
        { label: $_('tools.ai-visibility.stats.cited'), value: d.citedCount }
      ]}
    />

    <div class="rows">
      {#each d.rows as r}
        <div class="row">
          <div class="head">
            <strong>{r.keyword}</strong>
            {#if !r.hasAiOverview}
              <span class="badge none">{$_('tools.ai-visibility.noOverview')}</span>
            {:else if r.cited}
              <span class="badge yes">{$_('tools.ai-visibility.cited')}</span>
            {:else}
              <span class="badge no">{$_('tools.ai-visibility.notCited')}</span>
            {/if}
            {#if r.organicPosition}
              <span class="org">{$_('tools.ai-visibility.organic')} #{r.organicPosition}</span>
            {/if}
          </div>
          {#if r.citedSources.length}
            <div class="sources">
              {#each r.citedSources as s}<span class="chip">{s}</span>{/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if d.topCompetingSources.length}
      <h3 class="sec">{$_('tools.ai-visibility.competing')}</h3>
      <div class="sources">
        {#each d.topCompetingSources as c}<span class="chip strong">{c.domain} · {c.count}</span>{/each}
      </div>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .rows { display: flex; flex-direction: column; gap: 10px; }
  .row { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .head strong { font-size: 0.95rem; }
  .badge {
    font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 3px 10px; border-radius: 999px;
  }
  .badge.yes { background: #dcfce7; color: #166534; }
  .badge.no { background: #fee2e2; color: #b91c1c; }
  .badge.none { background: var(--wash); color: var(--ink-faint); }
  .org { font-size: 0.78rem; color: var(--ink-faint); }
  .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip {
    background: var(--wash); border: 1px solid var(--line); border-radius: 999px;
    padding: 3px 10px; font-size: 0.78rem; color: var(--ink-soft);
  }
  .chip.strong { font-weight: 600; color: var(--ink); }
  .sec { font-size: 1.05rem; margin: 28px 0 12px; }
</style>
