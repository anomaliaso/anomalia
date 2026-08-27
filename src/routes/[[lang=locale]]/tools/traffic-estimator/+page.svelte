<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
  import ToolStats from '$lib/components/ToolStats.svelte';
  import ToolKeywordTable from '$lib/components/ToolKeywordTable.svelte';
</script>

<ToolPage toolKey="traffic-estimator" endpoint="/api/tools/traffic-estimator">
  {#snippet result(d)}
    <ToolStats
      stats={[
        { label: $_('tools.traffic-estimator.stats.traffic'), value: d.estMonthlyTraffic.toLocaleString() },
        { label: $_('tools.traffic-estimator.stats.keywords'), value: d.organicKeywords.toLocaleString() },
        { label: $_('tools.traffic-estimator.stats.top10'), value: d.keywordsTop10.toLocaleString(), hint: `${d.keywordsTop3} ${$_('tools.traffic-estimator.stats.top3')}` },
        { label: $_('tools.traffic-estimator.stats.value'), value: `$${d.estTrafficCost.toLocaleString()}` }
      ]}
    />

    {#if d.topKeywords.length}
      <h3 class="sec">{$_('tools.traffic-estimator.topKeywords')}</h3>
      <ToolKeywordTable keywords={d.topKeywords} />
    {/if}
  {/snippet}
</ToolPage>

<style>
  .sec { font-size: 1.05rem; margin: 28px 0 12px; }
</style>
