<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AppWarning, WarningSeverity } from '$lib/warnings';
  import {
    brandWarnings,
    loadSeenWarnings,
    markWarningsSeen,
    warningCounts,
    warningCenterOpen
  } from '$lib/warnings';

  let { warnings = [], brandSlug = '' }: { warnings?: AppWarning[]; brandSlug?: string } = $props();

  // La campanella sta in fondo alla sidebar e il conteggio è lo STESSO di questo pannello:
  // si pubblica la lista, non si ricalcola da un'altra parte. Il pannello è già montato una
  // volta sola nel layout del brand, quindi è il posto naturale da cui dirlo.
  $effect(() => {
    brandWarnings.set(warnings);
  });

  // Il segnalibro del "già visto" si legge una volta per brand (cambiando progetto si rilegge).
  $effect(() => {
    loadSeenWarnings(brandSlug);
  });

  // Aprire il pannello È l'atto di guardarle: da qui il badge in sidebar torna a zero e si
  // riaccende solo quando arriva un id che qui dentro non c'era.
  let wasOpen = false;
  $effect(() => {
    const isOpen = $warningCenterOpen;
    if (isOpen && !wasOpen) markWarningsSeen(brandSlug, warnings);
    wasOpen = isOpen;
  });

  const SEV_ORDER: Record<WarningSeverity, number> = { error: 0, warning: 1, suggestion: 2 };
  const sorted = $derived([...warnings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]));
  const counts = $derived(warningCounts(warnings));

  let filter = $state<'all' | WarningSeverity>('all');
  const shown = $derived(filter === 'all' ? sorted : sorted.filter((w) => w.severity === filter));
  const open = $derived($warningCenterOpen);

  function close() {
    warningCenterOpen.set(false);
  }

  const SEV_ICON: Record<WarningSeverity, string> = { error: '✕', warning: '!', suggestion: 'i' };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && open) close(); }} />

{#if open}
  <div class="wc-scrim" role="button" tabindex="-1" aria-label={$_('warnings.close')}
    onclick={close}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } }}></div>
  <div class="wc-drawer" role="dialog" aria-modal="true" aria-label={$_('warnings.title')}>
    <div class="wc-head">
      <div class="wc-head-title">{$_('warnings.title')}</div>
      <button class="wc-close" onclick={close} aria-label={$_('warnings.close')}>×</button>
    </div>
    <div class="wc-filters">
      <button class="wc-chip" class:on={filter === 'all'} onclick={() => (filter = 'all')}>{$_('warnings.all')} · {counts.total}</button>
      <button class="wc-chip sev-error" class:on={filter === 'error'} onclick={() => (filter = 'error')}>{$_('warnings.errors')} · {counts.error}</button>
      <button class="wc-chip sev-warning" class:on={filter === 'warning'} onclick={() => (filter = 'warning')}>{$_('warnings.warnings')} · {counts.warning}</button>
      <button class="wc-chip sev-suggestion" class:on={filter === 'suggestion'} onclick={() => (filter = 'suggestion')}>{$_('warnings.suggestions')} · {counts.suggestion}</button>
    </div>
    <div class="wc-list">
      {#if shown.length}
        {#each shown as w (w.id)}
          <div class="wc-item sev-{w.severity}">
            <span class="wc-badge sev-{w.severity}">{SEV_ICON[w.severity]}</span>
            <div class="wc-item-body">
              <div class="wc-item-title">{$_(w.title, { values: w.values })}</div>
              <div class="wc-item-msg">{$_(w.message, { values: w.values })}</div>
              {#if w.href}
                <a class="wc-item-link" href={w.href} onclick={close}>{$_('warnings.resolve')} →</a>
              {/if}
            </div>
          </div>
        {/each}
      {:else}
        <div class="wc-empty">{$_('warnings.empty')}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wc-badge {
    flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 12px; font-weight: 800;
    display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;
  }
  .wc-badge.sev-error { background: #dc2626; }
  .wc-badge.sev-warning { background: #d97706; }
  .wc-badge.sev-suggestion { background: #2563eb; }

  .wc-scrim { position: fixed; inset: 0; z-index: 95; background: rgba(18, 26, 22, 0.28); animation: wc-fade 0.18s ease; }
  .wc-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 96; width: min(400px, 92vw); background: var(--paper, #fff);
    border-left: 1px solid var(--line, #e5e5e5); box-shadow: -20px 0 60px -20px rgba(0, 0, 0, 0.4); display: flex;
    flex-direction: column; animation: wc-slide 0.22s ease;
  }
  .wc-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--line, #eee); }
  .wc-head-title { font-size: 16px; font-weight: 700; color: var(--ink, #111); }
  .wc-close { border: none; background: none; font-size: 24px; line-height: 1; color: var(--ink-soft, #555); cursor: pointer; }
  .wc-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--line, #eee); }
  .wc-chip {
    font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line-2, #d2d2d7);
    background: var(--paper, #fff); color: var(--ink-soft, #555); cursor: pointer;
  }
  .wc-chip.on { border-color: var(--ink, #111); color: var(--ink, #111); }
  .wc-chip.sev-error.on { border-color: #dc2626; color: #dc2626; }
  .wc-chip.sev-warning.on { border-color: #d97706; color: #d97706; }
  .wc-chip.sev-suggestion.on { border-color: #2563eb; color: #2563eb; }
  .wc-list { flex: 1; overflow-y: auto; padding: 12px 20px 24px; display: flex; flex-direction: column; gap: 12px; }
  .wc-item {
    display: flex; gap: 12px; align-items: flex-start; background: var(--paper-2, #fafafa); border: 1px solid var(--line, #eee);
    border-left-width: 4px; border-radius: 12px; padding: 14px;
  }
  .wc-item.sev-error { border-left-color: #dc2626; }
  .wc-item.sev-warning { border-left-color: #d97706; }
  .wc-item.sev-suggestion { border-left-color: #2563eb; }
  .wc-item-body { min-width: 0; flex: 1; }
  .wc-item-title { font-size: 14px; font-weight: 700; color: var(--ink, #111); }
  .wc-item-msg { font-size: 13px; color: var(--ink-soft, #555); margin-top: 3px; line-height: 1.45; }
  .wc-item-link { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--accent, #2563eb); text-decoration: none; }
  .wc-empty { text-align: center; color: var(--ink-faint, #999); font-size: 13px; padding: 40px 0; }

  @keyframes wc-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes wc-slide { from { transform: translateX(100%); } to { transform: none; } }
</style>
