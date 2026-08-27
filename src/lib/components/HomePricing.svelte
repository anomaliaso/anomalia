<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { startHref }: { startHref: string } = $props();

  const GITHUB_URL = 'https://github.com/anomaliaso/anomalia';

  const cloudFeatures = $derived([
    $_('landing.pricing.cloud.f0'),
    $_('landing.pricing.cloud.f1'),
    $_('landing.pricing.cloud.f2'),
    $_('landing.pricing.cloud.f3')
  ]);

  const selfHostFeatures = $derived([
    $_('landing.pricing.selfhost.f0'),
    $_('landing.pricing.selfhost.f1'),
    $_('landing.pricing.selfhost.f2'),
    $_('landing.pricing.selfhost.f3')
  ]);
</script>

<section class="hp-sec">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_('landing.pricing.kicker')}</div>
      <h2>{$_('landing.pricing.titleLead')} <span class="gr-accent">{$_('landing.pricing.titleAccent')}</span></h2>
      <p>{$_('landing.pricing.lede')}</p>
    </div>

    <div class="hp-grid">
      <article class="hp-card reveal" data-d="1">
        <div class="hp-card-head">
          <h3>{$_('landing.pricing.cloud.name')}</h3>
          <span class="hp-badge hp-badge-accent">{$_('landing.pricing.cloud.badge')}</span>
        </div>
        <p class="hp-meta">{$_('landing.pricing.cloud.meta')}</p>
        <ul class="hp-list">
          {#each cloudFeatures as f}
            <li><span class="hp-check" aria-hidden="true">✓</span>{f}</li>
          {/each}
        </ul>
        <a class="btn btn-primary hp-cta" href={startHref}>{$_('landing.pricing.cloud.cta')}</a>
      </article>

      <article class="hp-card hp-card-muted reveal" data-d="2">
        <div class="hp-card-head">
          <h3>{$_('landing.pricing.selfhost.name')}</h3>
          <span class="hp-badge">{$_('landing.pricing.selfhost.badge')}</span>
        </div>
        <p class="hp-meta">{$_('landing.pricing.selfhost.meta')}</p>
        <ul class="hp-list">
          {#each selfHostFeatures as f}
            <li><span class="hp-check" aria-hidden="true">✓</span>{f}</li>
          {/each}
        </ul>
        <a class="btn btn-ghost hp-cta" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          {$_('landing.pricing.selfhost.cta')} <span class="arr">→</span>
        </a>
      </article>
    </div>

    <p class="hp-apps reveal" data-d="3">{$_('landing.pricing.apps')}</p>
  </div>
</section>

<style>
  .hp-sec { padding-block: 120px; }

  .hp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    max-width: 940px;
    margin-inline: auto;
    align-items: stretch;
  }

  .hp-card {
    display: flex;
    flex-direction: column;
    padding: 36px;
    border-radius: 20px;
    background: var(--paper-2);
    border: 1px solid var(--line);
  }

  .hp-card-muted { background: transparent; }

  .hp-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .hp-card-head h3 {
    font-family: var(--serif);
    font-size: 1.6rem;
    font-weight: var(--heading-weight);
    letter-spacing: -0.03em;
  }

  .hp-badge {
    flex-shrink: 0;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-faint);
  }

  .hp-badge-accent {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .hp-meta {
    margin-top: 10px;
    color: var(--ink-faint);
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .hp-list {
    list-style: none;
    margin: 24px 0 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-grow: 1;
  }

  .hp-list li {
    display: flex;
    gap: 10px;
    font-size: 0.98rem;
    line-height: 1.45;
    color: var(--ink-soft);
  }

  .hp-check {
    color: var(--accent);
    font-weight: 700;
    flex-shrink: 0;
  }

  .hp-cta { align-self: flex-start; }

  .hp-apps {
    margin: 28px auto 0;
    text-align: center;
    color: var(--ink-faint);
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .hp-sec { padding-block: 64px; }
    .hp-grid { grid-template-columns: 1fr; }
  }
</style>
