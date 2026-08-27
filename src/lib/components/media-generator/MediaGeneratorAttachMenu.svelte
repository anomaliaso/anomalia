<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Images from '@lucide/svelte/icons/images';
  import Plus from '@lucide/svelte/icons/plus';
  import Users from '@lucide/svelte/icons/users';
  import Package from '@lucide/svelte/icons/package';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';
  import MediaGeneratorEntityPicker from './MediaGeneratorEntityPicker.svelte';
  import type {
    ComposerMenu,
    EntityPick,
    MediaRefsPayload,
    PickerKind
  } from './media-generator-model';
  import { MAX_UPLOADS } from './media-generator-model';

  interface Props {
    loading: boolean;
    ugcMode: boolean;
    menu: ComposerMenu;
    uploadsCount: number;
    pickerKind: PickerKind;
    mediaRefs: MediaRefsPayload | null;
    mediaLoading: boolean;
    picks: EntityPick[];
    brandSlug: string;
    socialPickMax: number;
    onPickFiles: (e: Event) => void;
    onOpenPicker: (kindIn: PickerKind, anchor?: 'plus' | 'banner') => void;
    onTogglePick: (pick: EntityPick) => void;
    socialRefs?: string[];
  }

  let {
    loading,
    ugcMode,
    menu = $bindable('none'),
    uploadsCount,
    pickerKind,
    mediaRefs,
    mediaLoading,
    picks,
    brandSlug,
    socialPickMax,
    onPickFiles,
    onOpenPicker,
    onTogglePick,
    socialRefs = $bindable([])
  }: Props = $props();

  let fileEl = $state<HTMLInputElement>();
</script>

<input
  bind:this={fileEl}
  type="file"
  accept={RASTER_IMAGE_ACCEPT}
  multiple
  hidden
  onchange={onPickFiles}
/>

<div class="ch-menu-wrap">
  <button
    type="button"
    class="ch-tool"
    class:on={menu === 'plus' || menu === 'picker'}
    onclick={() => (menu = menu === 'plus' ? 'none' : 'plus')}
    disabled={loading}
    aria-label={$_('chat.attach.add')}
    title={$_('chat.attach.add')}
  >
    <Plus size={16} strokeWidth={2.2} />
  </button>

  {#if menu === 'plus'}
    <div class="ch-dropdown">
      <button
        type="button"
        class="ch-dd-item"
        onclick={() => fileEl?.click()}
        disabled={uploadsCount >= MAX_UPLOADS}
      >
        <ImagePlus class="size-4" />
        <span>{$_('chat.attach.photo')}</span>
      </button>
      <button type="button" class="ch-dd-item" onclick={() => onOpenPicker('talents')}>
        <Users class="size-4" />
        <span>{$_('chat.attach.talents')}</span>
      </button>
      <button type="button" class="ch-dd-item" onclick={() => onOpenPicker('people')}>
        <Users class="size-4" />
        <span>{$_('chat.attach.people')}</span>
      </button>
      <button type="button" class="ch-dd-item" onclick={() => onOpenPicker('products')}>
        <Package class="size-4" />
        <span>{$_('chat.attach.products')}</span>
      </button>
      {#if !ugcMode}
        <button type="button" class="ch-dd-item" onclick={() => onOpenPicker('styles')}>
          <Sparkles class="size-4" />
          <span>{$_('app.media.generator.chipStyles')}</span>
        </button>
      {/if}
      <button type="button" class="ch-dd-item" onclick={() => onOpenPicker('thumbs')}>
        <Images class="size-4" />
        <span>{$_('chat.attach.thumbs')}</span>
      </button>
    </div>
  {/if}

  {#if menu === 'picker'}
    <MediaGeneratorEntityPicker
      anchor="plus"
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

<style>
  .ch-menu-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .ch-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    min-width: 32px;
    padding: 0 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .ch-tool:hover:not(:disabled) {
    background: var(--paper-2);
    color: var(--ink);
  }
  .ch-tool.on {
    background: var(--paper-2);
    color: var(--accent);
  }
  .ch-tool:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ch-dropdown {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 40;
    min-width: 240px;
    max-width: min(320px, 80vw);
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .ch-dd-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .ch-dd-item:hover {
    background: var(--paper-2);
  }
  .ch-dd-item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ch-dd-item :global(svg) {
    flex-shrink: 0;
    color: var(--ink-soft);
  }
  .ch-dd-item > span {
    flex: 1;
    min-width: 0;
  }
</style>
