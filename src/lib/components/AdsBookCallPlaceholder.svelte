<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { BOOKING_URL } from '$lib/links';
</script>

<!-- Temporary gate while automatic ads are sales-activated. Real page content stays in each
     route behind ADS_SELF_SERVE — remove this component (or flip the flag) when self-serve ships. -->
<section class="ads-gate" aria-labelledby="ads-gate-title">
  <h2 id="ads-gate-title">{$_('app.ads.bookCall.title')}</h2>
  <p>{$_('app.ads.bookCall.body')}</p>
  <a class="cta" href={BOOKING_URL} target="_blank" rel="noopener noreferrer">
    {$_('app.ads.bookCall.cta')}
  </a>
</section>

<style>
  .ads-gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 12px;
    padding: 64px 24px;
    max-width: 480px;
    margin: 32px auto 0;
  }
  h2 {
    margin: 0;
    font-size: clamp(1.35rem, 2.4vw, 1.7rem);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
    color: var(--ink);
  }
  p {
    margin: 0;
    font-size: 14.5px;
    line-height: 1.55;
    color: var(--ink-soft, var(--ink-faint));
    max-width: 42ch;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    height: 40px;
    margin-top: 10px;
    padding: 0 20px;
    border-radius: 980px;
    background: var(--ink);
    color: var(--paper);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: transform 0.2s var(--ease, ease);
  }
  .cta:hover {
    transform: scale(1.04);
  }
</style>
