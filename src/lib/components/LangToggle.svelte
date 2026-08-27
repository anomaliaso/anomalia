<script lang="ts">
  import { locale, _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { goto, invalidateAll } from '$app/navigation';
  import { SUPPORTED, localePath, type Locale } from '$lib/i18n/locale';

  // Active locale = the svelte-i18n store. It's the only value that's reliably live after a
  // toggle: $page.data.locale comes from the root layout server load, which does NOT re-run on
  // a plain goto() navigation, so it goes stale (showed the old code, locking the control).
  const current = $derived(($locale ?? $page.data.locale ?? 'en') as Locale);

  let open = $state(false);
  let alignEnd = $state(false);
  let rootEl = $state<HTMLDivElement | undefined>();
  let menuEl = $state<HTMLUListElement | undefined>();

  function reposition() {
    if (!rootEl || !menuEl) return;
    // Measure as left-aligned first, then flip if it would leave the viewport.
    alignEnd = false;
    requestAnimationFrame(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      const pad = 8;
      if (rect.right > window.innerWidth - pad) {
        alignEnd = true;
      } else if (rect.left < pad) {
        alignEnd = false;
      }
    });
  }

  function toggle() {
    open = !open;
    if (open) {
      // Wait for the menu to mount, then measure.
      requestAnimationFrame(reposition);
    }
  }

  async function choose(l: Locale) {
    open = false;
    if (l === current) return;

    // 1-year cookie drives SSR + app pages; matches the name hooks.server.ts reads.
    document.cookie = `locale=${l};path=/;max-age=31536000;samesite=lax`;
    locale.set(l); // instant in-place re-translation of every $_()
    if (typeof document !== 'undefined') document.documentElement.lang = l;

    // Remember server-side for cron emails (no-op when logged out).
    fetch('/api/v1/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: l })
    }).catch(() => {});

    // Marketing pages carry the locale in the URL → navigate so the path stays canonical.
    // Everywhere else (the app), just re-run load with the new cookie.
    if ($page.route.id?.startsWith('/[[lang=locale]]')) {
      const basePath = $page.url.pathname.replace(new RegExp(`^\\/(${SUPPORTED.join('|')})(?=/|$)`), '') || '/';
      await goto(localePath(basePath, l));
    } else {
      await invalidateAll();
    }
  }

  // Close when focus leaves the whole control (keyboard-friendly, no global listener).
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!e.currentTarget || !(e.currentTarget as HTMLElement).contains(next)) open = false;
  }

  $effect(() => {
    if (!open) return;
    function onResize() {
      reposition();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<div class="lang" bind:this={rootEl} onfocusout={onFocusOut}>
  <button
    type="button"
    class="lang-trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={$_('common.lang.switch')}
    onclick={toggle}
  >
    {current.toUpperCase()}
    <svg class="chev" class:open viewBox="0 0 10 6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <ul class="lang-menu" class:align-end={alignEnd} role="listbox" bind:this={menuEl}>
      {#each SUPPORTED as l (l)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={current === l}
            class:active={current === l}
            onclick={() => choose(l)}
          >
            <span class="code">{l.toUpperCase()}</span>
            <span class="name">{$_('common.lang.' + l)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .lang {
    position: relative;
    display: inline-flex;
  }
  .lang-trigger {
    appearance: none;
    border: 0;
    background: none;
    padding: 4px 2px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-soft, #6e6e73);
    cursor: pointer;
    transition: color 0.18s ease;
  }
  .lang-trigger:hover {
    color: var(--ink, #1d1d1f);
  }
  .chev {
    width: 9px;
    height: 9px;
    transition: transform 0.2s ease;
  }
  .chev.open {
    transform: rotate(180deg);
  }

  .lang-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 200;
    margin: 0;
    padding: 4px;
    list-style: none;
    min-width: 124px;
    background: #fff;
    border: 1px solid var(--line, #d2d2d7);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  }
  .lang-menu.align-end {
    left: auto;
    right: 0;
  }
  .lang-menu li {
    list-style: none;
  }
  .lang-menu button {
    width: 100%;
    appearance: none;
    border: 0;
    background: none;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    color: var(--ink, #1d1d1f);
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }
  .lang-menu button:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  .lang-menu button.active {
    font-weight: 600;
  }
  .lang-menu .code {
    width: 20px;
    flex: 0 0 auto;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .lang-menu .name {
    color: var(--ink-soft, #6e6e73);
  }
  .lang-menu button.active .name {
    color: inherit;
  }

  /* Dark mode */
  :root[data-theme="dark"] .lang-menu {
    background: var(--paper-2, #111);
    border-color: var(--line, #2a2a2a);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  :root[data-theme="dark"] .lang-menu button {
    color: var(--ink, #ededed);
  }
  :root[data-theme="dark"] .lang-menu button:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  :root[data-theme="dark"] .lang-menu .name {
    color: var(--ink-soft, #a1a1a6);
  }
</style>
