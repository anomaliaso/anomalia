<script lang="ts">
  import { _ } from 'svelte-i18n';

  // Shared keyword table for every DataForSEO-backed tool. `positions` adds the you/them columns
  // the competitor-gap tool needs; the others leave it off.
  let {
    keywords,
    positions = false
  }: {
    keywords: Array<{
      keyword: string; volume: number; difficulty: number; cpc: number;
      intent?: string | null; opportunity?: string; yourPosition?: number | null; theirPosition?: number | null;
    }>;
    positions?: boolean;
  } = $props();

  const fmtVolume = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n || 0));
  const kdClass = (d: number) => (d <= 30 ? 'easy' : d <= 60 ? 'mid' : 'hard');
</script>

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th>{$_('tools.common.kw.keyword')}</th>
        <th>{$_('tools.common.kw.volume')}</th>
        <th>{$_('tools.common.kw.difficulty')}</th>
        <th>{$_('tools.common.kw.cpc')}</th>
        {#if positions}
          <th>{$_('tools.common.kw.you')}</th>
          <th>{$_('tools.common.kw.them')}</th>
        {/if}
      </tr>
    </thead>
    <tbody>
      {#each keywords as k (k.keyword)}
        <tr>
          <td class="kw">
            {k.keyword}
            {#if k.intent}<span class="intent">{k.intent}</span>{/if}
          </td>
          <td>{fmtVolume(k.volume)}</td>
          <td><span class="kd {kdClass(k.difficulty)}">{k.difficulty || 0}</span></td>
          <td>{k.cpc ? `$${k.cpc.toFixed(2)}` : '—'}</td>
          {#if positions}
            <td>{k.yourPosition ?? '—'}</td>
            <td>{k.theirPosition ?? '—'}</td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* Wide tables scroll inside their own container so the page body never scrolls sideways. */
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; min-width: 480px; }
  th {
    text-align: left; padding: 12px 16px; font-size: 0.74rem; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--ink-faint); border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  td { padding: 12px 16px; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: 0; }
  .kw { font-weight: 500; }
  .intent {
    display: inline-block; margin-left: 8px; font-size: 0.68rem; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--ink-faint); background: var(--wash);
    border-radius: 999px; padding: 2px 8px;
  }
  .kd { font-weight: 650; border-radius: 6px; padding: 2px 8px; }
  .kd.easy { background: #dcfce7; color: #166534; }
  .kd.mid { background: #fef3c7; color: #92400e; }
  .kd.hard { background: #fee2e2; color: #b91c1c; }
</style>
