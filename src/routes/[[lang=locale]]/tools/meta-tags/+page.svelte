<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ToolPage from '$lib/components/ToolPage.svelte';
</script>

<ToolPage toolKey="meta-tags" endpoint="/api/tools/meta-tags">
  {#snippet result(d)}
    <!-- The snippet preview is the point of this tool: see the result before Google shows it. -->
    <div class="serp">
      <span class="serp-label">{$_('tools.meta-tags.previewLabel')}</span>
      <div class="serp-card">
        <div class="serp-url">{d.canonical || d.url}</div>
        <div class="serp-title">{d.title || $_('tools.common.missing')}</div>
        <div class="serp-desc">{d.description || $_('tools.common.missing')}</div>
      </div>
    </div>

    <div class="tags">
      <div class="row"><span>title</span><code>{d.title || '—'}</code><em>{d.titleLength}</em></div>
      <div class="row"><span>description</span><code>{d.description || '—'}</code><em>{d.descriptionLength}</em></div>
      <div class="row"><span>canonical</span><code>{d.canonical || '—'}</code><em></em></div>
      <div class="row"><span>robots</span><code>{d.robots || '—'}</code><em></em></div>
      <div class="row"><span>lang</span><code>{d.lang || '—'}</code><em></em></div>
      {#each Object.entries(d.og) as [k, v]}
        <div class="row"><span>og:{k}</span><code>{v}</code><em></em></div>
      {/each}
      {#each Object.entries(d.twitter) as [k, v]}
        <div class="row"><span>twitter:{k}</span><code>{v}</code><em></em></div>
      {/each}
    </div>
  {/snippet}
</ToolPage>

<style>
  .serp-label {
    font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--ink-faint); font-weight: 600;
  }
  .serp-card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px 20px; margin: 10px 0 26px;
  }
  .serp-url { font-size: 0.82rem; color: #3c714b; margin-bottom: 4px; word-break: break-all; }
  .serp-title { font-size: 1.25rem; color: #1a0dab; line-height: 1.3; margin-bottom: 4px; }
  .serp-desc { font-size: 0.9rem; color: var(--ink-soft); line-height: 1.5; }
  .tags { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .row {
    display: grid; grid-template-columns: 120px 1fr 44px; gap: 12px; align-items: baseline;
    padding: 10px 16px; border-bottom: 1px solid var(--line); font-size: 0.88rem;
  }
  .row:last-child { border-bottom: 0; }
  .row span { color: var(--ink-faint); font-weight: 600; }
  .row code { word-break: break-word; font-family: ui-monospace, monospace; font-size: 0.84rem; }
  .row em { font-style: normal; color: var(--ink-faint); text-align: right; font-size: 0.8rem; }
  @media (max-width: 600px) { .row { grid-template-columns: 1fr; gap: 2px; } .row em { text-align: left; } }
</style>
