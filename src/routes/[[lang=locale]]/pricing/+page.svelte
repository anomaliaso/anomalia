<script lang="ts">
  import { untrack } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import AskAiCta from '$lib/components/AskAiCta.svelte';
  import PlanCards from '$lib/components/PlanCards.svelte';
  import {
    currencyForCountry,
    FREE_CREDITS,
    visiblePlans,
    type Currency
  } from '$lib/plans';
  import { BOOKING_URL } from '$lib/links';
  import { marketingStartHref } from '$lib/start-href';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const waitlistActive = $derived(data.waitlistActive);
  const loggedIn = $derived(Boolean(data.session));
  const plans = $derived(visiblePlans(!!data.planGo));
  const cta = $derived(waitlistActive ? $_('pricing.cta.waitlist') : $_('pricing.cta.getStarted'));
  const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let cycle = $state<'month' | 'year'>('year');
  // Default from geo (eurozone → EUR, else USD); URL ?currency= overrides for shareable links.
  let currency = $state<Currency>(
    untrack(() => {
      const q = $page.url.searchParams.get('currency');
      if (q === 'usd' || q === 'eur') return q;
      return currencyForCountry(data.country);
    })
  );

  // Il Free si racconta con la sua dotazione di crediti, non più con un "valore API" in euro.
  const freePillValues = $derived({ credits: FREE_CREDITS.toLocaleString($locale ?? 'en') });

  function faqAnswer(key: string): string {
    if (key === 'freePlan') {
      return $_('pricing.faq.freePlan.a', { values: freePillValues });
    }
    return $_('pricing.faq.' + key + '.a');
  }

  // FAQ rich result: feed the same questions/answers shown on the page to search engines.
  const faqJsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: ['freePlan', 'perBrand', 'changePlan', 'whatCounts', 'creditsLimits'].map((k) => ({
        '@type': 'Question',
        name: $_(`pricing.faq.${k}.q`),
        acceptedAnswer: { '@type': 'Answer', text: faqAnswer(k) }
      }))
    })
  );

  // Clicking a plan jumps straight into setup: logged-in users go to new-brand onboarding
  // with the plan pre-picked; everyone else signs in first, carrying the same intent so the
  // magic-link round-trip lands them back on onboarding (or the waitlist, if it's still gated).
  function ctaHref(planKey: string): string {
    const qs = `plan=${planKey}&cycle=${cycle}&currency=${currency}`;
    return loggedIn ? `/app/onboarding?${qs}` : `/login?next=onboarding&mode=signup&${qs}`;
  }

  const FAQ_KEYS = ['freePlan', 'perBrand', 'changePlan', 'whatCounts', 'creditsLimits'];
  const FAQ = $derived(
    FAQ_KEYS.map((key) => ({
      key,
      q: $_('pricing.faq.' + key + '.q'),
      a: faqAnswer(key)
    }))
  );
</script>

