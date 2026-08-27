<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
</script>

<ToolPage toolKey="page-speed" endpoint="/api/tools/page-speed">
  {#snippet result(d)}
    {#if d.score != null}
      <div class="score v-{d.score >= 90 ? 'good' : d.score >= 50 ? 'mid' : 'poor'}">
        <span class="n">{d.score}</span>
        <span class="l">{$_('tools.page-speed.labScore')}</span>
      </div>
    {/if}

    <!-- Field data first: it is what Google ranks on. Lab is the fallback simulation. -->
    {#if d.field}
      <h3 class="sec">{$_('tools.page-speed.fieldTitle')}</h3>
      <p class="sec-desc">{$_('tools.page-speed.fieldDesc')}</p>
      <div class="metrics">
        {#each d.field.metrics as m (m.id)}
          <div class="metric v-{m.verdict}">
            <span class="id">{m.id}</span>
            <span class="val">{m.display}</span>
            <span class="name">{d.labels[m.id] ?? m.id}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if d.lab.length}
      <h3 class="sec">{$_('tools.page-speed.labTitle')}</h3>
      <p class="sec-desc">{$_('tools.page-speed.labDesc')}</p>
      <div class="metrics">
        {#each d.lab as m (m.id)}
          <div class="metric v-{m.verdict}">
            <span class="id">{m.id}</span>
            <span class="val">{m.display}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if d.opportunities.length}
      <h3 class="sec">{$_('tools.page-speed.oppTitle')}</h3>
      <div class="opps">
        {#each d.opportunities as o}
          <div class="opp">
            <span>{o.title}</span>
            <strong>−{(o.savingsMs / 1000).toFixed(1)}s</strong>
          </div>
        {/each}
      </div>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .score {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    width: 128px; padding: 20px; margin: 0 auto 26px;
    border: 3px solid var(--line); border-radius: 50%; aspect-ratio: 1; justify-content: center;
  }
  .score .n { font-size: 2.4rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .score .l { font-size: 0.7rem; color: var(--ink-faint); text-align: center; }
  .score.v-good { border-color: #16a34a; }
  .score.v-mid { border-color: #d97706; }
  .score.v-poor { border-color: #dc2626; }
  .sec { font-size: 1.05rem; margin: 26px 0 4px; }
  .sec-desc { font-size: 0.85rem; color: var(--ink-faint); margin: 0 0 14px; line-height: 1.5; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .metric {
    background: var(--paper); border: 1px solid var(--line); border-left-width: 3px;
    border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px;
  }
  .metric.v-good { border-left-color: #16a34a; }
  .metric.v-needs-improvement { border-left-color: #d97706; }
  .metric.v-poor { border-left-color: #dc2626; }
  .metric.v-unknown { border-left-color: var(--line); }
  .id { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em; color: var(--ink-faint); }
  .val { font-size: 1.3rem; font-weight: 650; letter-spacing: -0.02em; }
  .name { font-size: 0.75rem; color: var(--ink-faint); }
  .opps { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .opp {
    display: flex; justify-content: space-between; gap: 14px; align-items: baseline;
    padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 0.88rem;
  }
  .opp:last-child { border-bottom: 0; }
  .opp strong { color: #16a34a; white-space: nowrap; }
</style>
