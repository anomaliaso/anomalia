<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import { isPlanKey, planByKey } from '$lib/plans';
  import { detectInAppBrowser, androidIntentUrl, type InAppBrowser } from '$lib/in-app-browser';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { sanitizeWebsiteParam } from '$lib/website-param';
  let { form, data } = $props();
  const waitlistActive = $derived(data.waitlistActive);
  let loading = $state(false);
  let showPassword = $state(false);

  // Auth mode: sign-in (default), sign-up, or forgot-password.
  // Homepage/ads URL CTAs and pricing plan CTAs land on create-account (server sets preferSignup).
  type Mode = 'signin' | 'signup' | 'forgot';
  let mode = $state<Mode>(data.preferSignup ? 'signup' : 'signin');
  // When the user switches to forgot-password, don't yank them back to signup on URL sync.
  let modeLocked = $state(false);
  const formAction = $derived(mode === 'forgot' ? '?/reset' : mode === 'signup' ? '?/signup' : '?/login');

  // Keep signup when arriving via CTA params (also covers same-route search-param navigations
  // that reuse the page component without re-running $state initializers).
  $effect(() => {
    if (modeLocked || !data.preferSignup) return;
    mode = 'signup';
  });

  // In-app browsers (Instagram, Facebook, TikTok, LinkedIn, …) make Google/GitHub reject OAuth
  // with `disallowed_useragent`. We detect them on mount and, instead of submitting the OAuth
  // form in-place, bounce the user out to their real default browser — automatically on Android
  // via an intent:// URL, with copy-link + instructions as the fallback (notably on iOS, where
  // webviews can't be escaped programmatically).
  let inApp = $state<InAppBrowser | null>(null);
  let showOpenInBrowser = $state(false);
  let copied = $state(false);

  onMount(() => {
    const detected = detectInAppBrowser();
    if (detected.isInApp) {
      inApp = detected;
      // Inside in-app browsers OAuth is unavailable, so people sign up with email/password.
      // Lead with the create-account form instead of sign-in (unless they're mid forgot-password).
      if (mode === 'signin') mode = 'signup';
    }
  });

  function setMode(next: Mode) {
    mode = next;
    modeLocked = next === 'forgot' || next === 'signin';
  }

  // Intercepts an OAuth button inside an in-app browser. Returns true when handled (so the
  // caller cancels the normal form submit), false to let the form submit as usual.
  function handleOAuthInApp(e: Event): boolean {
    if (!inApp?.isInApp) return false;
    e.preventDefault();
    const target = window.location.href;
    if (inApp.os === 'android') {
      window.location.href = androidIntentUrl(target);
      // Keep the fallback ready in case no browser handles the intent.
      showOpenInBrowser = true;
    } else {
      showOpenInBrowser = true;
    }
    return true;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard can be blocked in some webviews; the visible URL is the fallback.
    }
  }

  // When arriving from a /pricing plan CTA or the homepage URL CTA we carry the intent
  // (+ plan/cycle/website) through the magic-link round-trip, so after sign-in the user
  // lands straight in new-brand onboarding.
  const startFlow = $derived($page.url.searchParams.get('next') === 'onboarding');
  const planParam = $derived($page.url.searchParams.get('plan') ?? '');
  const cycleParam = $derived($page.url.searchParams.get('cycle') ?? '');
  const websiteParam = $derived(sanitizeWebsiteParam($page.url.searchParams.get('website')));
  const chosenPlan = $derived(isPlanKey(planParam) ? planByKey(planParam) : null);

  // CLI login: opened by the Anomalia CLI. Show a consent notice and carry the port/state through.
  const cliPort = $derived(data.cliPort ?? '');
  const cliState = $derived(data.cliState ?? '');
</script>

<svelte:head>
  <title>
    {waitlistActive
      ? $_('meta.login.titleWaitlist')
      : mode === 'signup'
        ? $_('meta.login.titleSignup')
        : $_('meta.login.titleSignin')}
  </title>
</svelte:head>

