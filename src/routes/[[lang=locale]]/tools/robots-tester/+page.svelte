<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
</script>

<ToolPage
  toolKey="robots-tester"
  endpoint="/api/tools/robots-tester"
  fields={[{ name: 'url' }, { name: 'path', optional: true }]}
>
  {#snippet result(d)}
    <div class="verdicts">
      {#each d.tests as t}
        <div class="verdict" class:blocked={!t.allowed}>
          <span class="ua">{t.userAgent}</span>
          <span class="badge">{t.allowed ? $_('tools.robots-tester.allowed') : $_('tools.robots-tester.blocked')}</span>
          {#if t.matchedRule}<code>{t.matchedRule}</code>{/if}
        </div>
      {/each}
    </div>

    {#if d.sitemaps.length}
      <div class="sitemaps">
        <h3>{$_('tools.robots-tester.sitemaps')}</h3>
        {#each d.sitemaps as s}<a href={s} target="_blank" rel="noopener noreferrer nofollow">{s}</a>{/each}
      </div>
    {/if}

    {#if d.found}
      <details class="raw">
        <summary>{$_('tools.robots-tester.viewRaw')}</summary>
        <pre>{d.raw.slice(0, 4000)}</pre>
      </details>
    {/if}
  {/snippet}
</ToolPage>

<style>
  .verdicts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
  .verdict {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px;
  }
  .verdict.blocked { border-color: #fecaca; background: #fef2f2; }
  .ua { font-weight: 600; min-width: 130px; font-size: 0.9rem; }
  .badge {
    font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 3px 10px; border-radius: 999px; background: #dcfce7; color: #166534;
  }
  .verdict.blocked .badge { background: #fee2e2; color: #b91c1c; }
  .verdict code { font-size: 0.8rem; color: var(--ink-faint); font-family: ui-monospace, monospace; }
  .sitemaps { margin-bottom: 20px; }
  .sitemaps h3 { font-size: 0.95rem; margin: 0 0 8px; }
  .sitemaps a { display: block; font-size: 0.85rem; word-break: break-all; margin-bottom: 4px; }
  .raw summary { cursor: pointer; font-size: 0.88rem; color: var(--ink-soft); }
  .raw pre {
    margin: 10px 0 0; padding: 14px; background: var(--wash); border-radius: 12px;
    font-size: 0.78rem; overflow-x: auto; line-height: 1.5;
  }
</style>
