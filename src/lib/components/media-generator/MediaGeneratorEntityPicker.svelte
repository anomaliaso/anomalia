<script lang="ts">
  import { _ } from 'svelte-i18n';
  import SocialThumbPicker from '$lib/components/SocialThumbPicker.svelte';
  import { STYLE_PRESETS, styleAssetUrl } from '$lib/design/presets';
  import type {
    ComposerMenu,
    EntityPick,
    MediaRefsPayload,
    PickerAnchor,
    PickerKind
  } from './media-generator-model';
  import { stylePickUrl } from './media-generator-model';

  interface Props {
    anchor: PickerAnchor;
    menu: ComposerMenu;
    pickerKind: PickerKind;
    mediaRefs: MediaRefsPayload | null;
    mediaLoading: boolean;
    picks: EntityPick[];
    brandSlug: string;
    socialPickMax: number;
    onTogglePick: (pick: EntityPick) => void;
    socialRefs?: string[];
  }

  let {
    anchor,
    menu = $bindable<ComposerMenu>('none'),
    pickerKind,
    mediaRefs,
    mediaLoading,
    picks,
    brandSlug,
    socialPickMax,
    onTogglePick,
    socialRefs = $bindable([])
  }: Props = $props();
  function isPicked(kind: EntityPick['kind'], id: string) {
    return picks.some((p) => p.kind === kind && p.id === id);
  }

  function backLabel(kind: PickerKind) {
    if (anchor === 'banner') {
      if (kind === 'talents') return $_('app.media.generator.chipModels');
      if (kind === 'products') return $_('app.media.generator.chipProducts');
      if (kind === 'styles') return $_('app.media.generator.chipStyles');
      if (kind === 'people') return $_('chat.attach.people');
      return $_('chat.attach.thumbs');
    }
    if (kind === 'talents') return $_('chat.attach.talents');
    if (kind === 'people') return $_('chat.attach.people');
    if (kind === 'products') return $_('chat.attach.products');
    if (kind === 'styles') return $_('app.media.generator.chipStyles');
    return $_('chat.attach.thumbs');
  }
</script>

<div
  class="ch-picker"
  class:mg-banner-picker={anchor === 'banner'}
  class:ch-picker-wide={pickerKind === 'thumbs' || pickerKind === 'styles'}
