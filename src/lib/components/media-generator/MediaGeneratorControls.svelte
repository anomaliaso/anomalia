<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Square from '@lucide/svelte/icons/square';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Check from '@lucide/svelte/icons/check';
  import {
    VIDEO_MODEL_CHOICES,
    type VideoModelChoiceId
  } from '$lib/video-models';
  import { UGC_FORMATS, UGC_PLATFORMS } from '$lib/ugc-formats';
  import type { UgcFormatId, UgcPlatformId } from '$lib/ugc-formats';
  import MediaGeneratorAttachMenu from './MediaGeneratorAttachMenu.svelte';
  import type {
    AspectRatio,
    ComposerMenu,
    EntityPick,
    MediaKindPreference,
    MediaRefsPayload,
    PickerKind,
    VariantsCount
  } from './media-generator-model';
  import { ASPECTS, KINDS, VARIANTS, UGC_VIDEO_COUNTS } from './media-generator-model';

  interface Props {
    loading: boolean;
    ugcMode: boolean;
    menu: ComposerMenu;
    aspect: AspectRatio;
    kind: MediaKindPreference;
    variants: VariantsCount;
    videoCount: number;
    ugcFormat: '' | UgcFormatId;
    ugcPlatform: '' | UgcPlatformId;
    videoModel: '' | VideoModelChoiceId;
    selectedCount: number;
    canSend: boolean;
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
    onStop: () => void;
    socialRefs?: string[];
  }

  let {
    loading,
    ugcMode,
    menu = $bindable('none'),
    aspect = $bindable<AspectRatio>('4:5'),
    kind = $bindable<MediaKindPreference>('auto'),
    variants = $bindable<VariantsCount>(1),
    videoCount = $bindable(1),
    ugcFormat = $bindable<'' | UgcFormatId>(''),
    ugcPlatform = $bindable<'' | UgcPlatformId>(''),
    videoModel = $bindable<'' | VideoModelChoiceId>(''),
    selectedCount,
    canSend,
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
    onStop,
    socialRefs = $bindable([])
  }: Props = $props();
</script>

