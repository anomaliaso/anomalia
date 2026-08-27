<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';

  const statusClass = (s: number) =>
    s === 0 ? 'err' : s < 300 ? 'ok' : s < 400 ? 'redir' : 'err';
</script>

<ToolPage toolKey="redirect-checker" endpoint="/api/tools/redirect-checker">
  {#snippet result(d)}
    <ol class="chain">
      {#each d.hops as h, i}
        <li>
          <span class="status {statusClass(h.status)}">{h.status || '×'}</span>
          <span class="url">{h.url}</span>
          {#if i < d.hops.length - 1}<span class="arrow">↓</span>{/if}
        </li>
      {/each}
    </ol>

    <div class="final">
      <span>{$_('tools.redirect-checker.finalUrl')}</span>
      <code>{d.finalUrl}</code>
      {#if d.canonical}
        <span>{$_('tools.redirect-checker.canonical')}</span>
        <code>{d.canonical}</code>
      {/if}
    </div>
  {/snippet}
</ToolPage>

<style>
  .chain { list-style: none; margin: 0 0 24px; padding: 0; }
  .chain li {
    display: grid; grid-template-columns: 56px 1fr; gap: 12px; align-items: center;
    background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 16px; margin-bottom: 8px; position: relative;
  }
  .status {
    font-weight: 700; font-size: 0.85rem; text-align: center; border-radius: 8px; padding: 4px 0;
  }
  .status.ok { background: #dcfce7; color: #166534; }
  .status.redir { background: #fef3c7; color: #92400e; }
  .status.err { background: #fee2e2; color: #b91c1c; }
  .url { word-break: break-all; font-size: 0.88rem; }
  .arrow { position: absolute; bottom: -14px; left: 28px; color: var(--ink-faint); font-size: 0.8rem; }
  .final {
    display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; align-items: baseline;
    background: var(--wash); border-radius: 12px; padding: 16px 18px; font-size: 0.88rem;
  }
  .final span { color: var(--ink-faint); font-weight: 600; }
  .final code { word-break: break-all; font-family: ui-monospace, monospace; font-size: 0.82rem; }
</style>
