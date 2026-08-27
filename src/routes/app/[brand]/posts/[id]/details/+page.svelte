<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const post = $derived(data.post);

  const rows = $derived([
    { label: $_('app.post.details.status'), value: post.status },
    { label: $_('app.post.details.platform'), value: post.platform ?? '—' },
    {
      label: $_('app.post.details.platforms'),
      value: (post.platforms?.length ? post.platforms : [post.platform]).filter(Boolean).join(', ') || '—'
    },
    { label: $_('app.post.details.format'), value: post.format ?? post.content_type ?? '—' },
    { label: $_('app.post.details.pillar'), value: post.pillar ?? '—' },
    { label: $_('app.post.details.angle'), value: post.angle ?? '—' },
    { label: $_('app.post.details.product'), value: post.product_name ?? '—' },
    { label: $_('app.post.details.slot'), value: post.slot ?? '—' },
    { label: $_('app.post.details.scheduled'), value: post.scheduled_for ?? post.whenISO ?? '—' },
    { label: $_('app.post.details.source'), value: post.source ?? '—' },
    { label: $_('app.post.details.sourceUrl'), value: post.source_url ?? '—' },
    { label: $_('app.post.details.externalId'), value: post.external_post_id ?? '—' },
    { label: $_('app.post.details.publishedUrl'), value: post.published_url ?? '—' },
    { label: $_('app.post.details.revisions'), value: String(post.revisions_count ?? 0) },
    { label: $_('app.post.details.planRow'), value: post.plan_row_id ?? '—' },
    // Contratto a due livelli seed→produttore: quando il produttore ha sostituito la scena
    // proposta dal piano, qui compare la sua riga di motivazione (posts.qc.scene_deviation).
    ...(post.qc?.scene_deviation
      ? [{ label: $_('app.post.details.deviation'), value: String(post.qc.scene_deviation) }]
      : [])
  ]);
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.post.details.title')}</div></div>
  <dl class="grid">
    {#each rows as r (r.label)}
      <div class="row">
        <dt>{r.label}</dt>
        <dd>
          {#if typeof r.value === 'string' && /^https?:\/\//.test(r.value)}
            <a href={r.value} target="_blank" rel="noopener">{r.value}</a>
          {:else}
            {r.value}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
</section>

<style>
  .panel {
    padding: 18px 20px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper);
  }
  .t { font-size: 15px; font-weight: 700; margin-bottom: 14px; }
  .grid { display: flex; flex-direction: column; gap: 0; margin: 0; }
  .row {
    display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 12px;
    padding: 11px 0; border-top: 1px solid var(--line);
  }
  .row:first-of-type { border-top: none; }
  dt { font-size: 12px; font-weight: 650; color: var(--ink-soft); }
  dd { margin: 0; font-size: 13.5px; color: var(--ink); word-break: break-word; }
  a { color: var(--accent); }
  @media (max-width: 640px) {
    .row { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
