<script lang="ts">
  import { _ } from 'svelte-i18n';

  let {
    brandSlug,
    active,
    studioPct,
    hasStrategy,
    hasEditorialPlan,
    blogEnabled,
    radarEnabled,
    hasGeoAudit,
    gscConnected = true,
    visible = $bindable(false)
  }: {
    brandSlug: string;
    active: boolean;
    studioPct: number;
    hasStrategy: boolean;
    hasEditorialPlan: boolean;
    blogEnabled: boolean;
    radarEnabled: boolean;
    hasGeoAudit: boolean;
    gscConnected?: boolean;
    visible?: boolean;
  } = $props();

  const dismissKey = $derived(`checklist-dismissed-${brandSlug}`);

  let dismissed = $state(false);
  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let panelStyle = $state('');

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      dismissed = localStorage.getItem(dismissKey) === '1';
    }
  });

  const items = $derived([
    { key: 'studio', done: studioPct >= 80, href: `/app/${brandSlug}/settings/brand` },
    { key: 'strategy', done: hasStrategy, href: `/app/${brandSlug}/gtm` },
    { key: 'plan', done: hasEditorialPlan, href: `/app/${brandSlug}/plan` },
    { key: 'blog', done: blogEnabled, href: `/app/${brandSlug}/site` },
    { key: 'radar', done: radarEnabled, href: `/app/${brandSlug}/radar` },
    { key: 'seo', done: hasGeoAudit, href: `/app/${brandSlug}/seo` },
    { key: 'gsc', done: gscConnected, href: `/app/${brandSlug}/settings/search-console` }
  ]);

  const doneCount = $derived(items.filter((i) => i.done).length);
  const pct = $derived(items.length ? (doneCount / items.length) * 100 : 0);
  const allDone = $derived(doneCount === items.length);
  const isVisible = $derived(active && !dismissed && !allDone && !!brandSlug);

  $effect(() => {
    visible = isVisible;
  });

  function placePanel() {
    if (!rootEl) return;
    const r = rootEl.getBoundingClientRect();
    const gap = 8;
    const pad = 12;
    const mobile = window.innerWidth < 1024;
    const width = Math.min(320, window.innerWidth - pad * 2);
    const maxH = Math.min(420, window.innerHeight - pad * 2);

    if (mobile) {
      // Above the progress bar, clamped inside the viewport.
      const left = Math.max(pad, Math.min(r.left, window.innerWidth - width - pad));
      const bottom = Math.max(pad, window.innerHeight - r.top + gap);
      panelStyle = `left:${left}px;bottom:${bottom}px;width:${width}px;max-height:${maxH}px;`;
      return;
    }

    // Desktop: beside the trigger, outside the sidebar (to the right).
    let left = r.right + gap;
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, r.left - gap - width);
    }
    // Align bottoms; if that would clip the top, raise the panel.
    let bottom = window.innerHeight - r.bottom;
    if (bottom + maxH > window.innerHeight - pad) {
      bottom = Math.max(pad, window.innerHeight - maxH - pad);
    }
    if (bottom < pad) bottom = pad;
    panelStyle = `left:${left}px;bottom:${bottom}px;width:${width}px;max-height:${maxH}px;`;
  }

  function toggle() {
    open = !open;
    if (open) placePanel();
  }

  function dismissForever() {
    dismissed = true;
    open = false;
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      /* ignore */
    }
  }

  function onDocPointer(e: PointerEvent) {
    if (!open || !rootEl) return;
    if (e.target instanceof Node && !rootEl.contains(e.target)) open = false;
  }

  $effect(() => {
    if (!open) return;
    placePanel();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    const onResize = () => placePanel();
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

{#if isVisible}
  <div class="cl-root" bind:this={rootEl}>
    <button
      type="button"
      class="cl-trigger"
      class:open
      onclick={toggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={$_('app.checklist.title')}
    >
      <div class="cl-trigger-top">
        <span class="cl-trigger-label">{$_('app.checklist.title')}</span>
        <span class="cl-trigger-count">{doneCount}/{items.length}</span>
      </div>
      <div class="cl-bar" aria-hidden="true">
        <span style={`width:${pct}%`}></span>
      </div>
    </button>

    <button
      type="button"
      class="cl-trigger-icon"
      class:open
      onclick={toggle}
      aria-expanded={open}
      aria-label={$_('app.checklist.title')}
      title={$_('app.checklist.progress', { values: { done: doneCount, tot: items.length } })}
    >
      <svg class="cl-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="cl-ring-bg" cx="18" cy="18" r="14" />
        <circle
          class="cl-ring-fg"
          cx="18"
          cy="18"
          r="14"
          style={`stroke-dasharray: ${(pct / 100) * 88} 88`}
        />
      </svg>
      <span class="cl-ring-count">{doneCount}</span>
    </button>

    {#if open}
      <div
        class="cl-panel"
        role="dialog"
        aria-modal="true"
        aria-label={$_('app.checklist.title')}
        style={panelStyle}
      >
        <div class="cl-head">
          <div class="cl-head-title">{$_('app.checklist.title')}</div>
          <button type="button" class="cl-close" onclick={() => (open = false)} aria-label={$_('app.checklist.close')}
            >×</button
          >
        </div>
        <div class="cl-progress">
          <div class="cl-bar"><span style={`width:${pct}%`}></span></div>
          <span class="cl-bar-label"
            >{$_('app.checklist.progress', { values: { done: doneCount, tot: items.length } })}</span
          >
        </div>
        <ul class="cl-list">
          {#each items as item (item.key)}
            <li class:done={item.done}>
              <span class="cl-check">
                {#if item.done}
                  <svg viewBox="0 0 20 20" fill="currentColor"
                    ><path
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    /></svg
                  >
                {/if}
              </span>
              {#if item.done}
                <span class="cl-item-label done">{$_(`app.checklist.items.${item.key}`)}</span>
              {:else}
                <a class="cl-item-label" href={item.href} onclick={() => (open = false)}
                  >{$_(`app.checklist.items.${item.key}`)}</a
                >
              {/if}
            </li>
          {/each}
        </ul>
        <div class="cl-footer">
          <button type="button" class="cl-dismiss" onclick={dismissForever}
            >{$_('app.checklist.dismissForever')}</button
          >
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .cl-root {
    position: relative;
    margin: 0 -4px 6px;
  }

  .cl-trigger {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 6px;
    padding: 7px 6px;
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: background 0.15s ease;
  }
  .cl-trigger:hover,
  .cl-trigger.open {
    background: var(--sidebar-accent, rgba(0, 0, 0, 0.04));
  }
  .cl-trigger-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cl-trigger-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sidebar-foreground, var(--ink, #1d1d1f));
    opacity: 0.85;
  }
  .cl-trigger-count {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent, #7c5cff);
  }

  .cl-bar {
    height: 4px;
    border-radius: 980px;
    background: var(--sidebar-border, var(--line, #e3e3e6));
    overflow: hidden;
  }
  .cl-bar span {
    display: block;
    height: 100%;
    border-radius: 980px;
    background: var(--accent, #7c5cff);
    transition: width 0.4s ease;
  }

  /* Icon-collapsed sidebar */
  .cl-trigger-icon {
    display: none;
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    max-width: 40px;
    margin: 0 auto;
    padding: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    color: inherit;
  }
  .cl-trigger-icon:hover,
  .cl-trigger-icon.open {
    background: var(--sidebar-accent, rgba(0, 0, 0, 0.04));
  }
  .cl-ring {
    width: 28px;
    height: 28px;
    transform: rotate(-90deg);
  }
  .cl-ring-bg {
    fill: none;
    stroke: var(--sidebar-border, var(--line, #e3e3e6));
    stroke-width: 3;
  }
  .cl-ring-fg {
    fill: none;
    stroke: var(--accent, #7c5cff);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.4s ease;
  }
  .cl-ring-count {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--sidebar-foreground, var(--ink, #1d1d1f));
  }

  :global(.group[data-collapsible='icon']) .cl-trigger {
    display: none;
  }
  :global(.group[data-collapsible='icon']) .cl-trigger-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cl-panel {
    position: fixed;
    z-index: 80;
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
    overflow-x: hidden;
    overflow-y: auto;
    animation: cl-rise 0.2s ease;
  }
  @keyframes cl-rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .cl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
  }
  .cl-head-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink, #1d1d1f);
  }
  .cl-close {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--ink-faint, #86868b);
    padding: 0;
    line-height: 1;
  }
  .cl-close:hover {
    color: var(--ink, #1d1d1f);
  }

  .cl-progress {
    padding: 0 16px 12px;
  }
  .cl-bar-label {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    color: var(--ink-faint, #86868b);
  }

  .cl-list {
    list-style: none;
    padding: 0 16px 6px;
    margin: 0;
  }
  .cl-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line, #e3e3e6);
  }
  .cl-list li:last-child {
    border-bottom: none;
  }

  .cl-check {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 50%;
    border: 2px solid var(--line-2, #d2d2d7);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cl-list li.done .cl-check {
    background: var(--accent, #7c5cff);
    border-color: var(--accent, #7c5cff);
  }
  .cl-check svg {
    width: 12px;
    height: 12px;
    color: #fff;
  }

  .cl-item-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink, #1d1d1f);
    text-decoration: none;
    flex: 1;
  }
  .cl-item-label:not(.done):hover {
    color: var(--accent, #7c5cff);
  }
  .cl-item-label.done {
    color: var(--ink-faint, #86868b);
    text-decoration: line-through;
  }

  .cl-footer {
    padding: 8px 16px 12px;
    border-top: 1px solid var(--line, #e3e3e6);
    display: flex;
    justify-content: flex-end;
  }
  .cl-dismiss {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-faint, #86868b);
    padding: 0;
  }
  .cl-dismiss:hover {
    color: var(--ink, #1d1d1f);
  }

  /* Mobile drawer: keep checklist readable without oversized type */
  :global([data-mobile='true']) .cl-root {
    margin: 0 0 4px;
  }
  :global([data-mobile='true']) .cl-trigger {
    gap: 5px;
    padding: 6px 4px;
    border-radius: 10px;
  }
  :global([data-mobile='true']) .cl-trigger-label {
    font-size: 13.5px;
  }
  :global([data-mobile='true']) .cl-trigger-count {
    font-size: 12.5px;
  }
  :global([data-mobile='true']) .cl-bar {
    height: 5px;
  }
</style>