<svelte:head>
  <title>{$_('meta.pricing.title')}</title>
  <meta name="description" content={$_('meta.pricing.description')} />
  <meta
    name="robots"
    content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  />
  <meta property="og:title" content={$_('meta.pricing.title')} />
  <meta property="og:description" content={$_('meta.pricing.description')} />
  <meta name="twitter:title" content={$_('meta.pricing.title')} />
  <meta name="twitter:description" content={$_('meta.pricing.description')} />
  {@html `<script type="application/ld+json">${faqJsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} current="pricing" />

<main id="top">
  <!-- ============ PRICING ============ -->
  <section class="price-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('pricing.hero.eyebrow')}</span>
      <h1>{$_('pricing.hero.title')}</h1>
      <p class="lede">
        {$_('pricing.hero.lede')}
      </p>

      <div class="free-pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
        {$_('pricing.freePill', { values: freePillValues })}
      </div>
      <p class="credits-docs-link">
        <a href={lp('/docs/credits')}>{$_('pricing.creditsDocsLink')}</a>
      </p>

      <div class="price-toggles">
        <div class="bill-toggle" role="group" aria-label={$_('pricing.toggle.cycleAria')}>
          <button type="button" class:on={cycle === 'month'} onclick={() => (cycle = 'month')}>{$_('pricing.toggle.monthly')}</button>
          <button type="button" class:on={cycle === 'year'} onclick={() => (cycle = 'year')}>{$_('pricing.toggle.annual')} <span class="save">{$_('pricing.toggle.save')}</span></button>
        </div>
        <div class="bill-toggle" role="group" aria-label={$_('pricing.toggle.currencyAria')}>
          <button type="button" class:on={currency === 'usd'} onclick={() => (currency = 'usd')}>USD</button>
          <button type="button" class:on={currency === 'eur'} onclick={() => (currency = 'eur')}>EUR</button>
        </div>
      </div>

      <PlanCards {cycle} {currency} {plans} showCustom>
        {#snippet cta(p)}
          <a class="pcta {p.popular ? 'is-primary' : 'is-ghost'}" href={ctaHref(p.key)}>
            {waitlistActive ? $_('pricing.card.ctaWaitlist') : $_('pricing.card.ctaTrial')}
          </a>
        {/snippet}
        {#snippet customCta()}
          <a class="pcta is-ghost" href={BOOKING_URL} target="_blank" rel="noopener">
            {$_('pricing.card.customCta')}
          </a>
        {/snippet}
      </PlanCards>

      <p class="perbrand-note">
        {$_('pricing.note.pre')}
        <b>{$_('pricing.note.stripe')}</b>.
      </p>
    </div>
  </section>

  <!-- ============ FAQ ============ -->
  <section class="alt faq-sec">
    <div class="wrap">
      <div class="sec-head">
        <div class="kicker">{$_('pricing.faq.kicker')}</div>
        <h2>{$_('pricing.faq.title')}</h2>
      </div>
      <div class="faq">
        {#each FAQ as item (item.key)}
          <details class="faq-item">
            <summary>{item.q}<span class="chev" aria-hidden="true">+</span></summary>
            <p>{item.a}</p>
            {#if item.key === 'creditsLimits'}
              <p><a href={lp('/docs/credits')}>{$_('pricing.faq.creditsLimits.link')}</a></p>
            {/if}
          </details>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ ASK AI ============ -->
  <AskAiCta />

</main>

<!-- ============ FOOTER ============ -->
<SiteFooter />

<style>
  .price-hero {
    padding: 116px 0 72px;
    text-align: center;
  }
  .price-hero .eyebrow {
    display: inline-block;
    margin-bottom: 18px;
  }
  .price-hero h1 {
    font-size: clamp(2.1rem, 5vw, 3.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.05;
    /* Override landing.css's global `h1 { max-width: 17ch }`, which would otherwise
       shrink-wrap the heading and pin it left so text-align:center can't centre it. */
    max-width: 22ch;
    margin: 0 auto;
  }
  @media (min-width: 821px) {
    .price-hero h1 { font-size: clamp(56px, 5vw, 64px); }
  }
  .price-hero .lede {
    max-width: 52ch;
    margin: 18px auto 30px;
    color: var(--ink-soft);
    font-size: 1.08rem;
    line-height: 1.55;
  }
  .price-hero .price-toggles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0 auto 28px;
  }
  .price-hero .bill-toggle {
    margin: 0;
  }
  .price-hero :global(.price-plans) {
    text-align: left;
  }

  .free-pill {
    display: flex;
    width: fit-content;
    max-width: min(100%, 48ch);
    align-items: center;
    gap: 7px;
    margin: 0 auto 18px;
    padding: 7px 16px;
    border-radius: 980px;
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    text-align: left;
  }
  .free-pill svg {
    width: 14px;
    height: 14px;
  }
  .credits-docs-link {
    margin: -6px auto 22px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .credits-docs-link a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  .credits-docs-link a:hover {
    text-decoration: underline;
  }

  /* ---- FAQ ---- */
  .faq-sec .sec-head {
    text-align: center;
    margin-bottom: 36px;
  }
  .faq {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .faq-item {
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    padding: 4px 20px;
    transition: border-color 0.2s var(--ease);
  }
  .faq-item[open] {
    border-color: rgba(var(--accent-rgb), 0.35);
  }
  .faq-item summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    list-style: none;
    padding: 16px 0;
    font-weight: 600;
    font-size: 1.02rem;
  }
  .faq-item summary::-webkit-details-marker {
    display: none;
  }
  .faq-item .chev {
    flex: 0 0 auto;
    font-size: 22px;
    font-weight: 400;
    color: var(--accent);
    transition: transform 0.25s var(--ease);
    line-height: 1;
  }
  .faq-item[open] .chev {
    transform: rotate(45deg);
  }
  .faq-item p {
    margin: 0 0 18px;
    color: var(--ink-soft);
    line-height: 1.55;
    max-width: 60ch;
  }
</style>
