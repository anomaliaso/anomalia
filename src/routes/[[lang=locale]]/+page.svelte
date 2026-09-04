<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { siClaude } from 'simple-icons';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import AskAiCta from '$lib/components/AskAiCta.svelte';
  import WhyUs from '$lib/components/WhyUs.svelte';
  import HomePricing from '$lib/components/HomePricing.svelte';
  import LandingFaq from '$lib/components/LandingFaq.svelte';
  import { PLATFORM_KEYS, PLATFORM_META } from '$lib/components/platform-meta';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import LazyMarcoWidget from '$lib/components/LazyMarcoWidget.svelte';
  import HeroUrlCta from '$lib/components/HeroUrlCta.svelte';
  import ConnectClaudeDialog from '$lib/components/ConnectClaudeDialog.svelte';
  import { marketingStartHref } from '$lib/start-href';
  import '$lib/styles/landing.css';

  let { data } = $props();
  const waitlistActive = $derived(data.waitlistActive);
  const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
  const startHref = $derived(marketingStartHref({ loggedIn: Boolean(data.session), waitlistActive }));

  let claudeOpen = $state(false);

  // The channel strip reads the same table the publisher does, so it cannot promise a platform
  // the product can't post to.
  const channels = PLATFORM_KEYS.map((k) => PLATFORM_META[k].label);

  const JOBS = ['social', 'web', 'ads'];
  const BEFORE = ['i1', 'i2', 'i3', 'i4'];
  const AFTER = ['i1', 'i2', 'i3', 'i4', 'i5'];

  const siteUrl = $derived($page.url.origin);
  const jsonLd = $derived(
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${siteUrl}/#org`,
          name: 'Anomalia',
          url: `${siteUrl}/`,
          logo: `${siteUrl}/icon-512.png`
        },
        {
          '@type': 'WebSite',
          '@id': `${siteUrl}/#website`,
          name: 'Anomalia',
          url: `${siteUrl}/`,
          publisher: { '@id': `${siteUrl}/#org` },
          inLanguage: $locale ?? 'en'
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Anomalia',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${siteUrl}/`,
          description: $_('meta.landing.description'),
          publisher: { '@id': `${siteUrl}/#org` }
        }
      ]
    })
  );

</script>

