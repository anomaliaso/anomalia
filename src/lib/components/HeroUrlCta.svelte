<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import { sanitizeWebsiteParam } from '$lib/website-param';

  let {
    loggedIn = false,
    waitlistActive = false,
    /** Footer is always dark (#111) even when the page theme is light. */
    tone = 'light',
    // Bindabile perché l'onboarding prefila l'URL da un draft ripreso; la homepage non lo passa
    // e il campo resta locale come prima.
    value = $bindable(''),
    // Quando c'è, il submit non naviga: chi ospita il componente decide cosa fare con l'URL già
    // sanificato (l'onboarding parte con l'analisi sul posto). Così homepage e onboarding usano
    // LO STESSO componente e non possono divergere visivamente.
    onsubmiturl
  }: {
    loggedIn?: boolean;
    waitlistActive?: boolean;
    tone?: 'light' | 'dark';
    value?: string;
    onsubmiturl?: (url: string) => void;
  } = $props();
  let focused = $state(false);
  let typed = $state('');
  let caretOn = $state(true);

  // Example URLs cycle as a typewriter when the field is idle and empty.
  const EXAMPLES = [
    'https://yourbrand.com',
    'https://acme.io',
    'www.studio.so',
    'https://mylocalshop.it'
  ];

  onMount(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      typed = EXAMPLES[0];
      return;
    }

    let ex = 0;
    let i = 0;
    let deleting = false;
    let pause = 0;
    let timer = 0;
    let caretTimer = 0;

    caretTimer = window.setInterval(() => (caretOn = !caretOn), 530);

    const tick = () => {
      if (focused || value.trim()) {
        timer = window.setTimeout(tick, 200);
        return;
      }
      const full = EXAMPLES[ex];
      if (pause > 0) {
        pause -= 1;
        timer = window.setTimeout(tick, 50);
        return;
      }
      if (!deleting) {
        i += 1;
        typed = full.slice(0, i);
        if (i >= full.length) {
          deleting = true;
          pause = 28; // ~1.4s hold
          timer = window.setTimeout(tick, 50);
          return;
        }
        timer = window.setTimeout(tick, 55 + Math.random() * 40);
      } else {
        i -= 1;
        typed = full.slice(0, i);
        if (i <= 0) {
          deleting = false;
          ex = (ex + 1) % EXAMPLES.length;
          pause = 8;
          timer = window.setTimeout(tick, 50);
          return;
        }
        timer = window.setTimeout(tick, 28);
      }
    };
    timer = window.setTimeout(tick, 400);

    return () => {
      clearTimeout(timer);
      clearInterval(caretTimer);
    };
  });

  function buildHref(url: string): string {
    if (waitlistActive) return '/waitlist';
    const qs = new URLSearchParams({ website: url });
    // Logged in → authenticated onboarding. Guests → public website → socials funnel.
    if (loggedIn) return `/app/onboarding?${qs}`;
    return `/start?${qs}`;
  }

  function submit(e: Event) {
    e.preventDefault();
    const clean = sanitizeWebsiteParam(value);
    if (!clean) return;
    value = clean;
    if (onsubmiturl) {
      onsubmiturl(clean);
      return;
    }
    void goto(buildHref(clean));
  }

  const showTyping = $derived(!focused && !value.trim());
  const canSubmit = $derived(!!sanitizeWebsiteParam(value));
</script>

