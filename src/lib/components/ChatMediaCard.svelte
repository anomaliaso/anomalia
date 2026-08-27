<script lang="ts">
  import { Maximize2 } from '@lucide/svelte';
  import ChatImageLightbox from '$lib/components/ChatImageLightbox.svelte';
  import type { ChatMediaItem } from '$lib/chat-media';

  /**
   * Foto e video che l'agente ha voluto FAR VEDERE (`show_media`), e che non sono post.
   *
   * Uno solo → grande, che è il caso vero ("guarda questo fotogramma"). Due o più → griglia, che
   * è l'altro caso vero ("scegli fra queste tre varianti"). Il tetto sta nel normalizzatore
   * (MAX_CHAT_MEDIA), non qui: una conversazione non è una galleria.
   *
   * Il video suona solo se lo si fa partire: controlli sì, autoplay no. Un blocco di clip che
   * partono da sole mentre si scorre la chat è il modo più veloce di far chiudere la finestra.
   */
  let { media }: { media: ChatMediaItem[] } = $props();

  /** Aperto sul media cliccato: la lista ruota, così le frecce restano utili. */
  let zoom = $state<number | null>(null);
  const zoomSrc = $derived(
    zoom === null ? [] : [...media.slice(zoom), ...media.slice(0, zoom)].map((m) => m.url)
  );
</script>

<div class="chat-media" class:single={media.length === 1}>
  {#each media as m, i (m.url)}
    <figure class="cm-item">
      <div class="cm-frame">
        {#if m.kind === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="cm-media" src={m.url} controls playsinline preload="metadata"></video>
          <!-- I controlli si prendono i click sul video: l'ingrandimento ha il suo bottone. -->
          <button type="button" class="cm-expand" onclick={() => (zoom = i)} aria-label="Expand">
            <Maximize2 size={14} strokeWidth={2.25} />
          </button>
        {:else}
          <button type="button" class="cm-open" onclick={() => (zoom = i)}>
            <img class="cm-media" src={m.url} alt={m.caption ?? ''} loading="lazy" />
          </button>
        {/if}
      </div>
      {#if m.caption}
        <figcaption class="cm-cap">{m.caption}</figcaption>
      {/if}
    </figure>
  {/each}
</div>

{#if zoom !== null}
  <ChatImageLightbox
    src={zoomSrc}
    caption={media[zoom]?.caption ?? ''}
    onclose={() => (zoom = null)}
  />
{/if}

<style>
  .chat-media {
    margin: 6px 0;
    max-width: 560px;
    display: grid;
    /* auto-fit: due media riempiono la riga a metà ciascuno, sei stanno in tre per riga.
       Nessuna media query — la larghezza della colonna di chat decide da sola. */
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }
  .chat-media.single {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Quattro esatti: 2×2, non tre più un orfano in seconda fila. */
  .chat-media:has(> :nth-child(4):last-child) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cm-item {
    margin: 0;
    min-width: 0;
  }
  .cm-frame {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--paper-2);
  }
  .cm-open {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .cm-media {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    background: var(--paper-2);
  }
  /* Uno solo: il riquadro si stringe sul media invece di incorniciarlo di vuoto — una clip
     verticale in un box 560 sarebbe due bande bianche e un francobollo in mezzo. */
  .single .cm-frame {
    display: inline-block;
    max-width: 100%;
  }
  .single .cm-media {
    aspect-ratio: auto;
    width: auto;
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
  }
  /* Il video no: senza una larghezza il player nasce alla sua misura intrinseca (300×150) e
     resta un rettangolo nero finché non parte. Riquadro pieno, media contenuto dentro. */
  .single .cm-frame:has(video) {
    display: block;
  }
  .single video.cm-media {
    width: 100%;
    height: 420px;
  }
  .cm-expand {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 8px;
    color: #fff;
    background: color-mix(in oklab, #000 55%, transparent);
    cursor: pointer;
  }
  .cm-expand:hover {
    background: color-mix(in oklab, #000 72%, transparent);
  }
  .cm-cap {
    margin: 5px 2px 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink-soft);
  }
</style>