>
  <button
    type="button"
    class="ch-dd-back"
    onclick={() => (menu = anchor === 'banner' ? 'none' : 'plus')}
  >
    ← {backLabel(pickerKind)}
  </button>
  {#if mediaLoading && pickerKind !== 'styles'}
    <div class="ch-empty">{$_('chat.attach.loading')}</div>
  {:else if pickerKind === 'talents'}
    {#if mediaRefs?.talents?.length}
      <div class="ch-grid">
        {#each mediaRefs.talents as talent (talent.id)}
          <button
            type="button"
            class="ch-cell"
            class:on={isPicked('talent', talent.id)}
            style={`background-image:url(${talent.url})`}
            title={`${talent.name} (${talent.urls.length})`}
            onclick={() =>
              onTogglePick({
                kind: 'talent',
                id: talent.id,
                url: talent.url,
                urls: talent.urls,
                label: talent.name
              })}
          ></button>
        {/each}
      </div>
    {:else}
      <div class="ch-empty">{$_('chat.attach.emptyTalents')}</div>
    {/if}
  {:else if pickerKind === 'people'}
    {#if mediaRefs?.people?.length}
      <div class="ch-grid">
        {#each mediaRefs.people as person (person.id)}
          <button
            type="button"
            class="ch-cell"
            class:on={isPicked('person', person.id)}
            style={`background-image:url(${person.url})`}
            title={`${person.name} (${person.urls.length})`}
            onclick={() =>
              onTogglePick({
                kind: 'person',
                id: person.id,
                url: person.url,
                urls: person.urls,
                label: person.name
              })}
          ></button>
        {/each}
      </div>
    {:else}
      <div class="ch-empty">{$_('chat.attach.emptyPeople')}</div>
    {/if}
  {:else if pickerKind === 'products'}
    {#if mediaRefs?.products?.length}
      <div class="ch-grid">
        {#each mediaRefs.products as product (product.id)}
          <button
            type="button"
            class="ch-cell"
            class:on={isPicked('product', product.id)}
            style={`background-image:url(${product.url})`}
            title={`${product.name} (${product.urls.length})`}
            onclick={() =>
              onTogglePick({
                kind: 'product',
                id: product.id,
                url: product.url,
                urls: product.urls,
                label: product.name
              })}
          ></button>
        {/each}
      </div>
    {:else}
      <div class="ch-empty">{$_('chat.attach.emptyProducts')}</div>
    {/if}
  {:else if pickerKind === 'styles'}
    <div class="ch-grid">
      {#each STYLE_PRESETS as preset (preset.slug)}
        <button
          type="button"
          class="ch-cell"
          class:on={isPicked('style', preset.slug)}
          style={`background-image:url(${styleAssetUrl(preset.slug, 'cover', 360)})`}
          title={preset.name}
          onclick={() => {
            const url = stylePickUrl(preset.slug);
            onTogglePick({
              kind: 'style',
              id: preset.slug,
              url,
              urls: [url],
              label: preset.name
            });
          }}
        ></button>
      {/each}
    </div>
  {:else}
    {#if mediaRefs?.brandImages?.length}
      <div class="ch-grp">{$_('chat.attach.brandImages')}</div>
      <div class="ch-grid">
        {#each mediaRefs.brandImages as bi (bi.id)}
          <button
            type="button"
            class="ch-cell"
            class:on={isPicked('brand', bi.id)}
            style={`background-image:url(${bi.url})`}
            onclick={() =>
              onTogglePick({
                kind: 'brand',
                id: bi.id,
                url: bi.url,
                urls: [bi.url]
              })}
          ></button>
        {/each}
      </div>
    {/if}
    {#if mediaRefs?.postThumbs?.length}
      <div class="ch-grp">{$_('chat.attach.socialThumbs')}</div>
      <div class="ch-grid">
        {#each mediaRefs.postThumbs as pt (pt.id)}
          <button
            type="button"
            class="ch-cell"
            class:on={isPicked('thumb', pt.id)}
            style={`background-image:url(${pt.url})`}
            onclick={() =>
              onTogglePick({
                kind: 'thumb',
                id: pt.id,
                url: pt.url,
                urls: [pt.url]
              })}
          ></button>
        {/each}
      </div>
    {:else if !mediaRefs?.brandImages?.length}
      <div class="ch-empty">
        {$_('chat.attach.emptyThumbsHint', {
          default:
            'No synced social posts yet — search another account below to use real ads as references.'
        })}
      </div>
    {/if}
    <div class="ch-grp">
      {$_('chat.attach.fromOtherAccount', {
        default: 'From another account'
      })}
    </div>
    <p class="ch-hint">
      {$_('chat.attach.fromOtherAccountHint', {
        default:
          "Look up any creator's posts (via ScrapeCreators) and use a thumbnail as a visual reference for new ads or media."
      })}
    </p>
    <SocialThumbPicker
      {brandSlug}
      bind:selected={socialRefs}
      max={socialPickMax}
    />
  {/if}
</div>

<style>
  .ch-picker {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 40;
    width: min(300px, 80vw);
    max-height: 280px;
    overflow-y: auto;
    padding: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .ch-picker-wide {
    width: min(360px, 92vw);
    max-height: 420px;
  }
  .mg-banner-picker {
    left: auto;
    right: 0;
    bottom: auto;
    top: calc(100% + 8px);
  }
  .ch-dd-back {
    display: block;
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 4px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .ch-dd-back:hover {
    background: var(--paper-2);
    color: var(--ink);
  }
  .ch-grp {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 10px 2px 6px;
  }
  .ch-grp:first-of-type {
    margin-top: 4px;
  }
  .ch-hint {
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.4;
    margin: 0 2px 8px;
  }
  .ch-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .ch-cell {
    aspect-ratio: 1;
    border-radius: 8px;
    border: 2px solid transparent;
    background-size: cover;
    background-position: center;
    cursor: pointer;
    padding: 0;
  }
  .ch-cell.on {
    border-color: var(--accent);
  }
  .ch-empty {
    font-size: 12.5px;
    color: var(--ink-soft);
    padding: 12px 4px;
    line-height: 1.4;
  }
</style>
