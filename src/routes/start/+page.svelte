<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { PLATFORM_META, PLATFORM_KEYS } from '$lib/components/platform-meta';
  import {
    saveGuestOnboarding,
    loadGuestOnboarding,
    guestOnboardingLoginHref,
    type GuestOnboardingPending
  } from '$lib/guest-onboarding';
  import { sanitizeWebsiteParam } from '$lib/website-param';
  import { track } from '$lib/analytics';

  let { data } = $props();

  type Phase = 'input' | 'socials';
  let phase = $state<Phase>('input');

  let url = $state('');
  let noWebsite = $state(false);
  let brandName = $state('');
  let creatorNiche = $state('');
  let selectedPlatforms = $state<string[]>([]);
  let handles = $state<Record<string, string>>({});

  const LINKEDIN_PATH =
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z';
  const PLACEHOLDERS: Record<string, string> = {
    facebook: 'facebook.com/yourpage',
    linkedin: 'linkedin.com/company/yourcompany',
    bluesky: 'bsky.app/profile/username',
    reddit: 'u/username'
  };

  const TIMELINE_STEPS = ['onboarding.timeline.website', 'onboarding.timeline.socials'];
  const progressStep = $derived(phase === 'input' ? 1 : 2);

  const pmeta = (k: string | undefined | null) => PLATFORM_META[(k ?? '').toLowerCase()] ?? null;
  const plabel = (k: string | undefined | null) => pmeta(k)?.label ?? k ?? '';
  const picon = (k: string | undefined | null) => {
    const m = pmeta(k);
    if (m?.icon) return m.icon;
    return (k ?? '').toLowerCase() === 'linkedin' ? { path: LINKEDIN_PATH, hex: '0a66c2' } : null;
  };

  function togglePlatform(k: string) {
    selectedPlatforms = selectedPlatforms.includes(k)
      ? selectedPlatforms.filter((x) => x !== k)
      : [...selectedPlatforms, k];
  }

  function useNoWebsite() {
    noWebsite = true;
    url = '';
  }

  function continueFromInput() {
    if (noWebsite) {
      if (!brandName.trim()) return;
    } else {
      const clean = sanitizeWebsiteParam(url);
      if (!clean) return;
      url = clean;
    }
    phase = 'socials';
    saveGuestOnboarding(snapshot(false));
    track('onboarding_guest_socials', { no_website: noWebsite });
  }

  function snapshot(readyForAnalysis: boolean): GuestOnboardingPending {
    return {
      v: 1,
      url: noWebsite ? '' : sanitizeWebsiteParam(url),
      noWebsite,
      brandName: brandName.trim(),
      creatorNiche: creatorNiche.trim(),
      selectedPlatforms: [...selectedPlatforms],
      handles: { ...handles },
      readyForAnalysis
    };
  }

  function continueFromSocials() {
    if (!selectedPlatforms.length) return;
    const pending = snapshot(true);
    saveGuestOnboarding(pending);
    track('onboarding_guest_login', {
      platforms: selectedPlatforms.length,
      no_website: noWebsite
    });
    void goto(guestOnboardingLoginHref(pending));
  }

  function back() {
    if (phase === 'socials') phase = 'input';
  }

  onMount(() => {
    // Resume a half-finished guest funnel in this tab.
    const existing = loadGuestOnboarding();
    if (existing && !existing.readyForAnalysis) {
      url = existing.url;
      noWebsite = existing.noWebsite;
      brandName = existing.brandName;
      creatorNiche = existing.creatorNiche;
      selectedPlatforms = existing.selectedPlatforms;
      handles = existing.handles;
      phase = existing.url || existing.noWebsite ? 'socials' : 'input';
      track('onboarding_guest_resumed', { step: phase });
      return;
    }

    if (data.website) {
      url = data.website;
      noWebsite = false;
      phase = 'socials';
      track('onboarding_started', { source: 'homepage_url', step: 'socials', guest: true });
    } else {
      track('onboarding_started', { guest: true });
    }
  });
</script>

<svelte:head><title>{$_('meta.onboarding.title')}</title></svelte:head>

