<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
</script>

<ToolPage
  toolKey="rank-checker"
  endpoint="/api/tools/rank-checker"
  fields={[{ name: 'keyword' }, { name: 'url' }]}
>
  {#snippet result(d)}
    <div class="verdict" class:found={d.yourPosition}>
      {#if d.yourPosition}
        <span class="pos">#{d.yourPosition}</span>
        <p>{$_('tools.rank-checker.ranked', { values: { keyword: d.keyword } })}</p>
        {#if d.yourUrl}<code>{d.yourUrl}</code>{/if}
      {:else}
        <p>{$_('tools.rank-checker.notRanked', { values: { keyword: d.keyword } })}</p>
      {/if}
    </div>

    {#if d.hasAiOverview}
      <div class="ai-note">{$_('tools.rank-checker.aiOverview')}</div>
    {/if}

    <h3 class="sec">{$_('tools.rank-checker.top10')}</h3>
    <div class="serp">
      {#each d.topResults as r}
        <div class="row" class:mine={d.yourUrl === r.url}>
          <span class="n">{r.position}</span>
          <div>
            <strong>{r.title}</strong>
            <span class="dom">{r.domain}</span>
          </div>
        </div>
      {/each}
    </div>
  {/snippet}
</ToolPage>

<style>
  .verdict {
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
    padding: 24px; margin-bottom: 16px; text-align: center;
  }
  .verdict.found { border-color: #bbf7d0; background: #f0fdf4; }
  .pos { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.03em; display: block; }
  .verdict p { margin: 6px 0 0; color: var(--ink-soft); line-height: 1.5; }
  .verdict code { display: block; margin-top: 8px; font-size: 0.8rem; word-break: break-all; color: var(--ink-faint); }
  .ai-note {
    background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af;
    border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; font-size: 0.9rem;
  }
  .sec { font-size: 1.05rem; margin: 28px 0 12px; }
  .serp { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .row {
    display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: baseline;
    padding: 12px 16px; border-bottom: 1px solid var(--line);
  }
  .row:last-child { border-bottom: 0; }
  .row.mine { background: #f0fdf4; }
  .n { color: var(--ink-faint); font-weight: 700; font-size: 0.85rem; }
  .row strong { display: block; font-size: 0.92rem; font-weight: 550; line-height: 1.35; }
  .dom { font-size: 0.8rem; color: var(--ink-faint); }
</style>
