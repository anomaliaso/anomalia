<script lang="ts">
  import { _ } from 'svelte-i18n';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { BOOKING_URL } from '$lib/links';

  let { data } = $props();
  const brand = $derived(data.brand);
</script>

<div class="wrap">
  <div class="card">
    <p class="eyebrow">{$_('app.success.eyebrow')}</p>
    <h1>{$_('app.success.title', { values: { brand: brand.name } })}</h1>
    <p class="body">{$_('app.success.body')}</p>
    <div class="actions">
      <a class="btn btn-accent" href={`/app/${brand.slug}`}>{$_('app.success.cta')}</a>
      <a class="btn btn-ghost" href={BOOKING_URL} target="_blank" rel="noopener noreferrer">
        {$_('app.success.book')}
      </a>
    </div>
  </div>
</div>

<MarcoWidget />

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 32px 20px;
    background: var(--bg, #faf9f7);
  }
  .card {
    width: min(520px, 100%);
    text-align: center;
  }
  .eyebrow {
    margin: 0 0 10px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted, #888);
  }
  h1 {
    margin: 0 0 12px;
    font-size: clamp(1.6rem, 4vw, 2.1rem);
    line-height: 1.2;
    font-weight: 650;
  }
  .body {
    margin: 0 0 28px;
    color: var(--muted-fg, #555);
    line-height: 1.55;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
</style>