<div class="ob-shell">
  <aside class="ob-sidebar">
    <a class="ob-logo" href="/" aria-label="Anomalia"><BrandMark size={40} /></a>
    <ol class="ob-timeline">
      {#each TIMELINE_STEPS as label, i (label)}
        {@const n = i + 1}
        <li class:done={n < progressStep} class:active={n === progressStep}>
          <span class="ot-dot">{#if n < progressStep}✓{/if}</span>
          <span class="ot-label">{$_(label)}</span>
        </li>
      {/each}
    </ol>
  </aside>

  <nav class="ob-navbar">
    <a class="ob-logo" href="/" aria-label="Anomalia"><BrandMark size={32} /></a>
  </nav>

  <div class="ob-main">
    <main class="wrap">
      {#if phase === 'socials'}
        <div class="ob-topnav">
          <button type="button" class="back asbtn" onclick={back}>{$_('onboarding.back')}</button>
        </div>
      {/if}

      {#key phase}
        <div class="ch-stage">
          <div class="ch-head">
            <div class="progress-bar-container">
              {#each [1, 2] as step (step)}
                <div
                  class="progress-box"
                  class:completed={step < progressStep}
                  class:active={step === progressStep}
                ></div>
              {/each}
            </div>
            {#if phase === 'input'}
              <h1 class="ch-title">{$_('onboarding.input.title')}</h1>
              <p class="ch-lead">{$_('onboarding.input.sub')}</p>
            {:else}
              <h1 class="ch-title">{$_('onboarding.socials.title')}</h1>
              <p class="ch-lead">{$_('onboarding.socials.sub')}</p>
            {/if}
          </div>

          {#if phase === 'input'}
            {#if noWebsite}
              <div class="block">
                <div class="lbl">{$_('onboarding.brand.nameLabel')}</div>
                <input bind:value={brandName} placeholder="Latina Coffee Co." />
              </div>
              <div class="block">
                <div class="lbl">{$_('onboarding.brand.nicheLabel')}</div>
                <input
                  type="text"
                  bind:value={creatorNiche}
                  placeholder={$_('onboarding.brand.nichePlaceholder')}
                />
                <p class="hint">{$_('onboarding.brand.nicheHint')}</p>
              </div>
              <div class="cta-row">
                <button type="button" class="ghost" onclick={() => (noWebsite = false)}
                  >{$_('onboarding.brand.haveWebsiteHint')}</button
                >
                <button
                  class="primary cta-press"
                  onclick={continueFromInput}
                  disabled={!brandName.trim()}>{$_('onboarding.continue')}</button
                >
              </div>
            {:else}
              <div class="row">
                <input
                  bind:value={url}
                  type="url"
                  placeholder="https://yourbrand.com"
                  onkeydown={(e) => e.key === 'Enter' && continueFromInput()}
                />
                <button
                  class="primary cta-press"
                  onclick={continueFromInput}
                  disabled={!sanitizeWebsiteParam(url)}>{$_('onboarding.continue')}</button
                >
              </div>
              <div class="block">
                <div class="lbl"
                  >{$_('onboarding.brand.nameLabel')} <small>{$_('onboarding.optional')}</small></div
                >
                <input bind:value={brandName} placeholder="Latina Coffee Co." />
                <p class="hint">{$_('onboarding.brand.sub')}</p>
              </div>
              <div class="alt nosite">
                <button type="button" class="nosite-btn" onclick={useNoWebsite}
                  >{$_('onboarding.input.manual')}</button
                >
                <p class="nosite-hint">{$_('onboarding.input.manualHint')}</p>
              </div>
            {/if}
          {:else}
            <div class="block">
              <div class="lbl">{$_('onboarding.socials.postLabel')}</div>
              <p class="hint">{$_('onboarding.socials.postHint')}</p>
              <div class="social-grid">
                {#each PLATFORM_KEYS as k (k)}
                  {@const ic = picon(k)}
                  <button
                    type="button"
                    class="scard"
                    class:sel={selectedPlatforms.includes(k)}
                    onclick={() => togglePlatform(k)}
                  >
                    <span class="sglyph" style={`background:${pmeta(k)?.bg}`}>
                      {#if ic}<svg viewBox="0 0 24 24" fill="#fff"
                          ><path d={ic.path} /></svg
                        >{:else}{pmeta(k)?.short}{/if}
                    </span>
                    <span class="sname">{plabel(k)}</span>
                    {#if selectedPlatforms.includes(k)}<span class="scheck">✓</span>{/if}
                  </button>
                {/each}
              </div>
              {#if !selectedPlatforms.length}<p class="hint start-hint"
                  >{$_('onboarding.socials.selectToStart')}</p
                >{/if}
            </div>

            <div class="block">
              <div class="lbl">{$_('onboarding.socials.learnLabel')}</div>
              <p class="hint">{$_('onboarding.socials.learnHint')}</p>
              <div class="social-input-list">
                {#each PLATFORM_KEYS as k (k)}
                  {@const ic = picon(k)}
                  <div class="social-input-row">
                    <span class="sglyph" style={`background:${pmeta(k)?.bg}`}>
                      {#if ic}<svg viewBox="0 0 24 24" fill="#fff"
                          ><path d={ic.path} /></svg
                        >{:else}{pmeta(k)?.short}{/if}
                    </span>
                    <span class="sname">{plabel(k)}</span>
                    <input
                      type="text"
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck="false"
                      placeholder={PLACEHOLDERS[k] ??
                        $_('onboarding.socials.usernamePlaceholder', {
                          values: { platform: plabel(k) }
                        })}
                      value={handles[k] ?? ''}
                      oninput={(e) => (handles = { ...handles, [k]: e.currentTarget.value })}
                    />
                  </div>
                {/each}
              </div>
            </div>

            <div class="cta-row cta-row-setup">
              <button
                class="primary cta-press"
                onclick={continueFromSocials}
                disabled={!selectedPlatforms.length}
              >
                {$_('onboarding.continue')}
              </button>
            </div>
          {/if}
        </div>
      {/key}
    </main>
  </div>
</div>

<style>
  .ob-shell {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--paper, #fff);
  }
  @media (min-width: 861px) {
    .ob-shell {
      flex-direction: row;
    }
  }

  .ob-logo {
    display: inline-flex;
    cursor: pointer;
    transition:
      opacity 0.15s,
      transform 0.15s;
  }
  .ob-logo:hover {
    opacity: 0.8;
  }
  .ob-logo:active {
    transform: scale(0.94);
  }
  .ob-logo :global(.brandmark path) {
    fill: var(--ink, #1d1d1f);
  }

  .ob-sidebar {
    display: none;
  }
  @media (min-width: 861px) {
    .ob-sidebar {
      display: flex;
      flex-direction: column;
      gap: 40px;
      flex: 0 0 240px;
      width: 240px;
      padding: 28px 24px;
      border-right: 1px solid var(--line, #e3e3e6);
      background: var(--paper-2, #f9f9f9);
    }
  }

  .ob-navbar {
    display: flex;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line, #e3e3e6);
  }
  @media (min-width: 861px) {
    .ob-navbar {
      display: none;
    }
  }

  .ob-timeline {
    display: flex;
    flex-direction: column;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  @media (min-width: 861px) {
    .progress-bar-container {
      display: none;
    }
  }
  .ob-timeline li {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding-bottom: 22px;
  }
  .ob-timeline li:last-child {
    padding-bottom: 0;
  }
  .ob-timeline li::before {
    content: '';
    position: absolute;
    left: 10px;
    top: 22px;
    bottom: 0;
    width: 2px;
    background: var(--line, #e3e3e6);
  }
  .ob-timeline li:last-child::before {
    display: none;
  }
  .ob-timeline li.done::before {
    background: var(--accent, #7c5cff);
  }
  .ot-dot {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    border-radius: 50%;
    border: 2px solid var(--line-2, #d2d2d7);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-faint, #86868b);
    background: var(--paper, #fff);
    z-index: 1;
  }
  .ob-timeline li.active .ot-dot {
    border-color: var(--accent, #7c5cff);
    color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.15);
  }
  .ob-timeline li.done .ot-dot {
    background: var(--accent, #7c5cff);
    color: #fff;
    border-color: var(--accent, #7c5cff);
  }
  .ot-label {
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.25;
    padding-top: 2px;
    color: var(--ink-faint, #86868b);
  }
  .ob-timeline li.active .ot-label,
  .ob-timeline li.done .ot-label {
    color: var(--ink, #1d1d1f);
  }

  .ob-main {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--paper, #fff);
  }
  .wrap {
    width: 100%;
    max-width: 820px;
    margin: 0;
    padding: 48px clamp(24px, 5vw, 64px) 96px;
  }

  .ob-topnav {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .back.asbtn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: 13.5px;
    color: var(--ink-soft, #6e6e73);
  }
  .back.asbtn:hover {
    color: var(--ink, #1d1d1f);
  }

  .ch-head {
    margin: 28px 0 8px;
  }
  .progress-bar-container {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 20px;
  }
  .progress-box {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--ink-faint, #86868b);
    transition: background 0.3s var(--ease, ease);
  }
  .progress-box.completed,
  .progress-box.active {
    background: var(--accent, #c485fe);
  }
  .progress-box.active {
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2);
  }
  .ch-title {
    font-size: clamp(1.9rem, 4.5vw, 2.5rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.1;
    margin: 10px 0 0;
  }
  .ch-lead {
    color: var(--ink-soft, #6e6e73);
    font-size: 1.02rem;
    line-height: 1.5;
    margin: 12px 0 0;
    max-width: 52ch;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .ch-head .ch-title {
    animation: rise 0.6s var(--ease, ease) 0.16s both;
  }
  .ch-head .ch-lead {
    animation: rise 0.6s var(--ease, ease) 0.32s both;
  }
  .ch-stage > :not(.ch-head) {
    animation: rise 0.55s var(--ease, ease) 0.48s both;
  }
  @media (prefers-reduced-motion: reduce) {
    .ch-stage > :not(.ch-head),
    .ch-head .ch-title,
    .ch-head .ch-lead {
      animation: none;
    }
  }

  input {
    flex: 1;
    font-size: 16px;
    padding: 13px 16px;
    border-radius: 12px;
    border: 1px solid var(--line-2, #d2d2d7);
    outline: none;
    width: 100%;
    height: 44px;
  }
  input:focus {
    border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12);
  }
  button {
    background: var(--ink, #1d1d1f);
    color: #fff;
    border: none;
    border-radius: 12px;
    padding: 0 20px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    border-radius: 980px;
    padding: 13px 22px;
    margin-top: 24px;
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .primary:hover {
    background: #6b4dff;
  }
  .ghost {
    background: var(--paper-2, #f1f1f3);
    color: var(--ink, #1d1d1f);
    border-radius: 980px;
    padding: 13px 22px;
  }
  .cta-press {
    transition: transform 0.12s var(--ease, ease);
  }
  .cta-press:active:not(:disabled) {
    transform: scale(0.97);
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 26px;
    align-items: center;
  }
  .row button {
    margin-top: 0;
    padding: 0 20px;
    height: 44px;
  }
  .alt.nosite {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 18px;
    border-top: 1px solid var(--line, #e3e3e6);
  }
  .nosite-btn {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--accent, #7c5cff);
    font-weight: 600;
    font-size: 14.5px;
    cursor: pointer;
    padding: 0;
  }
  .nosite-btn:hover {
    text-decoration: underline;
  }
  .nosite-hint {
    margin: 0;
    font-size: 13px;
    color: var(--ink-faint, #86868b);
  }

  .block {
    margin-top: 18px;
  }
  .block .lbl {
    font-size: 16px;
    font-weight: 650;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
  }
  .block small {
    color: var(--ink-faint, #86868b);
    font-weight: 400;
  }
  .hint {
    font-size: 13px;
    color: var(--ink-soft, #6e6e73);
    margin: 2px 0 8px;
    line-height: 1.4;
  }
  .start-hint {
    color: var(--ink-faint, #86868b);
  }

  .cta-row .primary,
  .cta-row .ghost {
    margin-top: 0;
  }
  .cta-row-setup {
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin: 24px calc(-1 * clamp(24px, 5vw, 64px)) 0;
    padding: 14px clamp(24px, 5vw, 64px) calc(14px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--paper, #fff) 92%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-top: 1px solid var(--line, #e3e3e6);
  }

  .scard {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 13px 14px;
    border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 14px;
    background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73);
    cursor: pointer;
    text-align: left;
  }
  .scard.sel {
    border-color: var(--accent, #7c5cff);
    background: rgba(var(--accent-rgb), 0.05);
    color: var(--ink, #1d1d1f);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
  }
  .sglyph {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: #fff;
    font-weight: 700;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  .sglyph svg {
    width: 18px;
    height: 18px;
  }
  .sname {
    font-size: 14px;
    font-weight: 600;
    flex: 1;
  }
  .scheck {
    color: var(--accent, #7c5cff);
    font-weight: 700;
  }
  .social-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    margin-top: 4px;
  }
  .social-input-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }
  .social-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
  }
  .social-input-row .sname {
    font-size: 14px;
    font-weight: 600;
    min-width: 80px;
    flex: 0 0 auto;
    color: var(--ink, #1d1d1f);
  }
  .social-input-row input {
    flex: 1;
    font-size: 14px;
    padding: 9px 12px;
    border-radius: 10px;
    height: 38px;
  }
</style>
