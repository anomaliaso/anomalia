<script lang="ts">
  import '$lib/styles/landing.css';
  import { locale } from 'svelte-i18n';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  import entries from '$lib/content/changelog/legacy';

  const isIt = $derived(($locale ?? 'en').startsWith('it'));
</script>

<svelte:head>
  <title>{isIt ? 'Novità' : 'Changelog'} — Anomalia</title>
  <meta name="description" content={isIt ? 'Tutte le novità, miglioramenti e correzioni di Anomalia. Scopri cosa cambia nel prodotto.' : 'All new features, improvements and fixes in Anomalia. See what changed in the product.'} />
  <meta property="og:title" content="{isIt ? 'Novità' : 'Changelog'} — Anomalia" />
  <meta property="og:description" content={isIt ? 'Tutte le novità, miglioramenti e correzioni di Anomalia.' : 'All new features, improvements and fixes in Anomalia.'} />
</svelte:head>

<SiteNav current="" />

<main class="changelog-page">
  <div class="changelog-wrap">
    <header class="changelog-header">
      <p class="cl-eyebrow">{isIt ? 'Novità' : 'Changelog'}</p>
      <h1 class="cl-title">{isIt ? 'Cosa cambia in Anomalia' : 'What changed in Anomalia'}</h1>
      <p class="cl-subtitle">{isIt ? 'Ogni aggiunta, miglioramento e correzione al prodotto — dal più recente al più vecchio.' : 'Every addition, improvement and fix to the product — from most recent to oldest.'}</p>
    </header>

    <div class="timeline">
      {#each entries as entry}
        <section class="entry">
          <div class="entry-marker">
            <span class="entry-date">{entry.date}</span>
          </div>
          <div class="entry-content">
            <h2>{entry.title}</h2>
            <ul>
              {#each entry.items as item}
                <li>{item}</li>
              {/each}
            </ul>
          </div>
        </section>
      {/each}
    </div>
  </div>
</main>

<SiteFooter />

<style>
  .changelog-page {
    min-height: 100vh;
    padding-bottom: 80px;
    padding-top: 56px;
  }
  .changelog-wrap {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .changelog-header {
    text-align: center;
    padding: 64px 0 56px;
  }
  .cl-eyebrow {
    display: inline-block;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent, #7c5cff);
    margin: 0 0 16px;
    padding: 6px 14px;
    border-radius: 980px;
    background: rgba(var(--accent-rgb, 124, 92, 255), 0.07);
    border: 1px solid rgba(var(--accent-rgb, 124, 92, 255), 0.12);
  }
  .cl-title {
    font-family: var(--serif, Georgia, serif);
    font-size: clamp(2.2rem, 4.4vw, 3.6rem);
    font-weight: var(--heading-weight, 700);
    letter-spacing: var(--heading-tracking, -0.02em);
    line-height: 1.12;
    margin: 0 auto 12px;
    max-width: 20ch;
    color: var(--ink, #1a1a1a);
    text-align: center;
  }
  .cl-subtitle {
    font-size: 17px;
    color: var(--ink-soft, #666);
    margin: 0;
    max-width: 520px;
    margin: 0 auto;
    line-height: 1.55;
  }

  .timeline {
    border-left: 2px solid var(--line, #e5e5e5);
    padding-left: 32px;
    margin-left: 0;
  }
  .entry {
    position: relative;
    padding-top: 24px;
    padding-bottom: 40px;
  }
  .entry:last-child {
    padding-bottom: 0;
  }
  .entry-marker {
    position: absolute;
    left: -41px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent, #7c5cff);
    border: 2px solid var(--paper, #fff);
    box-shadow: 0 0 0 2px var(--accent, #7c5cff);
  }
  .entry-date {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-faint, #999);
    margin-bottom: 8px;
    position: absolute;
    left: 32px;
    top: -2px;
    white-space: nowrap;
  }
  .entry-content {
    padding-top: 28px;
  }
  .entry-content h2 {
    font-family: var(--sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
    color: var(--ink, #1a1a1a);
    letter-spacing: -0.01em;
  }
  .entry-content ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .entry-content li {
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-soft, #555);
    padding-left: 18px;
    position: relative;
  }
  .entry-content li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 9px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line, #ddd);
  }

  :global(:root[data-theme="dark"]) .cl-title { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .cl-subtitle { color: #999; }
  :global(:root[data-theme="dark"]) .entry-content h2 { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .entry-content li { color: #aaa; }
  :global(:root[data-theme="dark"]) .timeline { border-color: #333; }
  :global(:root[data-theme="dark"]) .entry-marker { border-color: #1a1a1a; }
  :global(:root[data-theme="dark"]) .entry-content li::before { background: #444; }

  @media (max-width: 640px) {
    .changelog-header { padding: 48px 0 36px; }
    .cl-title { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .timeline { padding-left: 20px; }
    .entry-marker { left: -29px; width: 10px; height: 10px; }
    .entry-date { left: 20px; font-size: 12px; }
    .entry-content { padding-top: 24px; }
  }
</style>
