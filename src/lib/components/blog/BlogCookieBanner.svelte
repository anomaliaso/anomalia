<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { blogBannerOpen, initBlogConsent, setBlogConsent } from './blog-consent.svelte';

  let { base = '' } = $props();
  onMount(initBlogConsent);
</script>

{#if blogBannerOpen()}
  <div class="cc" role="dialog" aria-labelledby="cc-title">
    <p id="cc-title">
      {$_('blog.cookieMessage')}
      <a href={`${base}/privacy`}>{$_('blog.details')}</a>.
    </p>
    <div class="cc-actions">
      <button class="cc-btn ghost" type="button" onclick={() => setBlogConsent('denied')}>{$_('blog.reject')}</button>
      <button class="cc-btn primary" type="button" onclick={() => setBlogConsent('granted')}>{$_('blog.accept')}</button>
    </div>
  </div>
{/if}

<style>
  .cc {
    position: fixed; left: 16px; bottom: 16px; z-index: 9999;
    width: calc(100% - 32px); max-width: 340px;
    background: var(--paper, #fff); color: var(--ink, #1d1d1f);
    border: 1px solid var(--line-2, #d2d2d7); border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
    padding: 14px 14px 12px;
    font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    animation: cc-in 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes cc-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  .cc p { font-size: 12.5px; line-height: 1.5; color: var(--ink-soft, #424245); margin: 0 0 12px; }
  .cc a { color: var(--accent, #7c5cff); text-decoration: none; }
  .cc a:hover { text-decoration: underline; }
  .cc-actions { display: flex; gap: 8px; }
  .cc-btn {
    appearance: none; border: 1px solid transparent; border-radius: 980px;
    padding: 7px 14px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }
  .cc-btn:active { transform: scale(0.97); }
  .cc-btn.ghost { background: transparent; border-color: var(--line-2, #d2d2d7); color: var(--ink, #1d1d1f); }
  .cc-btn.ghost:hover { border-color: var(--ink-faint, #86868b); }
  .cc-btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .cc-btn.primary:hover { filter: brightness(0.95); }
  @media (prefers-reduced-motion: reduce) { .cc { animation: none; } }
</style>