<form class="hero-url-cta" class:tone-dark={tone === 'dark'} class:is-focused={focused} onsubmit={submit}>
  <div class="hero-url-aura" aria-hidden="true"></div>
  <div class="hero-url-shell">
    <div class="hero-url-field">
      <label class="hero-url-input-wrap">
        <span class="sr-only">{$_('landing.hero.urlLabel')}</span>
        <input
          type="text"
          name="website"
          inputmode="url"
          autocomplete="url"
          spellcheck="false"
          bind:value={value}
          onfocus={() => (focused = true)}
          onblur={() => (focused = false)}
          aria-label={$_('landing.hero.urlLabel')}
        />
        {#if showTyping}
          <span class="hero-url-typing" aria-hidden="true">
            {typed}<span class="hero-url-caret" class:on={caretOn}></span>
          </span>
        {/if}
      </label>
      <button
        type="submit"
        class="hero-url-go"
        disabled={!canSubmit}
        aria-label={$_('landing.hero.urlSubmitAria')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 4.5a.9.9 0 0 1 .64.26l5.5 5.5a.9.9 0 1 1-1.28 1.28L12.9 7.58V19a.9.9 0 1 1-1.8 0V7.58l-3.96 3.96a.9.9 0 1 1-1.28-1.28l5.5-5.5A.9.9 0 0 1 12 4.5Z"
          />
        </svg>
      </button>
    </div>
  </div>
</form>

<style>
  @property --hero-url-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  .hero-url-cta {
    --hero-url-angle: 0deg;
    position: relative;
    width: min(100%, 520px);
    margin: 0 auto;
    isolation: isolate;
  }

  /* Soft brand glow behind the field */
  .hero-url-aura {
    position: absolute;
    inset: -18px -28px;
    border-radius: 980px;
    background:
      radial-gradient(55% 70% at 30% 50%, color-mix(in srgb, var(--accent) 42%, transparent), transparent 70%),
      radial-gradient(50% 70% at 78% 50%, color-mix(in srgb, var(--accent-2) 36%, transparent), transparent 72%);
    filter: blur(22px);
    opacity: 0.55;
    z-index: -1;
    pointer-events: none;
    animation: heroUrlGlow 4.8s ease-in-out infinite;
  }

  /* Animated conic border shell */
  .hero-url-shell {
    position: relative;
    border-radius: 980px;
    padding: 1.5px;
    background:
      conic-gradient(
        from var(--hero-url-angle),
        color-mix(in srgb, var(--accent) 15%, transparent),
        var(--accent),
        var(--accent-2),
        color-mix(in srgb, var(--accent) 15%, transparent),
        var(--accent),
        var(--accent-2),
        color-mix(in srgb, var(--accent) 15%, transparent)
      );
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent),
      0 10px 36px -18px color-mix(in srgb, var(--accent) 55%, transparent),
      0 0 28px color-mix(in srgb, var(--accent-2) 22%, transparent);
    animation: heroUrlSpin 5.5s linear infinite;
    transition: box-shadow 0.35s var(--ease), transform 0.35s var(--ease);
  }
  .hero-url-cta.is-focused .hero-url-shell {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
      0 14px 42px -16px color-mix(in srgb, var(--accent) 70%, transparent),
      0 0 40px color-mix(in srgb, var(--accent-2) 32%, transparent);
  }
  .hero-url-cta.is-focused .hero-url-aura {
    opacity: 0.78;
  }

  .hero-url-field {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--paper);
    border-radius: inherit;
    padding: 6px 6px 6px 22px;
  }
  .hero-url-input-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .hero-url-field input {
    width: 100%;
    border: 0;
    outline: none;
    background: transparent;
    font-family: var(--sans);
    font-size: 16px;
    color: var(--ink);
    padding: 12px 4px 12px 0;
    min-width: 0;
  }
  .hero-url-typing {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    font-family: var(--sans);
    font-size: 16px;
    color: var(--ink-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }
  .hero-url-caret {
    display: inline-block;
    width: 1.5px;
    height: 1.05em;
    margin-left: 1px;
    vertical-align: text-bottom;
    background: var(--ink-faint);
    opacity: 0;
  }
  .hero-url-caret.on {
    opacity: 1;
  }
  .hero-url-go {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--ink);
    color: #fff;
    cursor: pointer;
    transition: transform 0.25s var(--ease), background 0.25s var(--ease), opacity 0.25s var(--ease);
  }
  .hero-url-go svg {
    display: block;
  }
  .hero-url-go:not(:disabled):hover {
    transform: scale(1.06);
  }
  .hero-url-go:not(:disabled):active {
    transform: scale(0.96);
  }
  .hero-url-go:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes heroUrlSpin {
    to { --hero-url-angle: 360deg; }
  }
  @keyframes heroUrlGlow {
    0%, 100% { opacity: 0.42; transform: scale(0.98); }
    50% { opacity: 0.72; transform: scale(1.03); }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-url-shell,
    .hero-url-aura {
      animation: none;
    }
    .hero-url-aura {
      opacity: 0.4;
    }
  }

  :global(:root[data-theme='dark']) .hero-url-cta:not(.tone-dark) .hero-url-field {
    background: var(--paper-2);
  }
  :global(:root[data-theme='dark']) .hero-url-cta:not(.tone-dark) .hero-url-go {
    background: var(--ink);
    color: var(--paper);
  }

  /* Forced dark — footer CTA sits on #111 even when the page theme is light. */
  .tone-dark .hero-url-aura {
    background:
      radial-gradient(55% 70% at 28% 50%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%),
      radial-gradient(50% 70% at 78% 50%, color-mix(in srgb, var(--accent-2) 48%, transparent), transparent 72%);
    opacity: 0.7;
  }
  .tone-dark .hero-url-shell {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent),
      0 12px 40px -14px color-mix(in srgb, var(--accent) 70%, transparent),
      0 0 36px color-mix(in srgb, var(--accent-2) 30%, transparent);
  }
  .tone-dark.is-focused .hero-url-shell {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent),
      0 16px 48px -12px color-mix(in srgb, var(--accent) 80%, transparent),
      0 0 48px color-mix(in srgb, var(--accent-2) 40%, transparent);
  }
  .tone-dark .hero-url-field {
    background: #171717;
  }
  .tone-dark .hero-url-field input {
    color: #fff;
  }
  .tone-dark .hero-url-typing {
    color: rgba(255, 255, 255, 0.4);
  }
  .tone-dark .hero-url-caret {
    background: rgba(255, 255, 255, 0.45);
  }
  .tone-dark .hero-url-go {
    background: #fff;
    color: #111;
  }
  .tone-dark .hero-url-go:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.92);
  }
</style>