<div class="split">
  <section class="pane form-pane">
    <div class="form-inner">
      <a class="brand" href="/">Anomalia</a>

      {#if cliPort}
        <div class="cli-notice">
          <span class="cli-icon" aria-hidden="true">⌘</span>
          <span>Anomalia CLI sta richiedendo accesso al tuo account</span>
        </div>
      {/if}

      {#if form?.reset}
        <h1>{$_('login.reset.sentTitle')}</h1>
        <p class="sub">{@html $_('login.reset.sentSub', { values: { email: '<b>' + (form.email ?? '') + '</b>' } })}</p>
        <p class="toggle"><a class="textlink" href="/login">{$_('login.forgot.back')}</a></p>
      {:else}
        {#if mode === 'forgot'}
          <h1>{$_('login.forgot.title')}</h1>
          <p class="sub">{$_('login.forgot.sub')}</p>
        {:else if mode === 'signup'}
          {#if startFlow && !waitlistActive}
            <h1>{chosenPlan ? $_('login.start.titlePlan', { values: { plan: chosenPlan.name } }) : $_('login.start.title')}</h1>
            <p class="sub">
              {chosenPlan ? $_('login.start.subPlan', { values: { plan: chosenPlan.name } }) : $_('login.start.sub')}
            </p>
          {:else if waitlistActive}
            <h1>{$_('login.signin.titleWaitlist')}</h1>
            <p class="sub">{$_('login.signin.subWaitlist')}</p>
          {:else}
            <h1>{$_('login.signup.title')}</h1>
            <p class="sub">{$_('login.signup.sub')}</p>
          {/if}
        {:else}
          <h1>{waitlistActive ? $_('login.signin.titleWaitlist') : $_('login.signin.title')}</h1>
          <p class="sub">{waitlistActive ? $_('login.signin.subWaitlist') : $_('login.signin.sub')}</p>
        {/if}
        {#if mode !== 'forgot'}
        <form method="POST" action="?/google" class="form oauth-form" onsubmit={handleOAuthInApp}>
          {#if cliPort}<input type="hidden" name="cli_port" value={cliPort} />{/if}
          {#if cliState}<input type="hidden" name="cli_state" value={cliState} />{/if}
          {#if startFlow}<input type="hidden" name="next" value="onboarding" />{/if}
          {#if planParam}<input type="hidden" name="plan" value={planParam} />{/if}
          {#if cycleParam}<input type="hidden" name="cycle" value={cycleParam} />{/if}
          {#if websiteParam}<input type="hidden" name="website" value={websiteParam} />{/if}
          <button type="submit" class="oauth" disabled={loading}>
            <svg class="gh" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            {$_('login.form.google')}
          </button>
        </form>

        <form method="POST" action="?/github" class="form oauth-form" onsubmit={handleOAuthInApp}>
          {#if cliPort}<input type="hidden" name="cli_port" value={cliPort} />{/if}
          {#if cliState}<input type="hidden" name="cli_state" value={cliState} />{/if}
          {#if startFlow}<input type="hidden" name="next" value="onboarding" />{/if}
          {#if planParam}<input type="hidden" name="plan" value={planParam} />{/if}
          {#if cycleParam}<input type="hidden" name="cycle" value={cycleParam} />{/if}
          {#if websiteParam}<input type="hidden" name="website" value={websiteParam} />{/if}
          <button type="submit" class="oauth" disabled={loading}>
            <svg class="gh" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
            {$_('login.form.github')}
          </button>
        </form>

        <div class="divider"><span>{$_('login.form.or')}</span></div>
        {/if}

        <form
          method="POST"
          action={formAction}
          class="form email-form"
          use:enhance={() => {
            loading = true;
            return async ({ update }) => {
              await update();
              loading = false;
            };
          }}
        >
          {#if cliPort}<input type="hidden" name="cli_port" value={cliPort} />{/if}
          {#if cliState}<input type="hidden" name="cli_state" value={cliState} />{/if}
          {#if startFlow}<input type="hidden" name="next" value="onboarding" />{/if}
          {#if planParam}<input type="hidden" name="plan" value={planParam} />{/if}
          {#if cycleParam}<input type="hidden" name="cycle" value={cycleParam} />{/if}
          {#if websiteParam}<input type="hidden" name="website" value={websiteParam} />{/if}
          {#if mode === 'forgot'}<input type="hidden" name="locale" value={$locale ?? ''} />{/if}
          <input
            type="email"
            name="email"
            placeholder={$_('login.form.emailPlaceholder')}
            autocomplete="email"
            value={form?.email ?? ''}
            disabled={loading}
            required
          />
          {#if mode !== 'forgot'}
            <div class="pwfield">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                placeholder={$_('login.form.passwordPlaceholder')}
                autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minlength={mode === 'signup' ? 6 : undefined}
                disabled={loading}
                required
              />
              <button type="button" class="reveal" onclick={() => (showPassword = !showPassword)} tabindex="-1">
                {showPassword ? $_('login.form.hide') : $_('login.form.show')}
              </button>
            </div>
          {/if}
          {#if mode === 'signin'}
            <div class="row">
              <button type="button" class="textlink" onclick={() => setMode('forgot')}>{$_('login.signin.forgot')}</button>
            </div>
          {/if}
          <button type="submit" class="cta" disabled={loading}>
            {#if loading}<span class="spinner" aria-hidden="true"></span>{$_('login.form.sending')}{:else}{mode === 'forgot' ? $_('login.form.sendReset') : mode === 'signup' ? $_('login.form.create') : $_('login.form.signin')}{/if}
          </button>
        </form>

        {#if form?.errorCode}<p class="err">{$_('login.error.' + form.errorCode)}</p>{:else if form?.error}<p class="err">{form.error}</p>{/if}

        <p class="toggle">
          {#if mode === 'signin'}
            {$_('login.signin.noAccount')}
            <button type="button" class="textlink" onclick={() => setMode('signup')}>{$_('login.signin.createLink')}</button>
          {:else if mode === 'signup'}
            {$_('login.signup.haveAccount')}
            <button type="button" class="textlink" onclick={() => setMode('signin')}>{$_('login.signup.signinLink')}</button>
          {:else}
            <button type="button" class="textlink" onclick={() => setMode(data.preferSignup ? 'signup' : 'signin')}>{$_('login.forgot.back')}</button>
          {/if}
        </p>
      {/if}
    </div>
  </section>

  <aside class="pane auth-showcase">
    <div class="auth-showcase-inner">
      <a class="sc-mark" href="/"><BrandMark size={20} /> Anomalia</a>
      <div class="chat-mock" aria-hidden="true">
        <div class="chat-row user">
          <div class="chat-bubble">{$_('login.showcase.userMessage')}</div>
        </div>
        <div class="chat-row ai">
          <div class="chat-avatar" aria-hidden="true"><BrandMark size={14} /></div>
          <div class="chat-bubble">
            <p class="chat-intro">{$_('login.showcase.aiIntro')}</p>
            <ul class="chat-services">
              <li>
                <strong>{$_('login.showcase.service1Title')}</strong>
                <span>{$_('login.showcase.service1Body')}</span>
              </li>
              <li>
                <strong>{$_('login.showcase.service2Title')}</strong>
                <span>{$_('login.showcase.service2Body')}</span>
              </li>
              <li>
                <strong>{$_('login.showcase.service3Title')}</strong>
                <span>{$_('login.showcase.service3Body')}</span>
              </li>
              <li>
                <strong>{$_('login.showcase.service4Title')}</strong>
                <span>{$_('login.showcase.service4Body')}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </aside>
</div>

{#if showOpenInBrowser && inApp}
  <div class="iab-overlay" role="dialog" aria-modal="true">
    <div class="iab-card">
      <h2>{$_('login.inapp.title')}</h2>
      <p>
        {inApp.app
          ? $_('login.inapp.subApp', { values: { app: inApp.app } })
          : $_('login.inapp.sub')}
      </p>

      {#if inApp.os === 'android'}
        <a class="iab-primary" href={androidIntentUrl($page.url.href)}>{$_('login.inapp.openButton')}</a>
      {:else if inApp.os === 'ios'}
        <p class="iab-hint">{$_('login.inapp.iosHint', { values: { menu: '•••' } })}</p>
      {/if}

      <div class="iab-link">{$page.url.href}</div>
      <button type="button" class="iab-copy" onclick={copyLink}>
        {copied ? $_('login.inapp.copied') : $_('login.inapp.copy')}
      </button>
      <button type="button" class="iab-dismiss" onclick={() => (showOpenInBrowser = false)}>
        {$_('login.inapp.dismiss')}
      </button>
    </div>
  </div>
{/if}

<style>
  .split {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .pane {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 40px;
  }

  /* ---- left: the form ---- */
  .form-pane {
    background: var(--paper, #fff);
  }
  .form-inner {
    width: 100%;
    max-width: 400px;
    text-align: left;
  }
  .brand {
    font-size: 22px;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink, #1d1d1f);
    display: inline-block;
    margin-bottom: 32px;
  }
  .brand .mid {
    color: var(--accent, #7c5cff);
  }
  h1 {
    font-size: clamp(1.8rem, 3vw, 2.3rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0;
  }
  .sub {
    color: var(--ink-soft, #6e6e73);
    margin: 12px 0 0;
    max-width: 40ch;
    line-height: 1.5;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 28px;
    width: 100%;
  }
  /* Social buttons lead; email form sits under the divider with tighter top spacing. */
  .oauth-form {
    margin-top: 28px;
  }
  .oauth-form + .oauth-form {
    margin-top: 8px;
  }
  .email-form {
    margin-top: 0;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    font-size: 16px;
    padding: 14px 18px;
    border-radius: 14px;
    border: 1px solid var(--line-2, #d2d2d7);
    outline: none;
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
  }
  input:focus {
    border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    border-radius: 14px;
    padding: 14px 22px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .cta {
    background: var(--ink, #1d1d1f);
    color: #fff;
  }
  button:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .oauth {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    border: 1px solid var(--line-2, #d2d2d7);
  }
  .oauth .gh {
    flex: 0 0 auto;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 18px 0;
    color: var(--ink-soft, #6e6e73);
    font-size: 13px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line-2, #d2d2d7);
  }
  input:disabled {
    opacity: 0.6;
  }
  .spinner {
    width: 15px;
    height: 15px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .err {
    color: #c0392b;
    font-size: 14px;
    margin-top: 14px;
  }

  /* password field with a reveal toggle (custom name to avoid the global .field rule) */
  .pwfield {
    position: relative;
  }
  .reveal {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: auto;
    background: transparent;
    border: none;
    color: var(--ink-soft, #6e6e73);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 8px;
    cursor: pointer;
  }
  /* "Forgot password?" row — right-aligned under the password field */
  .row {
    display: flex;
    justify-content: flex-end;
    margin-top: -4px;
  }
  /* inline text links / mode toggles — reset the global button styles */
  .textlink {
    width: auto;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--accent, #7c5cff);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .textlink:hover {
    text-decoration: underline;
  }
  .toggle {
    margin-top: 22px;
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
  }

  /* ---- right: the value panel ----
     Class is `auth-showcase` (not `showcase`) so landing.css rules — especially
     `:root[data-theme="dark"] .showcase { background: var(--paper) }` which is #111 —
     cannot override the gradient after SPA navigation from a marketing page.
     Solid hex fallback first, then the themed gradient. */
  .auth-showcase {
    background: #ff0066;
    background: linear-gradient(
      155deg,
      var(--accent, #ff0066) 0%,
      var(--accent, #ff0066) 45%,
      var(--accent-2, #ff5500) 100%
    );
    color: #fff;
    position: relative;
    overflow: hidden;
  }
  /* soft glow accents */
  .auth-showcase::before,
  .auth-showcase::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    filter: blur(2px);
  }
  .auth-showcase::before {
    width: 420px;
    height: 420px;
    top: -120px;
    right: -120px;
  }
  .auth-showcase::after {
    width: 300px;
    height: 300px;
    bottom: -100px;
    left: -80px;
    background: rgba(255, 255, 255, 0.06);
  }
  .auth-showcase-inner {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 440px;
  }
  .sc-mark {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.02em;
    opacity: 0.9;
    margin-bottom: 32px;
    text-decoration: none;
    color: inherit;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .sc-mark :global(.brandmark) {
    fill: #fff !important;
  }
  .sc-mark :global(.brandmark path) {
    fill: #fff !important;
  }
  .sc-mark span {
    opacity: 0.65;
  }

  /* ---- chat mockup inside the colored panel ---- */
  .chat-mock {
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: chat-in 0.55s ease-out both;
  }
  @keyframes chat-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .chat-row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .chat-row.user {
    justify-content: flex-end;
    animation: chat-in 0.45s ease-out 0.15s both;
  }
  .chat-row.ai {
    justify-content: flex-start;
    animation: chat-in 0.5s ease-out 0.45s both;
  }
  .chat-avatar {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.22);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chat-avatar :global(.brandmark),
  .chat-avatar :global(.brandmark path) {
    fill: #fff !important;
  }
  .chat-bubble {
    max-width: 92%;
    padding: 12px 16px;
    border-radius: 18px;
    font-size: 14px;
    line-height: 1.45;
  }
  .chat-row.user .chat-bubble {
    background: var(--accent, #ff0066);
    color: #fff;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-bottom-right-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .chat-row.ai .chat-bubble {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-bottom-left-radius: 6px;
    backdrop-filter: blur(8px);
  }
  .chat-intro {
    margin: 0 0 12px;
    font-size: 14px;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.95);
  }
  .chat-services {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chat-services li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
  }
  .chat-services strong {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .chat-services span {
    font-size: 12.5px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.82);
  }

  /* ---- CLI login notice ---- */
  .cli-notice {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(124, 92, 255, 0.08);
    border: 1px solid rgba(124, 92, 255, 0.25);
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 14px;
    color: var(--accent, #7c5cff);
    font-weight: 500;
  }
  .cli-icon {
    font-size: 16px;
    flex: 0 0 auto;
  }

  /* ---- responsive: form only on mobile ---- */
  @media (max-width: 880px) {
    .split {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }
    /* Drop the colored panel entirely — form pane is the only surface. */
    .auth-showcase {
      display: none;
    }
    .form-pane {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .form-inner {
      text-align: center;
      margin: 0 auto;
    }
    .sub {
      margin-left: auto;
      margin-right: auto;
    }
  }

  /* ---- in-app browser escape overlay ---- */
  .iab-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    padding: 16px;
  }
  .iab-card {
    width: 100%;
    max-width: 440px;
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .iab-card h2 {
    font-size: 1.3rem;
    font-weight: var(--heading-weight, 600);
    margin: 0 0 8px;
  }
  .iab-card p {
    color: var(--ink-soft, #6e6e73);
    line-height: 1.5;
    margin: 0 0 16px;
  }
  .iab-hint {
    font-size: 14px;
  }
  .iab-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent, #7c5cff);
    color: #fff;
    border-radius: 14px;
    padding: 14px 22px;
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    margin-bottom: 12px;
  }
  .iab-link {
    font-size: 13px;
    color: var(--ink-soft, #6e6e73);
    background: var(--surface, #f5f5f7);
    border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .iab-copy {
    width: 100%;
    background: var(--ink, #1d1d1f);
    color: #fff;
    border: none;
    border-radius: 14px;
    padding: 13px 22px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .iab-dismiss {
    width: 100%;
    background: transparent;
    color: var(--ink-soft, #6e6e73);
    border: none;
    padding: 12px;
    margin-top: 4px;
    font-size: 14px;
    cursor: pointer;
  }

  /* ---- dark mode ---- */
  :root[data-theme="dark"] input {
    background: var(--paper-2, #111);
    color: var(--ink, #ededed);
    border-color: var(--line, #2a2a2a);
  }
  :root[data-theme="dark"] .cta {
    background: #fff;
    color: #000;
  }
  :root[data-theme="dark"] .cta .spinner {
    border-color: rgba(0, 0, 0, 0.25);
    border-top-color: #000;
  }
  :root[data-theme="dark"] .oauth {
    background: var(--paper-2, #111);
    color: var(--ink, #ededed);
    border-color: var(--line, #2a2a2a);
  }
</style>
