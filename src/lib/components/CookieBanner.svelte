<script lang="ts">
  // Small bottom-left cookie consent banner. Shows on first visit (no stored choice) and
  // whenever the user re-opens preferences via openCookieSettings(). Anonymous, cookieless
  // analytics run regardless; accepting upgrades to full (cookies + session replay).
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';
  import { _ } from 'svelte-i18n';
  import { showBanner, consent, setConsent } from '$lib/consent';
  import { startAnonymousAnalytics, enableFullAnalytics } from '$lib/analytics';

  onMount(() => {
    startAnonymousAnalytics(); // schedules PostHog for interaction / 10s
    const unsub = consent.subscribe((v) => {
      if (v === 'granted') enableFullAnalytics(); // tier 2 — already-accepted visitors
    });
    return unsub;
  });
</script>

<!--
  Nascosta SOLO in `npm run dev`: a 1280x720 la banner copre la CTA di accesso e blocca il click nei
  test automatici. `dev` da $app/environment è una costante di compilazione (true solo sotto
  `vite dev`) — un build di produzione o di preview la vede false, quindi ai clienti veri la banner
  resta esattamente com'era. Deve restare `dev`: un controllo sull'hostname o un `import.meta.env`
  sbagliato farebbe sparire un obbligo di legge in produzione.

  Si nasconde qui, nel markup, e NON in `initConsentForRegion`: il consenso resta `null` come per
  chiunque non abbia ancora scelto, quindi in locale si continua a girare sul percorso "non ha
  acconsentito" — lo stesso che vede un visitatore EEA. Nascondere non è acconsentire.
-->
{#if $showBanner && !dev}
  <div class="cc" role="dialog" aria-labelledby="cc-title">
    <p id="cc-title">
      {$_('cookie.text')}
      <a href="/privacy">{$_('cookie.learnMore')}</a>.
    </p>
    <div class="cc-actions">
      <button class="cc-btn ghost" type="button" onclick={() => setConsent('denied')}>{$_('cookie.reject')}</button>
      <button class="cc-btn primary" type="button" onclick={() => setConsent('granted')}>{$_('cookie.accept')}</button>
    </div>
  </div>
{/if}

<style>
  .cc {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 9999;
    width: calc(100% - 32px);
    max-width: 320px;
    background: #fff;
    border: 1px solid #d2d2d7;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
    padding: 14px 14px 12px;
    font-family: var(--sans, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial,
      sans-serif);
    color: #1d1d1f;
    animation: cc-in 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes cc-in {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .cc p {
    font-size: 12.5px;
    line-height: 1.5;
    color: #424245;
    margin: 0 0 12px;
  }
  .cc a {
    color: #7c5cff;
    text-decoration: none;
  }
  .cc a:hover {
    text-decoration: underline;
  }
  .cc-actions {
    display: flex;
    gap: 8px;
  }
  .cc-btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 980px;
    padding: 7px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .cc-btn:active {
    transform: scale(0.97);
  }
  .cc-btn.ghost {
    background: #fff;
    border-color: #d2d2d7;
    color: #1d1d1f;
  }
  .cc-btn.ghost:hover {
    border-color: #86868b;
  }
  .cc-btn.primary {
    background: #7c5cff;
    color: #fff;
  }
  .cc-btn.primary:hover {
    background: #6b49f5;
  }
  @media (prefers-reduced-motion: reduce) {
    .cc {
      animation: none;
    }
  }
</style>
