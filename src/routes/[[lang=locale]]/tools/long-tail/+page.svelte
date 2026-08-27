<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolKeywordTable from '$lib/components/ToolKeywordTable.svelte';
</script>

<ToolPage toolKey="long-tail" endpoint="/api/tools/long-tail" fields={[{ name: 'keyword' }]}>
  {#snippet result(d)}
    <ToolKeywordTable keywords={d.keywords} />
    {#if d.lockedCount > 0}
      <p class="locked">
        {$_('tools.long-tail.locked', { values: { count: d.lockedCount } })}
      </p>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .locked { margin-top: 14px; font-size: 0.88rem; color: var(--ink-soft); }
</style>
