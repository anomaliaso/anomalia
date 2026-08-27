<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ChatLiveStatus from '$lib/components/ChatLiveStatus.svelte';
  import UgcPlaybook from '$lib/components/media-generator/UgcPlaybook.svelte';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Check from '@lucide/svelte/icons/check';
  import VideoScoreRing from '$lib/components/VideoScoreRing.svelte';
  import type { Action } from 'svelte/action';
  import { UGC_ORGANIC_SECONDS } from '$lib/ugc-formats';
  import type { StreamToolCallState } from '$lib/chat-stream-events';
  import type { UgcFormatId, UgcPlatformId } from '$lib/ugc-formats';
  import type { GridItem } from './media-generator-model';

  interface Props {
    ugcMode: boolean;
    playbookOpen: boolean;
    loading: boolean;
    i18nPrefix: string;
    brandSlug: string;
    gridItems: GridItem[];
    pendingMedia: GridItem[];
    selectedIds: string[];
    hasMore: boolean;
    loadingMore: boolean;
    loadMoreError: boolean;
    streamBuf: string;
    streamToolCalls: StreamToolCallState[];
    streamReasoning: string;
    videoCount: number;
    onProbeReady: (id: string) => void;
    onProbeDropClient: (id: string) => void;
    onOpenPreview: (item: GridItem) => void;
    onToggleSelect: (id: string) => void;
    onLoadMore: () => void;
    ugcFormat?: '' | UgcFormatId;
    ugcPlatform?: '' | UgcPlatformId;
    sentinelEl?: HTMLDivElement | null;
    overlayEl?: HTMLDivElement | null;
  }

  let {
    ugcMode,
    playbookOpen,
    loading,
    i18nPrefix,
    brandSlug,
    gridItems,
    pendingMedia,
    selectedIds,
    hasMore,
    loadingMore,
    loadMoreError,
    streamBuf,
    streamToolCalls,
    streamReasoning,
    videoCount,
    onProbeReady,
    onProbeDropClient,
    onOpenPreview,
    onToggleSelect,
    onLoadMore,
    ugcFormat = $bindable(''),
    ugcPlatform = $bindable(''),
    sentinelEl = $bindable(null),
    overlayEl = $bindable(null)
  }: Props = $props();

  const probeMedia: Action<HTMLImageElement | HTMLVideoElement, string> = (node, id) => {
    let settled = false;
    let cleanup: (() => void) | undefined;
    const finishReady = () => {
      if (settled) return;
      settled = true;
      onProbeReady(id);
    };
    // Ephemeral client-only ids (no durable row yet) can leave the grid; never purge DB here.
    const finishDropClient = () => {
      if (settled) return;
      settled = true;
      onProbeDropClient(id);
    };
    const keepDurable = () => {
      // http(s) gallery rows must remain visible across tabs even when dimensions are late/zero.
      finishReady();
    };

    if (node instanceof HTMLImageElement) {
      const succeed = () => {
        if (!node.naturalWidth || !node.naturalHeight) {
          // Broken image — hide tile, keep DB row for reload/retry.
          finishDropClient();
          return;
        }
        finishReady();
      };
      const fail = () => finishDropClient();
      if (node.complete) {
        queueMicrotask(() => (node.naturalWidth ? succeed() : fail()));
        return;
      }
      node.addEventListener('load', succeed);
      node.addEventListener('error', fail);
      cleanup = () => {
        node.removeEventListener('load', succeed);
        node.removeEventListener('error', fail);
      };
    } else {
      // VIDEO: prefer loadedmetadata (dimensions), then loadeddata. Never DELETE on failure.
      const tryReady = () => {
        if (node.videoWidth > 0 && node.videoHeight > 0) {
          finishReady();
          return true;
        }
        return false;
      };
      if (!(node.readyState >= 1 && tryReady())) {
        const onMeta = () => {
          if (tryReady()) return;
          // Metadata without dims yet — wait for data, then keep durable tile anyway.
          queueMicrotask(() => {
            if (!tryReady()) keepDurable();
          });
        };
        const onData = () => {
          if (tryReady()) return;
          keepDurable();
        };
        const onErr = () => keepDurable();

        node.addEventListener('loadedmetadata', onMeta);
        node.addEventListener('loadeddata', onData);
        node.addEventListener('error', onErr);
        // Safety: if events never fire (autoplay/policy), still surface the tile.
        const timeout = window.setTimeout(() => keepDurable(), 8000);
        cleanup = () => {
          node.removeEventListener('loadedmetadata', onMeta);
          node.removeEventListener('loadeddata', onData);
          node.removeEventListener('error', onErr);
          window.clearTimeout(timeout);
        };
      }
    }
    return { destroy: () => cleanup?.() };
  };