<svelte:head>
  <title>{$_('meta.landing.title')}</title>
  <meta name="description" content={$_('meta.landing.description')} />
  <meta
    name="robots"
    content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  />
  <meta property="og:title" content={$_('meta.landing.title')} />
  <meta property="og:description" content={$_('meta.landing.description')} />
  <meta name="twitter:title" content={$_('meta.landing.title')} />
  <meta name="twitter:description" content={$_('meta.landing.description')} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">

  <!-- ============ HERO (centered, grow-style) ============ -->
  <section class="gr-hero">
    <div class="wrap gr-hero-inner">
      <!-- Hero is paint-critical: no .reveal, no opacity:0, no letter-stagger on first paint. -->
      <span class="eyebrow">{$_('landing.hero.eyebrow')}</span>
      <h1 class="gr-h1">
        {$_('landing.hero.titleLead')}
        <span class="gr-accent">{$_('landing.hero.titleEm')}</span>
      </h1>
      <p class="gr-sub">{$_('landing.hero.subhead')}</p>
      <div class="gr-actions">
        <HeroUrlCta loggedIn={!!data.session} {waitlistActive} />
      </div>
      <p class="gr-note">{$_('landing.hero.note')}</p>
      <button class="connect-claude" type="button" onclick={() => (claudeOpen = true)}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={siClaude.path} /></svg>
        {$_('landing.hero.connectClaude')}
      </button>
    </div>
  </section>

  <!-- ============ THE THREE JOBS AN AGENCY DOES ============ -->
  <section class="jobs-sec">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_('landing.jobs.kicker')}</div>
        <h2>{$_('landing.jobs.titleLead')} <span class="gr-accent">{$_('landing.jobs.titleAccent')}</span></h2>
      </div>
      <div class="jobs-cols">
        {#each JOBS as job, i (job)}
          <div class="job reveal" data-d={i + 1}>
            <h3>{$_(`landing.jobs.${job}.title`)}</h3>
            <p>{$_(`landing.jobs.${job}.body`)}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ BEFORE / AFTER ============ -->
  <section class="split-sec">
    <div class="wrap">
      <div class="sec-head reveal">
        <div class="kicker">{$_('landing.split.kicker')}</div>
        <h2>{$_('landing.split.titleLead')} <span class="gr-accent">{$_('landing.split.titleAccent')}</span></h2>
      </div>
      <div class="split-cols">
        <div class="split-col reveal" data-d="1">
          <h3>{$_('landing.split.before.title')}</h3>
          <p class="split-note">{$_('landing.split.before.note')}</p>
          <ul>
            {#each BEFORE as k (k)}
              <li>{$_(`landing.split.before.${k}`)}</li>
            {/each}
          </ul>
        </div>
        <div class="split-col is-ours reveal" data-d="2">
          <h3>{$_('landing.split.after.title')}</h3>
          <p class="split-note">{$_('landing.split.after.note')}</p>
          <ul>
            {#each AFTER as k (k)}
              <li>{$_(`landing.split.after.${k}`)}</li>
            {/each}
          </ul>
        </div>
      </div>
      <p class="split-punch reveal">{$_('landing.split.punch')}</p>
    </div>
  </section>

  <!-- ============ CHANNELS ============ -->
  <section class="channels-sec">
    <div class="wrap">
      <p class="channels-label">{$_('landing.channels.label')}</p>
      <ul class="channels-list">
        {#each channels as name (name)}
          <li>{name}</li>
        {/each}
      </ul>
      <p class="channels-note">{$_('landing.channels.note')}</p>
    </div>
  </section>

  <WhyUs />

  <HomePricing startHref={startHref} />

  <LandingFaq />

</main>

<ConnectClaudeDialog bind:open={claudeOpen} />

<section class="featured-on" aria-label="Featured on">
  <div class="wrap">
    <p class="featured-on-label">Featured on</p>
    <div class="featured-on-viewport">
      <div class="featured-on-track">
        {#snippet badgeRow(clone = false)}
          <div class="featured-on-badges" aria-hidden={clone ? 'true' : undefined}>
            <a
              class="bowora-badge"
              href="https://bowora.com/?via=nvjgatij"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <svg width="28" height="28" viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <g transform="translate(31.1875, 18.1874)" fill="#fff">
                  <path d="M87.5343464,15.4046144 C88.0800499,16.2992254 87.7980596,17.4698555 86.9050901,18.0165331 C86.0121207,18.5633415 84.8423829,18.2806539 84.2966794,17.3859122 C81.7117678,13.1474282 78.0968081,9.80172458 73.4648555,7.33755659 L73.4485366,7.32879615 C68.8772902,4.83909213 63.5398394,3.61244746 57.444409,3.61244746 L9.3017365,3.61244746 C7.67506992,3.61244746 6.3960609,3.83953898 5.49238625,4.41819874 L5.45674581,4.4405444 C4.79524344,4.84409996 4.32995935,5.45833757 4.0239476,6.27503287 C3.73947677,7.26368123 3.60644521,8.42777375 3.60644521,9.76432926 L3.60644521,103.544841 C3.60644521,104.950303 3.75631787,106.263062 4.0658545,107.495669 C4.27578065,108.239391 4.6709588,108.810258 5.28428782,109.184211 L5.31979771,109.20657 C6.22347236,109.785151 7.50248138,110.012269 9.12927851,110.012269 L59.1699028,110.012269 C63.7602097,110.012269 68.0783175,109.267239 72.1226597,107.769727 C76.1497692,106.173758 79.6895314,103.98404 82.7378993,101.19469 C83.5107618,100.487317 84.7118318,100.541579 85.4181132,101.315897 C86.1243946,102.090216 86.0708687,103.293142 85.2967007,104.000384 C81.9088999,107.100795 77.9767011,109.539466 73.4985376,111.311429 L73.4602862,111.326073 C68.9979194,112.981273 64.2351545,113.8126 59.1699028,113.8126 L9.12927851,113.8126 C6.62504751,113.8126 4.6896276,113.307371 3.2936448,112.419559 C1.8549718,111.536324 0.878319095,110.227096 0.397499432,108.466901 L0.387969203,108.430944 C0.00649891912,106.918395 -0.1875,105.289999 -0.1875,103.544841 L-0.1875,9.76432926 C-0.1875,7.97589194 0.0187707215,6.42738608 0.409379582,5.11588281 L0.444889478,5.00826015 C1.06187393,3.31376875 2.08082518,2.0552073 3.46675555,1.20522233 C4.8626078,0.317842042 6.79815825,-0.1874 9.3017365,-0.1874 L57.444409,-0.1874 C64.2296714,-0.1874 70.1626962,1.21570871 75.252361,3.98591679 C80.5093922,6.78394907 84.5995579,10.5933023 87.5343464,15.4046144 Z"></path>
                  <path d="M18.1870648,100.8126 C16.6872227,100.8126 15.520287,100.518396 14.687172,99.9299894 C13.9369898,99.4256779 13.4369118,98.6692106 13.1873299,97.6604566 C12.9372256,96.567738 12.8125,95.3909238 12.8125,94.130538 L12.8125,19.2423752 C12.8125,17.9815965 12.9372256,16.8888779 13.1873299,15.9647434 C13.5207588,14.9559894 14.0622378,14.1995221 14.8124201,13.6952106 C15.6459269,13.1068035 16.8124708,12.8126 18.3128353,12.8126 L53.1886048,12.8126 C57.8554332,12.8126 61.9387285,13.8632708 65.4386213,15.9647434 C69.0219693,18.066085 71.8139951,20.9235009 73.8135234,24.537515 C75.8135741,28.1519222 76.7720677,32.1020566 76.688482,36.3885735 C76.7720677,38.5740106 76.5218328,40.7170071 75.9382997,42.8183487 C75.3548972,44.9198213 74.4798587,46.8946265 73.3134454,48.7439434 C72.2298343,50.5090336 70.8552402,51.9800514 69.188096,53.1563416 C71.438251,54.5853115 73.3548465,56.4346284 74.9381438,58.7036372 C76.5213104,60.9731699 77.729386,63.4943345 78.5626316,66.2681788 C79.3971832,69.0416301 79.8125,71.9416177 79.8125,74.9670938 C79.7302203,78.5811079 79.0628402,81.9848831 77.8129717,85.1790743 C76.5631033,88.2891699 74.771364,91.0204424 72.4380151,93.3735468 C70.1045356,95.7271752 67.3963567,97.576361 64.3126949,98.9208424 C61.2291637,100.181752 57.9374518,100.8126 54.437559,100.8126 L18.186673,100.8126 L18.1870648,100.8126 Z" fill-rule="nonzero"></path>
                </g>
              </svg>
              <span class="bowora-badge-text">
                <span class="bowora-badge-name">Bowora</span>
              </span>
            </a>
            <a
              class="featured-badge"
              href="https://turbo0.com/item/anomalia"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/turbo0.svg" alt={clone ? '' : 'Listed on Turbo0'} width="160" height="40" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://findly.tools/anomalia?utm_source=anomalia"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/findly.svg" alt={clone ? '' : 'Featured on Findly.tools'} width="175" height="55" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://twelve.tools"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/twelve.svg" alt={clone ? '' : 'Featured on Twelve Tools'} width="200" height="54" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://wired.business"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/wired.svg" alt={clone ? '' : 'Featured on Wired Business'} width="200" height="54" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://dailypings.com/p/anomalia"
              target="_blank"
              rel="noopener noreferrer"
              title={clone ? undefined : 'Featured on DailyPings'}
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/dailypings.svg" alt={clone ? '' : 'Featured on DailyPings'} width="179" height="32" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://easydofollow.dev/marketing/anomalia"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/easydofollow.svg" alt={clone ? '' : 'Featured on EasyDoFollow'} width="188" height="56" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://neeed.directory"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img src="/badges/neeed.svg" alt={clone ? '' : 'Featured on neeed.directory'} width="139" height="40" loading="lazy" decoding="async" />
            </a>
            <a
              class="featured-badge"
              href="https://startupfa.me/s/anomalia.so-942?utm_source=anomalia.so"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img
                src="https://startupfa.me/badges/featured/dark.webp"
                alt={clone ? '' : 'Anomalia - Featured on Startup Fame'}
                width="171"
                height="54"
                loading="lazy"
                decoding="async"
              />
            </a>
            <a
              class="bowora-badge"
              href="https://www.aitoolzdir.com"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <span class="bowora-badge-text">
                <span class="bowora-badge-name">AI Toolz Dir</span>
              </span>
            </a>
            <a
              class="featured-badge"
              href="https://submitforbacklinks.com/badge/I7PJd-NG4DXU1gLwBElJlAcT?ref=badge"
              target="_blank"
              rel="noopener noreferrer"
              data-s4b-token="I7PJd-NG4DXU1gLwBElJlAcT"
              data-s4b-theme="dark"
              tabindex={clone ? -1 : undefined}
            >
              <img
                src="https://submitforbacklinks.com/api/badge/I7PJd-NG4DXU1gLwBElJlAcT.svg?variant=verified&theme=dark"
                alt={clone ? '' : 'Anomalia — Verified on SubmitForBacklinks'}
                width="220"
                height="48"
                loading="lazy"
                decoding="async"
              />
            </a>
            <a
              class="featured-badge"
              href="https://huzzler.so/products/8tXpDLSIRR/anomalia?utm_source=huzzler_product_website&utm_medium=badge&utm_campaign=free_listing"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img
                src="https://huzzler.so/assets/images/embeddable-badges/featured.png"
                alt={clone ? '' : 'Huzzler Embed Badge'}
                width="159"
                height="55"
                loading="lazy"
                decoding="async"
              />
            </a>
            <a
              class="featured-badge featured-badge-theme"
              href="https://www.directree.io"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img
                class="badge-light"
                src="https://www.directree.io/badge/directree-badge-black.svg"
                alt={clone ? '' : 'Verified on directree'}
                width="200"
                height="37"
                loading="lazy"
                decoding="async"
              />
              <img
                class="badge-dark"
                src="https://www.directree.io/badge/directree-badge-white.svg"
                alt=""
                width="200"
                height="37"
                loading="lazy"
                decoding="async"
              />
            </a>
            <a
              class="featured-badge"
              href="https://frogdr.com/anomalia.so?utm_source=anomalia.so"
              target="_blank"
              rel="noopener noreferrer"
              tabindex={clone ? -1 : undefined}
            >
              <img
                src="https://frogdr.com/anomalia.so/badge-white.svg"
                alt={clone ? '' : 'Monitor your Domain Rating with FrogDR'}
                width="250"
                height="54"
                loading="lazy"
                decoding="async"
              />
            </a>
          </div>
        {/snippet}
        {@render badgeRow(false)}
        {@render badgeRow(true)}
      </div>
    </div>
  </div>
</section>

<AskAiCta />

<SiteFooter />

<LazyMarcoWidget />

<style>

  /* ---------- HERO: centrato nella viewport ----------
     Sta QUI e non in landing.css perche' `.gr-hero` lo usano altre otto pagine (autoblog,
     leads-finder, grow...) che non hanno chiesto niente: lo scoped di Svelte alza la
     specificita' quanto basta per vincere sul foglio condiviso senza toccarlo.

     dvh e non vh: su iOS vh e' calcolato sulla viewport senza barra degli indirizzi, quindi
     il contenuto salterebbe mentre si scorre. min-height e non height: se la hero e' piu'
     alta della viewport (telefono stretto, titolo lungo) il blocco cresce e scorre come
     sempre — con align-items:center e un contenitore che si allarga non si taglia nulla.

     Padding SIMMETRICO di una barra di nav: la barra e' `position:fixed` (56px, landing.css)
     e sta sopra la hero, quindi in cima serve quel margine o il titolo ci finisce sotto.
     Metterlo solo in cima però sposterebbe il centro geometrico di 28px sotto la metà dello
     schermo — visibile. Simmetrico: il contenuto resta esattamente a metà viewport E non
     tocca mai la barra. */
  .gr-hero {
    /* La barra di nav e' alta 56px in landing.css (header.nav). Il giorno che quel numero
       cambia, va cambiato anche qui: non c'e' una variabile globale da riusare. */
    --nav-h: 56px;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    padding: var(--nav-h) 0;
  }
  /* In un flex row l'inner sarebbe shrink-to-fit e la hero si stringerebbe sul testo piu'
     largo: 100% e poi ci pensa il max-width di .wrap. */
  .gr-hero-inner { width: 100%; }

  /* ---------- THE THREE JOBS ----------
     Type only, no cards: this section has to read as one breath — the three things an agency
     is paid for — and a border around each one would make them look like three products. */
  .jobs-sec { padding-block: 100px 0; }
  .jobs-cols {
    display: flex; gap: 48px; align-items: flex-start;
    max-width: 940px; margin-inline: auto;
  }
  .job { flex: 1 1 0; min-width: 0; }
  .job h3 {
    font-size: 1.15rem; font-weight: 600; letter-spacing: -0.03em;
    margin: 0 0 10px;
  }
  .job p { margin: 0; font-size: 0.98rem; line-height: 1.55; color: var(--ink-soft); }

  @media (max-width: 760px) {
    .jobs-sec { padding-block: 64px 0; }
    .jobs-cols { flex-direction: column; gap: 30px; }
  }

  /* ---------- BEFORE / AFTER ----------
     What you pay an agency for, against what replaces it. Flex and not grid: app.css owns a
     global `.grid` (1.7fr 1fr) that hijacks anything carrying that class. 940px is the same
     cap as the three jobs above, so the page keeps one vertical spine. */
  .split-sec { padding-block: 100px 72px; }
  .split-cols {
    display: flex; gap: 24px; align-items: stretch;
    max-width: 940px; margin-inline: auto;
  }
  .split-col {
    flex: 1 1 0; min-width: 0;
    border: 1px solid var(--line); border-radius: 22px;
    padding: 30px 28px;
    background: var(--paper-2);
  }
  /* The right column is the product. It carries the weight so the eye lands there first. */
  .split-col.is-ours { background: var(--paper); border-color: rgba(var(--accent-rgb), 0.32); }
  .split-col h3 {
    font-size: 1.25rem; font-weight: 600; letter-spacing: -0.03em;
    margin: 0 0 4px;
  }
  .split-col.is-ours h3 { color: var(--accent); }
  .split-note { margin: 0 0 20px; font-size: 13px; color: var(--ink-faint); }
  .split-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .split-col li {
    font-size: 1rem; line-height: 1.45; color: var(--ink-soft);
    padding-left: 20px; position: relative;
  }
  .split-col li::before {
    content: ''; position: absolute; left: 0; top: 0.55em;
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--ink-faint);
  }
  .split-col.is-ours li { color: var(--ink); }
  .split-col.is-ours li::before { background: var(--accent); }
  .split-punch {
    max-width: 44ch; margin: 48px auto 0; text-align: center;
    font-size: 1.15rem; line-height: 1.5; color: var(--ink-soft);
    text-wrap: balance;
  }

  @media (max-width: 760px) {
    .split-sec { padding-block: 64px; }
    .split-cols { flex-direction: column; }
    .split-punch { margin-top: 32px; font-size: 1.05rem; }
  }

  /* ---------- CHANNELS ----------
     Names, not logos: the list is generated from PLATFORM_KEYS, so nine words cost nothing
     to ship and cannot drift away from what the publisher actually supports. */
  .channels-sec { padding-bottom: 40px; }
  .channels-sec .wrap {
    display: flex; flex-direction: column; align-items: center; gap: 16px;
    max-width: 720px; text-align: center;
  }
  .channels-label {
    margin: 0;
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-faint);
  }
  .channels-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-wrap: wrap; justify-content: center;
    gap: 8px 20px;
  }
  .channels-list li {
    font-size: 1rem; font-weight: 500; letter-spacing: -0.02em;
    color: var(--ink);
  }
  .channels-note { margin: 0; font-size: 13px; color: var(--ink-faint); }

  /* ---------- FEATURED ON ---------- */
  .featured-on {
    padding: 48px 0;
    overflow: hidden;
  }
  .featured-on .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 0 20px;
  }
  .featured-on-label {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .featured-on-viewport {
    width: 100%;
    overflow: hidden;
    mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  }
  .featured-on-track {
    display: flex;
    width: max-content;
    animation: featured-marquee 40s linear infinite;
  }
  .featured-on-viewport:hover .featured-on-track {
    animation-play-state: paused;
  }
  .featured-on-badges {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-inline: 8px;
    flex-shrink: 0;
  }
  @keyframes featured-marquee {
    from { transform: translateX(-50%); }
    to { transform: translateX(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .featured-on-track {
      animation: none;
      flex-wrap: wrap;
      justify-content: center;
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
      row-gap: 12px;
    }
    .featured-on-badges[aria-hidden='true'] {
      display: none;
    }
    .featured-on-viewport {
      mask-image: none;
      -webkit-mask-image: none;
    }
  }
  .bowora-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: auto;
    height: 40px;
    padding: 6px 12px;
    background: #000;
    color: #fff;
    border-radius: 8px;
    text-decoration: none;
    border: none;
    flex-shrink: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }
  .bowora-badge-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .bowora-badge-name {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
  }
  .featured-badge {
    display: inline-flex;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }
  .featured-badge img {
    height: 40px;
    width: auto;
    display: block;
  }
  .featured-badge-theme .badge-dark {
    display: none;
  }
  :global(:root[data-theme='dark']) .featured-badge-theme .badge-light {
    display: none;
  }
  :global(:root[data-theme='dark']) .featured-badge-theme .badge-dark {
    display: block;
  }
</style>
