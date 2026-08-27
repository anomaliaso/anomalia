<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Palette from '@lucide/svelte/icons/palette';
  import Package from '@lucide/svelte/icons/package';
  import Users from '@lucide/svelte/icons/users';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import type { ComposerMenu, EntityPick, MediaRefsPayload, PickerKind } from './media-generator-model';
  import MediaGeneratorEntityPicker from './MediaGeneratorEntityPicker.svelte';

  interface Props {
    loading: boolean;
    ugcMode: boolean;
    menu: ComposerMenu;
    pickerAnchor: 'plus' | 'banner';
    useBrandStyle: boolean;
    pickerKind: PickerKind;
    mediaRefs: MediaRefsPayload | null;
    mediaLoading: boolean;
    picks: EntityPick[];
    brandSlug: string;
    socialPickMax: number;
    onPick: (kindIn: PickerKind, anchor?: 'plus' | 'banner') => void;
    onTogglePick: (pick: EntityPick) => void;
    socialRefs?: string[];
  }

  let {
    loading,
    ugcMode,
    menu = $bindable('none'),
    pickerAnchor,
    useBrandStyle = $bindable(true),
    pickerKind,
    mediaRefs,
    mediaLoading,
    picks,
    brandSlug,
    socialPickMax,
    onPick,
    onTogglePick,
    socialRefs = $bindable([])
  }: Props = $props();
</script>

<div
  class="mg-style-banner"
  class:off={!useBrandStyle}
  role="group"
  aria-label={$_('app.media.generator.brandStyle')}
>
  <div class="mg-style-banner-left">
    <div class="mg-style-banner-text">
      <Palette size={14} strokeWidth={1.8} />
      <strong
        >{useBrandStyle
          ? $_('app.media.generator.followBrandStyle')
          : $_('app.media.generator.brandStyleOff')}</strong
      >
    </div>
    <button
      type="button"
      class="mg-style-toggle"
      class:on={useBrandStyle}
      disabled={loading}
      role="switch"
      aria-checked={useBrandStyle}
      aria-label={$_('app.media.generator.brandStyle')}
      onclick={() => (useBrandStyle = !useBrandStyle)}
    >
      <span class="mg-style-knob"></span>
    </button>
  </div>
  <div class="mg-style-banner-actions">
    <button
      type="button"
      class="mg-banner-chip"
      class:on={menu === 'picker' && pickerKind === 'products' && pickerAnchor === 'banner'}
      disabled={loading}
      onclick={() => onPick('products', 'banner')}
    >
      <Package size={13} strokeWidth={2} />
      <span>{$_('app.media.generator.chipProducts')}</span>
    </button>
    <button
      type="button"
      class="mg-banner-chip"
      class:on={menu === 'picker' && pickerKind === 'talents' && pickerAnchor === 'banner'}
      disabled={loading}
      onclick={() => onPick('talents', 'banner')}
    >
      <Users size={13} strokeWidth={2} />
      <span>{$_('app.media.generator.chipModels')}</span>
    </button>
    {#if !ugcMode}
      <button
        type="button"
        class="mg-banner-chip"
        class:on={menu === 'picker' && pickerKind === 'styles' && pickerAnchor === 'banner'}
        disabled={loading}
        onclick={() => onPick('styles', 'banner')}
      >
        <Sparkles size={13} strokeWidth={2} />
        <span>{$_('app.media.generator.chipStyles')}</span>
      </button>
    {/if}
    {#if menu === 'picker' && pickerAnchor === 'banner'}
      <MediaGeneratorEntityPicker
        anchor="banner"
        bind:menu
        {pickerKind}
        {mediaRefs}
        {mediaLoading}
        {picks}
        {brandSlug}
        {socialPickMax}
        {onTogglePick}
        bind:socialRefs
      />
    {/if}
  </div>
</div>

<style>
  .mg-style-banner {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin: 0 0 8px;
    padding: 6px 10px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  }
  .mg-style-banner.off {
    background: color-mix(in srgb, var(--paper) 92%, transparent);
  }
  .mg-style-banner-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mg-style-banner-text {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .mg-style-banner-text :global(svg) {
    flex-shrink: 0;
    color: var(--ink-soft);
  }
  .mg-style-banner-text strong {
    display: block;
    font-size: 12px;
    font-weight: 650;
    color: var(--ink);
    line-height: 1.2;
    white-space: nowrap;
  }
  .mg-style-banner-actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .mg-banner-chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft);
    font-size: 11.5px;
    font-weight: 650;
    cursor: pointer;
    line-height: 1;
  }
  .mg-banner-chip:hover:not(:disabled),
  .mg-banner-chip.on {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    color: var(--ink);
  }
  .mg-banner-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mg-banner-chip :global(svg) {
    flex-shrink: 0;
  }
  .mg-style-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 999px;
    border: none;
    flex-shrink: 0;
    background: var(--line);
    cursor: pointer;
    padding: 0;
    transition: background 0.15s ease;
  }
  .mg-style-toggle.on {
    background: var(--accent);
  }
  .mg-style-toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mg-style-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;
  }
  .mg-style-toggle.on .mg-style-knob {
    transform: translateX(16px);
  }
</style>
