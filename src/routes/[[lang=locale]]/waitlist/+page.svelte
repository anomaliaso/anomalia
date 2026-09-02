<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { BOOKING_URL } from '$lib/links';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let { data } = $props();

  // Calendly precompilato: chi è già dentro non riscrive nome ed email per prenotare.
  const bookingUrl = $derived(
    `${BOOKING_URL}?hide_gdpr_banner=1` +
      (data.email ? `&email=${encodeURIComponent(data.email)}` : '') +
      (data.fullName ? `&name=${encodeURIComponent(data.fullName)}` : '')
  );

  const WIDGET_SRC = 'https://assets.calendly.com/assets/external/widget.js';

  let host = $state<HTMLDivElement>();

  /**
   * Si inizializza a mano, e il contenitore NON porta la classe `calendly-inline-widget`.
   * Lasciata a loro, la scansione automatica di quello script corre contro l'idratazione e
   * monta il calendario DUE volte nello stesso div: due iframe che si contendono lo stesso
   * posto, e quello che resta non finisce mai di caricare. Visto succedere in locale.
   */
  onMount(() => {
    const mount = () => {
      const api = (window as unknown as { Calendly?: { initInlineWidget: (o: unknown) => void } }).Calendly;
      if (!api || !host) return;
      api.initInlineWidget({ url: bookingUrl, parentElement: host });
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
    if (existing) {
      mount();
      return;
    }

    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.addEventListener('load', mount);
    document.head.appendChild(script);
  });
</script>

<svelte:head>
  <title>{$_('meta.waitlist.title')}</title>
  <!-- La pagina mostra l'email di chi la guarda: fuori dall'indice. -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="wrap">
  <div class="mark"><BrandMark size={30} tone="negative" /></div>
  <h1>{$_('waitlist.title')}</h1>
  <p class="sub">{$_('waitlist.sub')}</p>

  <!-- Il link sta SOPRA il calendario, non sotto. L'embed di Calendly ci mette dai dieci ai
       trenta secondi a dipingere, e mille pixel di riquadro bianco spingono qualsiasi cosa stia
       sotto fuori dallo schermo: chi arriva mentre gira la rotella deve avere qualcosa da
       cliccare, non un rettangolo vuoto. -->
  <p class="note">
    {$_('waitlist.note')}
    <a href={bookingUrl} target="_blank" rel="noopener">{$_('waitlist.fallback')}</a>
  </p>

  <div class="booking" bind:this={host}></div>
</main>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 24px;
    gap: 6px;
  }
  .mark {
    width: 60px;
    height: 60px;
    border-radius: 18px;
    background: #000;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 22px;
  }
  h1 {
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0;
  }
  .sub {
    color: var(--ink-soft, #6e6e73);
    margin: 12px 0 0;
    max-width: 42ch;
    line-height: 1.45;
  }
  /* Il widget di Calendly ha lo sfondo TRASPARENTE: senza questo bianco il tema scuro passa
     sotto la sua card e il calendario finisce scritto su nero. E 700px tagliano il flusso a
     metà — la scelta dell'orario sta sotto la data. */
  .booking {
    width: 100%;
    max-width: 820px;
    min-width: 0;
    height: 1000px;
    margin-top: 18px;
    background: #fff;
    border-radius: 14px;
  }
  .note {
    color: var(--ink-soft, #6e6e73);
    font-size: 0.9rem;
    margin: 14px 0 0;
  }
  .note a {
    color: var(--accent, #7c5cff);
    text-decoration: underline;
  }
  @media (max-width: 640px) {
    .booking {
      height: 1120px;
    }
  }
</style>
