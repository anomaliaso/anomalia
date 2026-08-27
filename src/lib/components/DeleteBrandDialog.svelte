<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';

  // Confirm-by-typing-the-brand-name dialog. `action` points at the settings
  // ?/deleteBrand action so any page can host it (e.g. /activate).
  let {
    brand,
    action,
    open = $bindable(false)
  }: { brand: { name: string; slug: string }; action: string; open?: boolean } = $props();

  let name = $state('');
  let deleting = $state(false);
  const error = $derived(($page.form as { deleteError?: string } | null)?.deleteError ?? null);

  $effect(() => {
    if (open) name = '';
  });
</script>

{#if open}
  <div
    class="cx-overlay"
    role="button"
    tabindex="-1"
    aria-label={$_('app.settings.close')}
    onclick={(e) => e.target === e.currentTarget && !deleting && (open = false)}
    onkeydown={(e) => e.key === 'Escape' && !deleting && (open = false)}
  >
    <div class="cx-card" role="dialog" aria-modal="true">
      <h3>{$_('app.settings.del.confirmTitle', { values: { brand: brand.name } })}</h3>
      <p class="cx-sub">{@html $_('app.settings.del.confirmBody', { values: { brand: brand.name } })}</p>
      {#if error}
        <div class="cx-err">{$_(`app.settings.del.errors.${error}`)}</div>
      {/if}
      <form
        method="POST"
        {action}
        use:enhance={() => {
          deleting = true;
          return async ({ update }) => {
            await update();
            deleting = false;
          };
        }}
      >
        <input class="cx-text" name="confirm" bind:value={name} placeholder={brand.name} autocomplete="off" spellcheck="false" />
        <div class="cx-actions">
          <button class="bbtn" type="button" disabled={deleting} onclick={() => (open = false)}>{$_('app.settings.cancel.back')}</button>
          <button class="bbtn danger" type="submit" disabled={deleting || name.trim() !== brand.name}>{deleting ? $_('app.settings.del.deleting') : $_('app.settings.del.confirmCta')}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  form { margin: 0; }
  .cx-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .cx-card { background: #fff; border-radius: 20px; padding: 26px; width: 100%; max-width: 440px;
    box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.4); }
  .cx-card h3 { margin: 0 0 8px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .cx-sub { margin: 0; font-size: 14px; color: var(--ink-soft, #6e6e73); line-height: 1.5; }
  .cx-err { margin-top: 10px; font-size: 12.5px; color: #c0392b; }
  .cx-text { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; padding: 11px 13px;
    border: 1px solid var(--line, #e3e3e6); border-radius: 12px; outline: none; margin-top: 14px; }
  .cx-text:focus { border-color: var(--accent); }
  .cx-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
  .bbtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit;
    font-size: 13.5px; font-weight: 600; padding: 9px 15px; border-radius: 11px; cursor: pointer;
    background: var(--paper-2, #f5f5f7); color: var(--ink, #1d1d1f); border: 1px solid var(--line, #e3e3e6); }
  .bbtn:hover { border-color: var(--line-2, #d2d2d7); }
  .bbtn.danger { background: transparent; color: #c0392b; border-color: rgba(192, 57, 43, 0.3); }
  .bbtn.danger:hover { background: rgba(192, 57, 43, 0.06); border-color: rgba(192, 57, 43, 0.45); }
  .bbtn:disabled { opacity: 0.55; cursor: default; }
</style>
