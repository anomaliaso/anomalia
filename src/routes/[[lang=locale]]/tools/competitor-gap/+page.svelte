<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
  import ToolKeywordTable from '$lib/components/ToolKeywordTable.svelte';
</script>

<ToolPage
  toolKey="competitor-gap"
  endpoint="/api/tools/competitor-gap"
  fields={[{ name: 'url' }, { name: 'competitor' }]}
>
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.competitor-gap.stats.gap'), value: d.totalFound },
        { label: $_('tools.competitor-gap.stats.missing'), value: d.missingEntirely }
      ]}
    />
    <ToolKeywordTable keywords={d.keywords} positions />
    {#if d.lockedCount > 0}
      <p class="locked">{$_('tools.competitor-gap.locked', { values: { count: d.lockedCount } })}</p>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .locked { margin-top: 14px; font-size: 0.88rem; color: var(--ink-soft); }
</style>
