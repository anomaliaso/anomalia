<script lang="ts">
  import { _ } from 'svelte-i18n';
  import PromptHistoryDrawer from '$lib/components/PromptHistoryDrawer.svelte';
  import { isSeedanceFamily, type VideoModelChoiceId } from '$lib/video-models';
  import type { UgcFormatId, UgcPlatformId } from '$lib/ugc-formats';
  import MediaGeneratorStyleBanner from './MediaGeneratorStyleBanner.svelte';
  import MediaGeneratorSeedanceChips from './MediaGeneratorSeedanceChips.svelte';
  import MediaGeneratorControls from './MediaGeneratorControls.svelte';
  import type {
    AspectRatio,
    ComposerMenu,
    EntityPick,
    GridItem,
    MediaKindPreference,
    MediaRefsPayload,
    PickerKind,
    PickerAnchor,
    PromptHistoryEntry,
    VariantsCount
  } from './media-generator-model';

  interface Props {
    loading: boolean;
    ugcMode: boolean;
    i18nPrefix: string;
    brandSlug: string;
    pickerAnchor: PickerAnchor;
    pickerKind: PickerKind;
    mediaRefs: MediaRefsPayload | null;
    mediaLoading: boolean;
    socialPickMax: number;
    canSend: boolean;
    firstFrameUrl: string;
    lastFrameUrl: string;
    seedancePanel: null | 'start' | 'end' | 'video' | 'audio';
    seedanceVideoN: number;
    seedanceAudioN: number;
    selectedItems: GridItem[];
    history: PromptHistoryEntry[];
    onSend: () => void;
    onStop: () => void;
    onPickFiles: (e: Event) => void;
    onOpenPicker: (kindIn: PickerKind, anchor?: PickerAnchor) => void;
    onTogglePick: (pick: EntityPick) => void;
    onOpenSeedancePanel: (which: 'start' | 'end' | 'video' | 'audio') => void;
    input?: string;
    menu?: ComposerMenu;
    aspect?: AspectRatio;
    kind?: MediaKindPreference;
    variants?: VariantsCount;
    videoCount?: number;
    ugcFormat?: '' | UgcFormatId;
    ugcPlatform?: '' | UgcPlatformId;
    videoModel?: '' | VideoModelChoiceId;
    useBrandStyle?: boolean;
    socialRefs?: string[];
    picks?: EntityPick[];
    selectedIds?: string[];
    historyOpen?: boolean;
    uploads?: string[];
  }

  let {
    loading,
    ugcMode,
    i18nPrefix,
    brandSlug,
    pickerAnchor,
    pickerKind,
    mediaRefs,
    mediaLoading,
    socialPickMax,
    canSend,
    firstFrameUrl,
    lastFrameUrl,
    seedancePanel,
    seedanceVideoN,
    seedanceAudioN,
    selectedItems,
    history,
    onSend,
    onStop,
    onPickFiles,
    onOpenPicker,
    onTogglePick,
    onOpenSeedancePanel,
    input = $bindable(''),
    menu = $bindable<ComposerMenu>('none'),
    aspect = $bindable<AspectRatio>('4:5'),
    kind = $bindable<MediaKindPreference>('auto'),
    variants = $bindable<VariantsCount>(1),
    videoCount = $bindable(1),
    ugcFormat = $bindable<'' | UgcFormatId>(''),
    ugcPlatform = $bindable<'' | UgcPlatformId>(''),
    videoModel = $bindable<'' | VideoModelChoiceId>(''),
    useBrandStyle = $bindable(true),
    socialRefs = $bindable<string[]>([]),
    picks = $bindable<EntityPick[]>([]),
    selectedIds = $bindable<string[]>([]),
    historyOpen = $bindable(false),
    uploads = $bindable<string[]>([])
  }: Props = $props();

  let composerRoot = $state<HTMLFormElement>();
  let inputEl = $state<HTMLTextAreaElement>();

  const seedanceModelActive = $derived(
    isSeedanceFamily(videoModel) || (ugcMode && !videoModel)
  );
  const showSeedanceFields = $derived(
    (ugcMode || kind === 'video') &&
      (seedanceModelActive || selectedItems.some((i) => i.type === 'video'))
  );
  const refStrip = $derived([
    ...uploads.map((url, i) => ({
      key: `up-${i}`,
      url,
      source: 'upload' as const,
      index: i
    })),
    ...socialRefs.map((url, i) => ({
      key: `social-${i}`,
      url,
      source: 'social' as const,
      index: i
    })),
    ...picks.flatMap((p, pickIndex) => {
      const urls = p.urls?.length ? p.urls : [p.url];
      return urls.map((url, i) => ({
        key: `${p.kind}-${p.id}-${i}`,
        url,
        source: 'pick' as const,
        pickIndex
      }));
    }),
    ...selectedItems.map((it) => ({
      key: it.id,
      url: it.url,
      source: 'grid' as const,
      id: it.id
    }))
  ]);
  const historyDrawerEntries = $derived(
    history.map((entry) => ({
      id: entry.id,
      prompt: entry.prompt,
      at: entry.at,
      meta: `${entry.aspect} · ${entry.kind}${entry.mediaCount ? ` · ${entry.mediaCount} media` : ''}`
    }))
  );

  $effect(() => {
    const closeMenus = (e: MouseEvent) => {
      if (!composerRoot?.contains(e.target as Node)) menu = 'none';
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  });

  $effect(() => {
    void input;
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(Math.max(inputEl.scrollHeight, 44), 200)}px`;
  });

  function clearSelection() {
    selectedIds = [];
  }

  function removeUpload(index: number) {
    uploads = uploads.filter((_, i) => i !== index);
  }

  function removeSocialRef(index: number) {
    socialRefs = socialRefs.filter((_, i) => i !== index);
  }

  function removeGridRef(id: string) {
    selectedIds = selectedIds.filter((x) => x !== id);
  }

  function removePick(pickIndex: number) {
    picks = picks.filter((_, i) => i !== pickIndex);
  }

  function removeStripRef(ref: {
    source: 'upload' | 'social' | 'pick' | 'grid';
    index?: number;
    pickIndex?: number;
    id?: string;
  }) {
    if (ref.source === 'upload' && ref.index != null) removeUpload(ref.index);
    else if (ref.source === 'social' && ref.index != null) removeSocialRef(ref.index);
    else if (ref.source === 'pick' && ref.pickIndex != null) removePick(ref.pickIndex);
    else if (ref.source === 'grid' && ref.id) removeGridRef(ref.id);
  }

  function reusePrompt(entry: PromptHistoryEntry) {
    input = entry.prompt;
    kind = ugcMode ? 'video' : entry.kind;
    aspect = entry.aspect;
    historyOpen = false;
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }
</script>

<form
    bind:this={composerRoot}
    class="ch-shell"
    onsubmit={(e) => {
      e.preventDefault();
      onSend();
    }}
  >
    <MediaGeneratorStyleBanner
      {loading}
      {ugcMode}
      bind:menu
      {pickerAnchor}
      bind:useBrandStyle
      {pickerKind}
      {mediaRefs}
      {mediaLoading}
      {picks}
      {brandSlug}
      {socialPickMax}
      onPick={onOpenPicker}
      onTogglePick={onTogglePick}
      bind:socialRefs
    />

    <div class="ch-box">
      {#if refStrip.length}
        <div class="ch-refs">
          {#each refStrip as ref (ref.key)}
            {@const isVideoRef =
              ref.source === 'grid' &&
              selectedItems.find((i) => i.id === ref.key)?.type === 'video'}
            <div class="ch-ref" class:video-ref={isVideoRef}>
              {#if isVideoRef}
                <video src={ref.url} muted playsinline preload="metadata"></video>
              {:else}
                <div class="ch-ref-bg" style="background-image: url({ref.url})"></div>
              {/if}
              <button
                type="button"
                class="ch-ref-x"
                aria-label={$_('chat.attach.remove')}
                onclick={() => removeStripRef(ref)}
              >×</button>
            </div>
          {/each}
          {#if selectedIds.length}
            <button type="button" class="mg-clear-refs" onclick={clearSelection}>
              {$_('app.media.generator.clearSelection')}
            </button>
          {/if}
        </div>
      {/if}

      <div class="ch-body">
        <textarea
          bind:this={inputEl}
          class="ch-input"
          bind:value={input}
          placeholder={$_(i18nPrefix + '.placeholder')}
          rows="1"
          disabled={loading}
          onkeydown={onKeydown}
        ></textarea>

        {#if showSeedanceFields && seedanceModelActive}
          <MediaGeneratorSeedanceChips
            {loading}
            {firstFrameUrl}
            {lastFrameUrl}
            {seedancePanel}
            {seedanceVideoN}
            {seedanceAudioN}
            onOpenPanel={onOpenSeedancePanel}
          />
        {/if}

        <MediaGeneratorControls
          {loading}
          {ugcMode}
          bind:menu
          bind:aspect
          bind:kind
          bind:variants
          bind:videoCount
          bind:ugcFormat
          bind:ugcPlatform
          bind:videoModel
          selectedCount={selectedIds.length}
          {canSend}
          uploadsCount={uploads.length}
          {pickerKind}
          {mediaRefs}
          {mediaLoading}
          {picks}
          {brandSlug}
          {socialPickMax}
          onPickFiles={onPickFiles}
          onOpenPicker={onOpenPicker}
          onTogglePick={onTogglePick}
          onStop={onStop}
          bind:socialRefs
        />
      </div>
    </div>
  </form>

<PromptHistoryDrawer
  open={historyOpen}
  title={$_(i18nPrefix + '.historyTitle')}
  empty={$_(i18nPrefix + '.historyEmpty')}
  reuseLabel={$_('app.media.generator.reusePrompt')}
  entries={historyDrawerEntries}
  onclose={() => (historyOpen = false)}
  onreuse={(row) => {
    const entry = history.find((h) => h.id === row.id);
    if (entry) reusePrompt(entry);
    else {
      input = row.prompt;
      historyOpen = false;
      inputEl?.focus();
    }
  }}
/>

<style>
  /* Mirror ChatPrompt shell aesthetics */
  .ch-shell {
    max-width: none;
    width: 100%;
    margin: 0 auto;
  }
  .ch-box {
    position: relative;
    background: color-mix(in srgb, var(--paper) 94%, transparent);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 12px 14px 10px;
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(14px);
    transition: border-color 0.15s ease;
  }
  .ch-box:focus-within {
    border-color: var(--accent);
  }
  .ch-body {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'input input'
      'seedance seedance'
      'left send';
    column-gap: 8px;
    row-gap: 8px;
    align-items: end;
  }
  .ch-input {
    grid-area: input;
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: none;
    font: inherit;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--ink);
    min-height: 44px;
    max-height: 200px;
    box-sizing: border-box;
    padding: 0;
  }
  .ch-input::placeholder {
    color: var(--ink-faint);
  }
  .ch-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    align-items: center;
  }
  .ch-ref {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 10px;
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .ch-ref-bg {
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
  }
  .ch-ref.video-ref video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .ch-ref-x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: var(--ink);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  .mg-clear-refs {
    border: none;
    background: none;
    color: var(--ink-soft);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
  }
</style>
