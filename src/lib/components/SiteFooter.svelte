<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import { openCookieSettings } from '$lib/consent';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { siDiscord, siGithub } from 'simple-icons';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import HeroUrlCta from '$lib/components/HeroUrlCta.svelte';

  let {
    ctaHref = '/app',
    ctaLabel,
    ctaHeading,
    ctaExternal = false
  }: {
    ctaHref?: string;
    ctaLabel?: string;
    ctaHeading?: string;
    ctaExternal?: boolean;
  } = $props();

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const footCtaLabel = $derived(ctaLabel ?? $_('marketing.footer.ctaButton'));
  const footCtaHeading = $derived(ctaHeading ?? $_('marketing.footer.ctaHeading'));
  const loggedIn = $derived(!!$page.data.session);
  const waitlistActive = $derived(!!$page.data.waitlistActive);

  let statusState = $state<'ok' | 'degraded' | 'critical' | 'loading'>('loading');

  onMount(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => { statusState = d.status ?? 'critical'; })
      .catch(() => { statusState = 'critical'; });
  });
</script>

<footer>
  <div class="foot-cta">
    <div class="wrap foot-cta-inner">
      <h2 class="foot-cta-heading">{footCtaHeading}</h2>
      {#if ctaExternal}
        <a
          href={ctaHref}
          class="foot-cta-btn"
          target="_blank"
          rel="noopener"
        >{footCtaLabel}</a>
      {:else}
        <HeroUrlCta {loggedIn} {waitlistActive} />
      {/if}
    </div>
  </div>
  <div class="wrap foot-grid">
    <!-- Left: brand + description -->
    <div class="foot-brand">
      <div class="foot-logo" role="img" aria-label={$_('landing.nav.brandAria')}>
        <BrandMark size={36} tone="negative" />
        <span class="foot-logo-text" aria-hidden="true">Anomalia</span>
      </div>
      <p class="foot-desc">{$_('marketing.footer.tagline')}</p>
      <p class="foot-eu">{$_('marketing.footer.euHosting')}</p>
      <div class="foot-social">
        <a
          class="foot-social-link"
          href="https://discord.gg/PUp37DG6vr"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={siDiscord.path} />
          </svg>
        </a>
        <a
          class="foot-social-link"
          href="https://github.com/anomaliaso/anomalia"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={siGithub.path} />
          </svg>
        </a>
      </div>
      <a class="foot-gdpr" href={lp('/privacy')} title="GDPR">
        <img
          src="/badges/gdpr-compliant.webp"
          alt="GDPR compliant"
          width="120"
          height="48"
          loading="lazy"
          decoding="async"
        />
      </a>
    </div>

    <!-- Right: link columns -->
    <div class="foot-columns">
      <div class="foot-col">
        <div class="foot-col-title">{$_('marketing.footer.product')}</div>
        <a href={lp('/usecases')}>{$_('marketing.footer.useCases')}</a>
        <a href={lp('/autoposts')}>Autoposts</a>
        <a href={lp('/autoblog')}>Autoblog</a>
        <a href={lp('/ai-seo-agent')}>AI SEO Agent</a>
        <a href={lp('/leads-finder')}>Leads Finder</a>
        <a href={lp('/news-radar')}>News Radar</a>
        <a href={lp('/pricing')}>{$_('marketing.footer.pricing')}</a>
      </div>
      <div class="foot-col">
        <div class="foot-col-title">{$_('marketing.footer.developers')}</div>
        <a href={lp('/docs')}>Docs</a>
        <a href={lp('/docs/mcp')}>MCP</a>
        <a href={lp('/docs/cli')}>CLI</a>
        <a href={lp('/docs/api')}>API</a>
        <a href={lp('/agents')}>{$_('landing.nav.agentLibrary')}</a>
      </div>
      <div class="foot-col">
        <div class="foot-col-title">{$_('marketing.footer.company')}</div>
        <a href={lp('/faq')}>{$_('marketing.footer.faq')}</a>
        <a href={lp('/changelog')}>{$_('marketing.footer.changelog')}</a>
        <a href={lp('/privacy')}>{$_('marketing.footer.privacy')}</a>
        <a href={lp('/terms')}>{$_('marketing.footer.terms')}</a>
        <button type="button" class="foot-link-btn" onclick={() => openCookieSettings()}>{$_('marketing.footer.cookies')}</button>
      </div>
      <div class="foot-col">
        <div class="foot-col-title">{$_('marketing.footer.resources')}</div>
        <a href="https://blog.anomalia.so">Blog</a>
        <a href={lp('/tools')}>{$_('marketing.footer.freeTools')}</a>
        <a href="/llms.txt" target="_blank">{$_('marketing.footer.llm')}</a>
        <a href="/status" class="status-pill {statusState}">
          <span class="status-dot {statusState}"></span>
          <span>Status</span>
        </a>
      </div>
    </div>
  </div>
</footer>

<style>
  /* Il piede vero prende l'accento; la fascia della CTA sopra resta sulla carta della pagina, cosi'
     l'invito finale non si stacca dal contenuto e il colore arriva solo quando la lettura e' finita. */
  footer {
    background: var(--accent-2);
    padding: 0 0 64px;
    color: rgba(0, 0, 0, 0.70);
    font-size: 13px;
  }

  /* CTA section */
  .foot-cta {
    padding: 104px 0 96px;
    background: var(--paper);
    color: var(--ink);
  }
  .foot-cta-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 24px;
  }
  .foot-cta-heading {
    font-size: clamp(1.9rem, 4.4vw, 3.2rem);
    font-weight: var(--heading-weight);
    color: var(--ink);
    margin: 0;
    letter-spacing: var(--heading-tracking);
    line-height: 1.08;
    max-width: 16ch;
  }
  .foot-cta-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--ink);
    color: var(--paper);
    font-size: 15px;
    font-weight: 600;
    padding: 12px 28px;
    border-radius: 999px;
    text-decoration: none;
    transition: background 0.15s, transform 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .foot-cta-btn:hover {
    opacity: 0.88;
    transform: translateY(-1px);
  }

  .foot-grid {
    padding-top: 96px;
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 48px;
    align-items: start;
  }

  /* Left: brand */
  .foot-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    color: #000;
  }
  .foot-logo-text {
    font-size: 20px;
    font-weight: 500;
    color: #000;
    letter-spacing: -0.02em;
  }
  .foot-desc {
    color: rgba(0,0,0,0.70);
    font-weight: 500;
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    max-width: 32ch;
  }
  .foot-eu {
    color: rgba(0,0,0,0.70);
    font-weight: 500;
    font-size: 13px;
    line-height: 1.45;
    margin: 12px 0 0;
    max-width: 36ch;
  }
  .foot-social {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .foot-social-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: rgba(0,0,0,0.70);
    background: rgba(0,0,0,0.07);
    transition: color 0.15s, background 0.15s;
  }
  .foot-social-link:hover {
    color: #000;
    background: rgba(0,0,0,0.14);
  }
  .foot-social-link svg {
    width: 18px;
    height: 18px;
    display: block;
  }
  .foot-gdpr {
    display: inline-flex;
    margin-top: 14px;
    line-height: 0;
    opacity: 0.85;
    transition: opacity 0.15s;
  }
  .foot-gdpr:hover {
    opacity: 1;
  }
  .foot-gdpr img {
    height: 48px;
    width: auto;
    display: block;
  }

  /* Right: columns */
  .foot-columns {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 24px;
  }
  .foot-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .foot-col-title {
    font-size: 12px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #000;
    margin-bottom: 4px;
  }
  .foot-col a, .foot-col .foot-link-btn {
    color: rgba(0,0,0,0.70);
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;
    transition: color 0.15s;
  }
  .foot-col a:hover, .foot-col .foot-link-btn:hover {
    color: #000;
  }
  .foot-link-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  /* Status */
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    font-weight: 650;
  }
  .status-pill.ok,
  .status-pill.degraded,
  .status-pill.critical,
  .status-pill.loading { color: #000 !important; }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.ok { background: #046c4e; }
  .status-dot.degraded { background: #92400e; }
  .status-dot.critical { background: #991b1b; }
  .status-dot.loading { background: #3f3f46; }

  @media (max-width: 1100px) {
    .foot-columns {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .foot-grid {
      grid-template-columns: 1fr;
      gap: 32px;
    }
    .foot-columns {
      grid-template-columns: repeat(2, 1fr);
      gap: 24px;
    }
  }

  @media (max-width: 480px) {
    .foot-columns {
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
  }
</style>