<div class="ch-left">
  <MediaGeneratorAttachMenu
    {loading}
    {ugcMode}
    bind:menu
    {uploadsCount}
    {pickerKind}
    {mediaRefs}
    {mediaLoading}
    {picks}
    {brandSlug}
    {socialPickMax}
    {onPickFiles}
    {onOpenPicker}
    {onTogglePick}
    bind:socialRefs
  />

  <div class="mg-dd-wrap">
    <button
      type="button"
      class="mg-dd-btn"
      class:on={menu === 'aspect'}
      disabled={loading}
      onclick={() => (menu = menu === 'aspect' ? 'none' : 'aspect')}
    >
      <span>{aspect}</span>
      <ChevronDown size={12} />
    </button>
    {#if menu === 'aspect'}
      <div class="mg-dd" role="listbox" aria-label={$_('app.media.generator.aspect')}>
        {#each ASPECTS as a}
          <button
            type="button"
            class="mg-dd-item"
            class:active={aspect === a}
            role="option"
            aria-selected={aspect === a}
            onclick={() => {
              aspect = a;
              menu = 'none';
            }}
          >
            <span>{a}</span>
            {#if aspect === a}<Check size={14} />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if !ugcMode}
    <div class="mg-dd-wrap">
      <button
        type="button"
        class="mg-dd-btn"
        class:on={menu === 'kind'}
        disabled={loading}
        onclick={() => (menu = menu === 'kind' ? 'none' : 'kind')}
      >
        <span>
          {kind === 'auto'
            ? $_('app.media.generator.kindAuto')
            : kind === 'image'
              ? $_('app.media.generator.kindImage')
              : $_('app.media.generator.kindVideo')}
        </span>
        <ChevronDown size={12} />
      </button>
      {#if menu === 'kind'}
        <div class="mg-dd" role="listbox" aria-label={$_('app.media.generator.kind')}>
          {#each KINDS as k}
            <button
              type="button"
              class="mg-dd-item"
              class:active={kind === k}
              role="option"
              aria-selected={kind === k}
              onclick={() => {
                kind = k;
                menu = 'none';
              }}
            >
              <span>
                {k === 'auto'
                  ? $_('app.media.generator.kindAuto')
                  : k === 'image'
                    ? $_('app.media.generator.kindImage')
                    : $_('app.media.generator.kindVideo')}
              </span>
              {#if kind === k}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if ugcMode}
    <!-- Formato: "Auto" non è un default pigro, è la rotazione — vedi UgcPlaybook. -->
    <div class="mg-dd-wrap">
      <button
        type="button"
        class="mg-dd-btn"
        class:on={menu === 'ugcFormat'}
        disabled={loading}
        onclick={() => (menu = menu === 'ugcFormat' ? 'none' : 'ugcFormat')}
        title={$_('app.media.ugcCreator.format', { default: 'Formato' })}
      >
        <span
          >{UGC_FORMATS.find((f) => f.id === ugcFormat)?.label ??
            $_('app.media.ugcCreator.formatAuto', { default: 'Formati misti' })}</span
        >
        <ChevronDown size={12} />
      </button>
      {#if menu === 'ugcFormat'}
        <div
          class="mg-dd"
          role="listbox"
          aria-label={$_('app.media.ugcCreator.format', { default: 'Formato' })}
        >
          <button
            type="button"
            class="mg-dd-item"
            class:active={!ugcFormat}
            role="option"
            aria-selected={!ugcFormat}
            onclick={() => {
              ugcFormat = '';
              menu = 'none';
            }}
          >
            <span>{$_('app.media.ugcCreator.formatAuto', { default: 'Formati misti' })}</span>
            {#if !ugcFormat}<Check size={14} />{/if}
          </button>
          {#each UGC_FORMATS as f (f.id)}
            <button
              type="button"
              class="mg-dd-item"
              class:active={ugcFormat === f.id}
              role="option"
              aria-selected={ugcFormat === f.id}
              title={f.what}
              onclick={() => {
                ugcFormat = f.id;
                menu = 'none';
              }}
            >
              <span>{f.label}</span>
              {#if ugcFormat === f.id}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="mg-dd-wrap">
      <button
        type="button"
        class="mg-dd-btn"
        class:on={menu === 'ugcPlatform'}
        disabled={loading}
        onclick={() => (menu = menu === 'ugcPlatform' ? 'none' : 'ugcPlatform')}
        title={$_('app.media.ugcCreator.platform', { default: 'Piattaforma' })}
      >
        <span
          >{UGC_PLATFORMS.find((p) => p.id === ugcPlatform)?.label ??
            $_('app.media.ugcCreator.platformAny', { default: 'Ogni piattaforma' })}</span
        >
        <ChevronDown size={12} />
      </button>
      {#if menu === 'ugcPlatform'}
        <div
          class="mg-dd"
          role="listbox"
          aria-label={$_('app.media.ugcCreator.platform', { default: 'Piattaforma' })}
        >
          <button
            type="button"
            class="mg-dd-item"
            class:active={!ugcPlatform}
            role="option"
            aria-selected={!ugcPlatform}
            onclick={() => {
              ugcPlatform = '';
              menu = 'none';
            }}
          >
            <span
              >{$_('app.media.ugcCreator.platformAny', { default: 'Ogni piattaforma' })}</span
            >
            {#if !ugcPlatform}<Check size={14} />{/if}
          </button>
          {#each UGC_PLATFORMS as p (p.id)}
            <button
              type="button"
              class="mg-dd-item"
              class:active={ugcPlatform === p.id}
              role="option"
              aria-selected={ugcPlatform === p.id}
              title={`${p.sweetSpot[0]}-${p.sweetSpot[1]}s · ${p.cadence}`}
              onclick={() => {
                ugcPlatform = p.id;
                menu = 'none';
              }}
            >
              <span>{p.label}</span>
              {#if ugcPlatform === p.id}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if ugcMode || kind === 'video'}
    <div class="mg-dd-wrap">
      <button
        type="button"
        class="mg-dd-btn"
        class:on={menu === 'model'}
        disabled={loading}
        onclick={() => (menu = menu === 'model' ? 'none' : 'model')}
        aria-label={$_('app.media.generator.model')}
        title={$_('app.media.generator.model')}
      >
        <span
          >{VIDEO_MODEL_CHOICES.find((c) => c.id === videoModel)?.label ??
            $_('app.media.generator.modelDefault')}</span
        >
        <ChevronDown size={12} />
      </button>
      {#if menu === 'model'}
        <div class="mg-dd" role="listbox" aria-label={$_('app.media.generator.model')}>
          {#if !ugcMode}
            <button
              type="button"
              class="mg-dd-item"
              class:active={!videoModel}
              role="option"
              aria-selected={!videoModel}
              onclick={() => {
                videoModel = '';
                menu = 'none';
              }}
            >
              <span>{$_('app.media.generator.modelDefault')}</span>
              {#if !videoModel}<Check size={14} />{/if}
            </button>
          {/if}
          {#each VIDEO_MODEL_CHOICES as m (m.id)}
            <button
              type="button"
              class="mg-dd-item"
              class:active={videoModel === m.id}
              role="option"
              aria-selected={videoModel === m.id}
              onclick={() => {
                videoModel = m.id;
                menu = 'none';
              }}
            >
              <span>{m.label}</span>
              {#if videoModel === m.id}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if selectedCount}
    <span class="ch-hint"
      >{$_('app.media.generator.selected', { values: { n: selectedCount } })}</span
    >
  {/if}
</div>

<div class="ch-right">
  {#if ugcMode}
    <div class="mg-dd-wrap mg-variants-wrap">
      <button
        type="button"
        class="mg-dd-btn mg-variants-btn"
        class:on={menu === 'videoCount'}
        disabled={loading}
        onclick={() => (menu = menu === 'videoCount' ? 'none' : 'videoCount')}
        aria-haspopup="listbox"
        aria-expanded={menu === 'videoCount'}
        aria-label={$_('app.media.ugcCreator.videoCount')}
        title={$_('app.media.ugcCreator.videoCount')}
      >
        <span>{$_('app.media.ugcCreator.videoCountOption', { values: { n: videoCount } })}</span>
        <ChevronDown size={12} />
      </button>
      {#if menu === 'videoCount'}
        <div
          class="mg-dd mg-dd-end mg-dd-scroll"
          role="listbox"
          aria-label={$_('app.media.ugcCreator.videoCount')}
        >
          {#each UGC_VIDEO_COUNTS as n}
            <button
              type="button"
              class="mg-dd-item"
              class:active={videoCount === n}
              role="option"
              aria-selected={videoCount === n}
              onclick={() => {
                videoCount = n;
                menu = 'none';
              }}
            >
              <span>{$_('app.media.ugcCreator.videoCountOption', { values: { n } })}</span>
              {#if videoCount === n}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="mg-dd-wrap mg-variants-wrap">
      <button
        type="button"
        class="mg-dd-btn mg-variants-btn"
        class:on={menu === 'variants'}
        disabled={loading}
        onclick={() => (menu = menu === 'variants' ? 'none' : 'variants')}
        aria-haspopup="listbox"
        aria-expanded={menu === 'variants'}
        aria-label={$_('app.media.generator.variants')}
        title={$_('app.media.generator.variants')}
      >
        <span>{variants}×</span>
        <ChevronDown size={12} />
      </button>
      {#if menu === 'variants'}
        <div class="mg-dd mg-dd-end" role="listbox" aria-label={$_('app.media.generator.variants')}>
          {#each VARIANTS as n}
            <button
              type="button"
              class="mg-dd-item"
              class:active={variants === n}
              role="option"
              aria-selected={variants === n}
              onclick={() => {
                variants = n;
                menu = 'none';
              }}
            >
              <span>{$_('app.media.generator.variantsOption', { values: { n } })}</span>
              {#if variants === n}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <button type="button" class="ch-send ch-stop" onclick={onStop} aria-label={$_('app.media.generator.stop')}>
      <Square size={14} fill="currentColor" />
    </button>
  {:else}
    <button type="submit" class="ch-send" disabled={!canSend} aria-label="Send">
      <ArrowUp size={17} strokeWidth={2.2} />
    </button>
  {/if}
</div>

<style>
  .ch-left {
    grid-area: left;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .ch-hint {
    font-size: 12px;
    color: var(--ink-faint);
    margin-left: 4px;
  }
  .ch-hint {
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.4;
    margin: 0 2px 8px;
  }
  .ch-right {
    grid-area: send;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .mg-dd-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .mg-dd-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.01em;
    cursor: pointer;
    line-height: 1;
  }
  .mg-dd-btn.on,
  .mg-dd-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    color: var(--ink);
  }
  .mg-dd-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mg-dd-btn :global(svg) {
    opacity: 0.7;
    flex-shrink: 0;
  }
  .mg-dd {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    min-width: 140px;
    padding: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .mg-dd-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    border: none;
    background: transparent;
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
  }
  .mg-dd-item:hover,
  .mg-dd-item.active {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .mg-variants-wrap .mg-dd-end {
    left: auto;
    right: 0;
    min-width: 160px;
  }
  .mg-dd-scroll {
    max-height: min(320px, 50vh);
    overflow-y: auto;
  }
  .mg-variants-btn {
    min-width: 52px;
  }
  .ch-send {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.12s ease;
  }
  .ch-send:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ch-send:not(:disabled):hover {
    transform: scale(1.05);
  }
  .ch-send.ch-stop {
    background: #ef4444;
  }
</style>
