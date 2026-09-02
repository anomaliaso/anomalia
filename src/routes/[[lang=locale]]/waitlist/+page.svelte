<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { BOOKING_URL } from '$lib/links';

  let { data } = $props();

  // Calendly precompilato: chi è già dentro non riscrive nome ed email per prenotare.
  const bookingUrl = $derived(
    `${BOOKING_URL}?hide_gdpr_banner=1` +
      (data.email ? `&email=${encodeURIComponent(data.email)}` : '') +
      (data.fullName ? `&name=${encodeURIComponent(data.fullName)}` : '')
  );
</script>

<svelte:head>
  <title>{$_('meta.waitlist.title')}</title>
  <!-- La pagina mostra l'email di chi la guarda: fuori dall'indice. -->
  <meta name="robots" content="noindex, nofollow" />
  <script async src="https://assets.calendly.com/assets/external/widget.js"></script>
</svelte:head>

<main class="wrap">
  <div class="mark">Anomalia</div>
  <h1>{$_('waitlist.title')}</h1>
  <p class="sub">{$_('waitlist.sub')}</p>

  <!-- L'embed è il punto della pagina, non un ornamento: un link porta via, un calendario fa
       prenotare. Il link sotto resta per chi ha gli script di terze parti bloccati. -->
  <div class="calendly-inline-widget" data-url={bookingUrl}></div>

  <p class="note">
    {$_('waitlist.note')}
    <a href={bookingUrl} target="_blank" rel="noopener">{$_('waitlist.fallback')}</a>
  </p>
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
    background: linear-gradient(135deg, var(--accent-2, #9d86ff), var(--accent, #7c5cff));
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 22px;
    box-shadow: 0 16px 40px -16px rgba(var(--accent-rgb), 0.6);
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
  .calendly-inline-widget {
    width: 100%;
    max-width: 820px;
    min-width: 0;
    height: 700px;
    margin-top: 18px;
  }
  .note {
    color: var(--ink-soft, #6e6e73);
    font-size: 0.9rem;
    margin: 6px 0 0;
  }
  @media (max-width: 640px) {
    .calendly-inline-widget {
      height: 880px;
    }
  }
</style>
