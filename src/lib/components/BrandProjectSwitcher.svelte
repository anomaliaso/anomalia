<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { cn } from '$lib/utils.js';
  import { _ } from 'svelte-i18n';
  import { Check, ChevronDown, Plus } from '@lucide/svelte';

  export type BrandStatus = 'active' | 'trial' | 'paused' | 'canceled' | string;

  export type SwitcherBrand = {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    status?: BrandStatus;
  };

  let {
    brandName,
    brandSlug,
    brandInitials = 'BR',
    logoUrl = '',
    brands = [] as SwitcherBrand[],
    compact = false
  }: {
    brandName: string;
    brandSlug: string;
    brandInitials?: string;
    logoUrl?: string;
    brands?: SwitcherBrand[];
    /** Icon-rail mode — logo only, no label. */
    compact?: boolean;
  } = $props();

  const currentStatus = $derived(
    brands.find((b) => b.slug === brandSlug)?.status ?? 'trial'
  );

  function initialsOf(name: string) {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || 'BR'
    );
  }

  function statusKey(status: BrandStatus | undefined) {
    const s = status ?? 'trial';
    if (s === 'active' || s === 'trial' || s === 'paused' || s === 'canceled') return s;
    return 'trial';
  }

  function statusTone(status: BrandStatus | undefined) {
    switch (statusKey(status)) {
      case 'active':
        return 'tone-active';
      case 'paused':
        return 'tone-paused';
      case 'canceled':
        return 'tone-canceled';
      default:
        return 'tone-trial';
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(
      'bps-trigger touch-manipulation text-left transition-colors',
      'border-0 bg-transparent shadow-none',
      'hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]',
      'dark:hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
      'data-[state=open]:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]',
      'dark:data-[state=open]:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
      compact
        ? 'flex size-8 items-center justify-center rounded-lg p-0'
        : 'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-1'
    )}
    aria-label={$_('app.brands.title')}
  >
    <span class="bps-logo">
      {#if logoUrl}
        <img
          src={logoUrl}
          alt=""
          class="size-full object-cover"
          loading="lazy"
          onerror={(e) => e.currentTarget.remove()}
        />
      {:else}
        <span class="bps-initials">{brandInitials}</span>
      {/if}
    </span>
    {#if !compact}
      <span class="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-[var(--ink)]">
        {brandName}
      </span>
      <span class={cn('bps-status', statusTone(currentStatus))}>
        <span class="bps-dot" aria-hidden="true"></span>
        {$_(`app.brands.status.${statusKey(currentStatus)}`)}
      </span>
      <ChevronDown class="size-3.5 shrink-0 text-[var(--ink-faint)]" strokeWidth={1.8} />
    {/if}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content
    side="bottom"
    align="start"
    sideOffset={6}
    class={cn(
      'bps-menu p-0',
      /* Match trigger (full sidebar content width); height hugs content until max. */
      'w-(--bits-dropdown-menu-anchor-width) min-w-(--bits-dropdown-menu-anchor-width) max-w-(--bits-dropdown-menu-anchor-width)',
      'max-h-[min(22rem,calc(100vh-7rem))] overflow-hidden'
    )}
  >
    <div class="bps-menu-inner">
      <div class="bps-menu-label">{$_('app.brands.title')}</div>

      <div class="bps-list">
        {#each brands as b (b.id)}
          {@const on = b.slug === brandSlug}
          <DropdownMenu.Item class="bps-item p-0 focus:bg-transparent">
            <a
              href={`/app/${b.slug}`}
              class={cn('bps-row', on && 'bps-row-on')}
              data-sveltekit-preload-data="hover"
            >
              <span class="bps-logo bps-logo-sm">
                {#if b.logoUrl}
                  <img src={b.logoUrl} alt="" class="size-full object-cover" loading="lazy" />
                {:else}
                  <span class="bps-initials">{initialsOf(b.name)}</span>
                {/if}
              </span>
              <span class="bps-row-text">
                <span class="bps-row-name">{b.name}</span>
                <span class={cn('bps-status bps-status-sm', statusTone(b.status))}>
                  <span class="bps-dot" aria-hidden="true"></span>
                  {$_(`app.brands.status.${statusKey(b.status)}`)}
                </span>
              </span>
              {#if on}
                <Check class="bps-check" strokeWidth={2.2} />
              {/if}
            </a>
          </DropdownMenu.Item>
        {/each}
      </div>

      <div class="bps-footer">
        <DropdownMenu.Item class="bps-item p-0 focus:bg-transparent">
          <a href="/app/onboarding" class="bps-action">
            <Plus class="size-3.5 shrink-0" strokeWidth={1.7} />
            <span>{$_('app.brands.newBrand')}</span>
          </a>
        </DropdownMenu.Item>
      </div>
    </div>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<style>
  :global(.bps-trigger) {
    appearance: none;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }
  :global(.bps-trigger:hover),
  :global(.bps-trigger[data-state='open']) {
    background: color-mix(in srgb, var(--ink) 4%, transparent) !important;
  }

  .bps-logo {
    display: flex;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
  }
  .bps-logo-sm {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }
  .bps-initials {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
  }

  .bps-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    max-width: 7.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 7px 2px 6px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1.2;
  }
  .bps-status-sm {
    max-width: none;
    padding: 0;
    background: transparent !important;
    font-size: 11px;
    font-weight: 550;
  }
  .bps-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: currentColor;
  }

  .tone-active {
    color: #0f7a4a;
    background: color-mix(in srgb, #16a34a 12%, transparent);
  }
  .tone-active .bps-dot { background: #16a34a; }
  .tone-trial {
    color: #9a6700;
    background: color-mix(in srgb, #eab308 14%, transparent);
  }
  .tone-trial .bps-dot { background: #ca8a04; }
  .tone-paused {
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .tone-paused .bps-dot { background: var(--ink-faint); }
  .tone-canceled {
    color: #b42318;
    background: color-mix(in srgb, #ef4444 12%, transparent);
  }
  .tone-canceled .bps-dot { background: #ef4444; }

  :global([data-theme='dark']) .tone-active {
    color: #4ade80;
    background: color-mix(in srgb, #16a34a 18%, transparent);
  }
  :global([data-theme='dark']) .tone-trial {
    color: #facc15;
    background: color-mix(in srgb, #eab308 16%, transparent);
  }
  :global([data-theme='dark']) .tone-canceled {
    color: #fca5a5;
    background: color-mix(in srgb, #ef4444 16%, transparent);
  }

  /* Content: hug rows until max-height, then scroll the list only. */
  :global(.bps-menu[data-slot='dropdown-menu-content']),
  :global([data-slot='dropdown-menu-content'].bps-menu) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bps-menu-inner {
    display: flex;
    flex-direction: column;
    min-height: 0;
    width: 100%;
    /* Propagate the content max-height so the list can scroll */
    max-height: min(22rem, calc(100vh - 7rem));
  }
  .bps-menu-label {
    flex-shrink: 0;
    padding: 10px 12px 6px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .bps-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 2px 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .bps-footer {
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    padding: 4px 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  :global(.bps-item) {
    width: 100%;
  }
  .bps-row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 8px 8px;
    border-radius: 10px;
    color: var(--ink);
    text-decoration: none;
  }
  .bps-row:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .bps-row-on {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .bps-row-on:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .bps-row-text {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bps-row-name {
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bps-check {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    color: var(--accent);
  }
  .bps-action {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 9px;
    min-height: 36px;
    padding: 7px 8px;
    border-radius: 9px;
    color: var(--ink-soft);
    font-size: 12.5px;
    font-weight: 550;
    text-decoration: none;
  }
  .bps-action:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    color: var(--ink);
  }
</style>