</script>

<div class="mg-stage">
  <div class="mg-grid-wrap" class:blurred={loading}>
    {#if ugcMode && (playbookOpen || (gridItems.length === 0 && pendingMedia.length === 0 && !loading))}
      <!-- Griglia vuota: il playbook PRENDE IL POSTO del vuoto. La pagina non ha niente da
           mostrare e ha tutto da spiegare, ed è l'unico momento in cui l'utente lo legge. -->
      <div class="mg-playbook">
        {#if gridItems.length === 0 && pendingMedia.length === 0 && !loading}
          <div class="mg-empty mg-empty-tight">
            <Sparkles size={28} strokeWidth={1.5} />
            <h2>{$_(i18nPrefix + '.emptyTitle')}</h2>
            <p>{$_(i18nPrefix + '.emptyBody')}</p>
          </div>
        {/if}
        <UgcPlaybook
          bind:format={ugcFormat}
          bind:platform={ugcPlatform}
          {videoCount}
          maxSeconds={UGC_ORGANIC_SECONDS}
          disabled={loading}
        />
      </div>
    {/if}
    {#if !ugcMode && gridItems.length === 0 && pendingMedia.length === 0 && !loading}
      <div class="mg-empty">
        <Sparkles size={28} strokeWidth={1.5} />
        <h2>{$_(i18nPrefix + '.emptyTitle')}</h2>
        <p>{$_(i18nPrefix + '.emptyBody')}</p>
      </div>
    {:else if gridItems.length > 0 || pendingMedia.length > 0}
      <!-- Off-grid probes: never occupy a masonry cell; drop on empty/error. -->
      {#if pendingMedia.length > 0}
        <div class="mg-preload" aria-hidden="true">
          {#each pendingMedia as item (item.id)}
            {#if item.type === 'video'}
              <video src={item.url} muted playsinline preload="auto" use:probeMedia={item.id}></video>
            {:else}
              <img src={item.url} alt="" use:probeMedia={item.id} />
            {/if}
          {/each}
        </div>
      {/if}
      {#if gridItems.length > 0}
        <div class="mg-masonry">
          {#each gridItems as item (item.id)}
            {@const selected = selectedIds.includes(item.id)}
            <div
              class="mg-tile"
              class:selected
              class:tall={item.tall}
              class:wide={item.wide}
            >
              <button
                type="button"
                class="mg-tile-open"
                onclick={() => onOpenPreview(item)}
                title={$_('app.media.generator.preview')}
                aria-label={$_('app.media.generator.preview')}
              >
                {#if item.type === 'video'}
                  <video src={item.url} muted playsinline loop autoplay></video>
                  <span class="mg-badge">video</span>
                  <VideoScoreRing url={item.url} brandSlug={brandSlug} size={28} corner="tl" />
                {:else}
                  <img src={item.url} alt="" loading="eager" />
                {/if}
              </button>
              <button
                type="button"
                class="mg-select-dot"
                class:on={selected}
                onclick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(item.id);
                }}
                aria-pressed={selected}
                title={selected
                  ? $_('app.media.generator.deselect')
                  : $_('app.media.generator.useAsRef')}
                aria-label={selected
                  ? $_('app.media.generator.deselect')
                  : $_('app.media.generator.useAsRef')}
              >
                {#if selected}
                  <Check size={12} strokeWidth={3} />
                {/if}
              </button>
            </div>
          {/each}
        </div>
        {#if hasMore || loadingMore || loadMoreError}
          <div class="mg-scroll-tail" bind:this={sentinelEl}>
            {#if loadingMore}
              <span class="mg-scroll-hint" aria-live="polite">…</span>
            {:else if loadMoreError}
              <button type="button" class="mg-scroll-retry" onclick={() => onLoadMore()}>
                {$_('app.media.generator.loadMoreRetry')}
              </button>
            {:else}
              <span class="mg-scroll-hint" aria-hidden="true"></span>
            {/if}
          </div>
        {/if}
      {/if}
    {/if}
  </div>

  {#if loading || streamBuf || streamToolCalls.length || streamReasoning}
    <div class="mg-overlay" aria-live="polite">
      <div class="mg-overlay-panel">
        <!-- Chi scrolla è QUESTO, non `.mg-overlay`: vedi il commento sul CSS. -->
        <div class="mg-overlay-body" bind:this={overlayEl}>
          <ChatLiveStatus
            {loading}
            {streamBuf}
            {streamToolCalls}
            {streamReasoning}
            compact
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .mg-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .mg-grid-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px 180px;
    width: 100%;
    box-sizing: border-box;
    transition: filter 0.25s ease, opacity 0.25s ease;
  }
  .mg-grid-wrap.blurred {
    filter: blur(6px);
    opacity: 0.45;
    pointer-events: none;
  }

  .mg-playbook {
    padding-bottom: 24px;
  }
  .mg-empty-tight {
    margin-top: 4vh;
  }

  .mg-empty {
    max-width: 420px;
    margin: 12vh auto 0;
    text-align: center;
    color: var(--ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .mg-empty h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--ink);
    font-weight: 600;
  }
  .mg-empty p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }

  .mg-masonry {
    /* Row-major grid: newest items fill the top row left→right, older further down.
       CSS multi-column was packing top→bottom per column, so older tiles sat high on the right. */
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    align-items: start;
    width: 100%;
  }
  @media (max-width: 1400px) {
    .mg-masonry {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 1100px) {
    .mg-masonry {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 780px) {
    .mg-masonry {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  /* Mobile: 2-up for vertical/square, full row for landscape */
  @media (max-width: 640px) {
    .mg-masonry {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .mg-tile.wide {
      grid-column: 1 / -1;
    }
    .mg-tile img,
    .mg-tile video {
      width: 100%;
      height: auto;
      object-fit: cover;
    }
    .mg-tile.tall img,
    .mg-tile.tall video {
      min-height: 0;
      aspect-ratio: 4 / 5;
    }
    .mg-tile.wide img,
    .mg-tile.wide video {
      aspect-ratio: 16 / 9;
    }
    .mg-tile:not(.tall):not(.wide) img,
    .mg-tile:not(.tall):not(.wide) video {
      aspect-ratio: 1 / 1;
    }
  }

  .mg-tile {
    position: relative;
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 14px;
    overflow: hidden;
    background: transparent;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .mg-tile-open {
    position: relative;
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: zoom-in;
    color: inherit;
  }
  .mg-select-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.92);
    background: rgba(0, 0, 0, 0.28);
    color: #fff;
    padding: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
  }
  .mg-select-dot:hover {
    transform: scale(1.06);
    background: rgba(0, 0, 0, 0.42);
  }
  .mg-select-dot.on {
    background: var(--accent);
    border-color: #fff;
  }
  .mg-scroll-tail {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 16px 0 8px;
  }
  .mg-scroll-hint {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink-faint) 50%, transparent);
  }
  .mg-scroll-retry {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .mg-scroll-retry:hover {
    border-color: var(--accent);
  }
  .mg-preload {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }
  .mg-tile:hover {
    transform: translateY(-1px);
  }
  .mg-tile.selected {
    border-color: var(--accent);
  }
  .mg-tile img,
  .mg-tile video,
  .mg-tile-open img,
  .mg-tile-open video {
    display: block;
    width: 100%;
    height: auto;
  }
  .mg-tile.tall img,
  .mg-tile.tall video {
    min-height: 220px;
    object-fit: cover;
  }
  .mg-badge {
    position: absolute;
    left: 8px;
    bottom: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    pointer-events: none;
  }
  /*
     LO SCROLL DEL RIQUADRO DI STATO, e perché qui non funzionava mentre in Motion sì.
     L'overflow stava su `.mg-overlay`, cioè sullo STESSO elemento che porta `pointer-events: none`
     — necessario, perché quel contenitore copre la griglia e la griglia si deve continuare a usare.
     Un contenitore che non riceve eventi puntatore non è un bersaglio di scroll: la rotellina
     finiva sulla griglia sotto e il riquadro restava fermo. Il `pointer-events: auto` sul pannello
     rimediava a metà (il pannello riceveva gli eventi) ma il pannello non era l'elemento che
     scorre, quindi non cambiava niente.
     La pagina Motion aveva già la forma giusta: contenitore per posizionare, pannello per i click,
     e un CORPO interno che scorre. Qui adesso è uguale — `.mg-overlay-body`, dentro il sottoalbero
     che gli eventi li riceve davvero, ed è lì che `overlayEl` è agganciato.
  */
  .mg-overlay {
    position: absolute;
    left: 50%;
    bottom: calc(var(--mg-composer-clearance, 220px) + 12px);
    transform: translateX(-50%);
    z-index: 5;
    width: min(560px, calc(100% - 24px));
    max-height: min(48vh, 420px);
    display: flex;
    pointer-events: none;
  }
  .mg-overlay-panel {
    pointer-events: auto;
    width: 100%;
    max-height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    border: 1px solid var(--line);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(10px);
  }
  .mg-overlay-body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
</style>
