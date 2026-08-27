<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolKeywordTable from '$lib/components/ToolKeywordTable.svelte';
</script>

<ToolPage toolKey="keyword-difficulty" endpoint="/api/tools/keyword-difficulty" fields={[{ name: 'keywords' }]}>
  {#snippet result(d)}
    <ToolKeywordTable keywords={d.keywords} />
    {#if d.notFound.length}
      <p class="notfound">{$_('tools.keyword-difficulty.notFound')} {d.notFound.join(', ')}</p>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .notfound { margin-top: 14px; font-size: 0.85rem; color: var(--ink-faint); }
</style>
