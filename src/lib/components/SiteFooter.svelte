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
  <div class="wrap foot-cta">
    <div class="foot-cta-inner">
      <h2 class="foot-cta-heading">{footCtaHeading}</h2>
      {#if ctaExternal}
        <a
          href={ctaHref}
          class="foot-cta-btn"
          target="_blank"
          rel="noopener"
        >{footCtaLabel}</a>
      {:else}
        <HeroUrlCta tone="dark" {loggedIn} {waitlistActive} />
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
  <div class="foot-brand-big" aria-hidden="true">
    <BrandMark size="clamp(4.5rem, 14vw, 12rem)" tone="negative" />
    <span>anomalia</span>
  </div>
</footer>

<style>
  footer {
    background: #111;
    border-top: 1px solid rgba(255,255,255,0.08);
    padding: 0 0 64px;
    color: rgba(255,255,255,0.45);
    font-size: 13px;
  }

  /* CTA section */
  .foot-cta {
    padding: 104px 0 96px;
  }
  .foot-cta-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 24px;
  }
  .foot-cta-heading {
    font-size: clamp(1.1rem, 2.2vw, 1.5rem);
    font-weight: 500;
    color: rgba(255,255,255,0.85);
    margin: 0;
    letter-spacing: -0.01em;
    line-height: 1.35;
    max-width: 680px;
  }
  .foot-cta-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    color: #111;
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
    background: rgba(255,255,255,0.88);
    transform: translateY(-1px);
  }

  .foot-grid {
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
    color: #fff;
  }
  .foot-logo-text {
    font-size: 20px;
    font-weight: 500;
    color: #fff;
    letter-spacing: -0.02em;
  }
  .foot-desc {
    color: rgba(255,255,255,0.45);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    max-width: 32ch;
  }
  .foot-eu {
    color: rgba(255,255,255,0.55);
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
    color: rgba(255,255,255,0.55);
    background: rgba(255,255,255,0.06);
    transition: color 0.15s, background 0.15s;
  }
  .foot-social-link:hover {
    color: #fff;
    background: rgba(255,255,255,0.12);
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
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255,255,255,0.7);
    margin-bottom: 4px;
  }
  .foot-col a, .foot-col .foot-link-btn {
    color: rgba(255,255,255,0.45);
    text-decoration: none;
    font-size: 14px;
    transition: color 0.15s;
  }
  .foot-col a:hover, .foot-col .foot-link-btn:hover {
    color: #fff;
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
    font-weight: 600;
  }
  .status-pill.ok { color: #10b981 !important; }
  .status-pill.degraded { color: #f59e0b !important; }
  .status-pill.critical { color: #ef4444 !important; }
  .status-pill.loading { color: #6b7280 !important; }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.ok { background: #10b981; }
  .status-dot.degraded { background: #f59e0b; }
  .status-dot.critical { background: #ef4444; }
  .status-dot.loading { background: #6b7280; }

  .foot-brand-big {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.1em;
    font-size: clamp(3rem, 10vw, 8rem);
    font-weight: 500;
    color: rgba(255,255,255,0.04);
    letter-spacing: -0.04em;
    line-height: 1;
    padding: 88px 0 24px;
    overflow: hidden;
    user-select: none;
    max-width: none;
    width: 100%;
  }
  .foot-brand-big span {
    padding-bottom: 8px;
  }

  .foot-brand-big :global(svg),
  .foot-brand-big :global(svg *) {
    color: rgba(255,255,255,0.04) !important;
    fill: rgba(255,255,255,0.04) !important;
    stroke: rgba(255,255,255,0.04) !important;
    height: 0.85em;
    width: auto;
  }

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
    .foot-cta {
      padding-left: 16px;
      padding-right: 16px;
    }
    .foot-columns {
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
  }
</style>
