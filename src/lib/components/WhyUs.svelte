<script lang="ts">
  import { _ } from 'svelte-i18n';

  const metrics = $derived([
    { num: $_('landing.whyus.metric.0.num'), label: $_('landing.whyus.metric.0.label') },
    { num: $_('landing.whyus.metric.1.num'), label: $_('landing.whyus.metric.1.label') },
    { num: $_('landing.whyus.metric.2.num'), label: $_('landing.whyus.metric.2.label') },
  ]);
</script>

<section class="whyus-sec">
  <div class="wrap">
    <div class="whyus-layout">
      <div class="whyus-story reveal">
        <div class="kicker">{$_('landing.whyus.kicker')}</div>
        <!-- Sparkline: 0,0,0,0,0,0,0,0,25,50,80,110 -->
        <svg class="whyus-chart" viewBox="0 0 300 64" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="whyus-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.15" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d="M0,60 L30,60 L60,60 L90,60 L120,60 L150,60 L180,60 L210,60 L240,52 L260,30 L280,8 L300,-4 L300,60 Z" fill="url(#whyus-grad)" />
          <polyline points="0,60 30,60 60,60 90,60 120,60 150,60 180,60 210,60 240,52 260,30 280,8 300,-4" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="300" cy="-4" r="4" fill="var(--accent)" />
        </svg>
        <h2>{$_('landing.whyus.title')}</h2>
        <p class="whyus-body">{$_('landing.whyus.story')}</p>
        <div class="whyus-signature">
          <img class="whyus-photo" src="/why/founders.webp" width="56" height="56" alt="I fondatori di Anomalia" loading="lazy" />
          <span class="whyus-sig-label">{$_('landing.whyus.signature')}</span>
        </div>
        <div class="whyus-metrics">
          {#each metrics as m}
            <div class="whyus-metric">
              <span class="whyus-m-num">{m.num}</span>
              <span class="whyus-m-label">{m.label}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .whyus-sec { padding-block: 120px; }

  .whyus-layout { max-width: 620px; margin-inline: auto; }

  .whyus-story .kicker { margin-bottom: 8px; }
  .whyus-signature { display: flex; align-items: center; gap: 12px; margin: 0 0 32px; }
  .whyus-photo { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--paper-2); flex-shrink: 0; }
  .whyus-sig-label { font-size: 0.85rem; color: var(--ink-faint); line-height: 1.35; }
  .whyus-chart { width: 100%; height: auto; margin-bottom: 16px; }
  .whyus-story h2 { font-size: clamp(1.8rem, 3vw, 2.4rem); font-weight: 700; letter-spacing: -0.04em; margin: 0 0 20px; }
  .whyus-body { color: var(--ink-soft); font-size: 1.05rem; line-height: 1.65; margin: 0 0 20px; max-width: 48ch; }
  .whyus-metrics { display: flex; gap: 20px; flex-wrap: wrap; }
  .whyus-metric { display: flex; flex-direction: column; }
  .whyus-m-num { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; color: var(--accent); }
  .whyus-m-label { font-size: 0.82rem; color: var(--ink-faint); margin-top: 2px; max-width: 14ch; line-height: 1.3; }

  @media (max-width: 768px) {
    .whyus-metrics { gap: 16px; }
    .whyus-sec { padding-block: 64px; }
  }
</style>
