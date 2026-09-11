<script lang="ts">
  import { onMount } from 'svelte';
  import { PLATFORM_META } from '$lib/components/platform-meta';

  /**
   * Ogni scheda ha una profondita': quanto si sposta per un pixel di mouse. Le piu' vicine si
   * muovono di piu', ed e' cio' che produce la parallasse invece di una traslazione unica.
   * Le posizioni sono in percentuale del riquadro, cosi' la composizione tiene a qualunque larghezza.
   */
  type Card = { top: string; left: string; depth: number; w: number; kind: Kind; small?: true };
  type Kind = 'calendar' | 'post' | 'metrics' | 'plan' | 'chat' | 'assets' | 'channels';

  /**
   * `small` marca le tre che restano su schermo stretto. Nasconderle tutte lasciava il telefono —
   * da cui arriva la maggior parte di chi legge — senza nessuna anteprima del prodotto: meglio
   * mostrarne poche, spostate agli angoli, che nessuna.
   */
  const CARDS: Card[] = [
    { top: '4%',  left: '-4%',  depth: 26, w: 300, kind: 'calendar', small: true },
    { top: '54%', left: '2%',   depth: 16, w: 250, kind: 'metrics' },
    { top: '30%', left: '-2%',  depth: 22, w: 200, kind: 'channels' },
    { top: '78%', left: '18%',  depth: 34, w: 230, kind: 'chat',     small: true },
    { top: '2%',  left: '74%',  depth: 20, w: 290, kind: 'post',     small: true },
    { top: '46%', left: '82%',  depth: 30, w: 260, kind: 'plan' },
    { top: '84%', left: '64%',  depth: 14, w: 240, kind: 'assets' }
  ];

  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  /** I giorni con un post: fissi, non casuali — una griglia che cambia a ogni render distrae. */
  const FILLED = new Set([2, 3, 6, 9, 10, 14, 16, 17, 20, 23, 24, 27]);

  /**
   * Le immagini sono quelle vere del prodotto, da tre provenienze diverse: i post usciti dai
   * modelli (`showcase-gen`), i template statici dei post (`hero`, `styles`) e i fermi delle clip
   * (`showcase`). Tenerle mescolate e' il punto — chi guarda deve vedere che qui dentro passa
   * roba prodotta, non tre volte lo stesso stock.
   */
  const GEN = [
    '/showcase-gen/flashcamp-1.webp',
    '/showcase-gen/mellon-1.webp',
    '/showcase-gen/andrea-1.webp',
    '/showcase-gen/flashcamp-2.webp',
    '/showcase-gen/mellon-2.webp',
    '/showcase-gen/andrea-2.webp',
    '/showcase-gen/flashcamp-3.webp'
  ];
  const TPL = [
    '/hero/post1.png',
    '/styles/scene-a.jpg',
    '/hero/post2.png',
    '/styles/scene-b.jpg',
    '/hero/post3.png',
    '/styles/scene-c.jpg'
  ];

  /** Miniature vere dalla libreria della landing: due sono fermi di video, e lo dicono col triangolo. */
  const TILES = [
    { src: GEN[0], video: false },
    { src: '/showcase/macha-latte.jpg', video: true },
    { src: TPL[0], video: false },
    { src: GEN[1], video: false },
    { src: TPL[1], video: false },
    { src: '/showcase/monitor.jpg', video: true },
    { src: GEN[2], video: false },
    { src: TPL[2], video: false },
    { src: '/showcase/lipstick.jpg', video: true }
  ];

  /** Le reti su cui il prodotto pubblica davvero, col loro marchio: e' il segnale piu' immediato
   *  di cosa fa Anomalia, e i colori sono gia' quelli veri in `platform-meta`. */
  const NETS = ['instagram', 'tiktok', 'linkedin', 'youtube', 'x', 'facebook'];

  /** Le celle del calendario che portano una foto invece del solo colore. */
  const CAL_SHOTS: Record<number, string> = {
    2: GEN[3], 3: TPL[2], 6: GEN[4],
    9: '/showcase/lipstick.jpg', 10: TPL[4], 14: GEN[5],
    16: TPL[3], 20: GEN[6], 23: '/showcase/macha-latte.jpg', 27: TPL[5]
  };

  let mx = $state(0);
  let my = $state(0);
  let still = $state(true);

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    still = false;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        mx = e.clientX / window.innerWidth - 0.5;
        my = e.clientY / window.innerHeight - 0.5;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

<div class="px" aria-hidden="true" class:still>
  {#each CARDS as c}
    <div
      class="px-card"
      class:small={c.small}
      style="--t:{c.top}; --l:{c.left}; --w:{c.w}px;
             transform: translate3d({(-mx * c.depth).toFixed(2)}px, {(-my * c.depth).toFixed(2)}px, 0)"
    >
      {#if c.kind === 'calendar'}
        <div class="k-head"><span class="k-dot"></span>Calendar</div>
        <div class="k-days">{#each DAYS as d}<span>{d}</span>{/each}</div>
        <div class="k-grid">
          {#each Array(28) as _, i}
            {#if CAL_SHOTS[i]}
              <span class="k-cell shot"><img src={CAL_SHOTS[i]} alt="" loading="lazy" decoding="async" /></span>
            {:else}
              <span class="k-cell" class:on={FILLED.has(i)}></span>
            {/if}
          {/each}
        </div>
      {:else if c.kind === 'post'}
        <div class="k-head"><span class="k-dot"></span>Pending approval</div>
        <img class="k-thumb" src={GEN[1]} alt="" loading="lazy" decoding="async" />
        <div class="k-line w90"></div>
        <div class="k-line w70"></div>
        <div class="k-nets">
          {#each ['instagram', 'linkedin', 'tiktok'] as n}
            <span class="k-net" style="background:{PLATFORM_META[n].bg}">
              {#if PLATFORM_META[n].icon}
                <svg viewBox="0 0 24 24" fill="#fff"><path d={PLATFORM_META[n].icon.path} /></svg>
              {:else}{PLATFORM_META[n].short}{/if}
            </span>
          {/each}
        </div>
      {:else if c.kind === 'metrics'}
        <div class="k-head"><span class="k-dot"></span>Performance</div>
        <div class="k-bars">{#each [42, 61, 38, 74, 55, 88, 70] as h}<i style="height:{h}%"></i>{/each}</div>
        <div class="k-line w50"></div>
      {:else if c.kind === 'plan'}
        <div class="k-head"><span class="k-dot"></span>Editorial plan</div>
        {#each ['Mon', 'Wed', 'Thu', 'Sat'] as d}
          <div class="k-row"><b>{d}</b><span class="k-line w80"></span></div>
        {/each}
      {:else if c.kind === 'chat'}
        <div class="k-head"><span class="k-dot"></span>Your agent</div>
        <div class="k-bubble">Approve this week’s posts</div>
        <div class="k-line w60"></div>
        <div class="k-line w85"></div>
      {:else if c.kind === 'channels'}
        <div class="k-head"><span class="k-dot"></span>Connected channels</div>
        <div class="k-netgrid">
          {#each NETS as n}
            <span class="k-net big" style="background:{PLATFORM_META[n].bg}">
              {#if PLATFORM_META[n].icon}
                <svg viewBox="0 0 24 24" fill="#fff"><path d={PLATFORM_META[n].icon.path} /></svg>
              {:else}{PLATFORM_META[n].short}{/if}
            </span>
          {/each}
        </div>
      {:else}
        <div class="k-head"><span class="k-dot"></span>Media library</div>
        <div class="k-tiles">
          {#each TILES as t}
            <span class="k-tile" class:video={t.video}>
              <img src={t.src} alt="" loading="lazy" decoding="async" />
              {#if t.video}<b class="k-play"></b>{/if}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .px {
    position: absolute; inset: 0; overflow: hidden; pointer-events: none;
    /* Il contenuto della hero deve restare leggibile: le schede vivono dietro e sbiadite. */
    z-index: 0;
  }

  /* Posizione e larghezza arrivano come variabili e non come stile inline: uno stile inline batte
     qualunque regola del foglio, e le media query sotto non potrebbero piu' spostare niente. */
  .px-card {
    position: absolute;
    top: var(--t); left: var(--l); width: var(--w);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    /* Ombra quasi assente e piena opacita': le schede sono contenuto vero, e l'ombra le velava
       piu' di quanto le staccasse. A tenerle DIETRO al testo non e' la trasparenza — e' lo
       z-index, che l'inner della hero alza a 1: cosi' si leggono senza mai coprire la parola
       che conta. */
    box-shadow: 0 2px 10px -6px rgba(0, 0, 0, 0.12);
    opacity: 1;
    display: flex; flex-direction: column; gap: 8px;
    will-change: transform;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Senza puntatore fine o con moto ridotto le schede restano dove sono: niente transizione da
     riprodurre, e nessuna promessa di movimento che non arrivera'. */
  .still .px-card { transition: none; }

  .k-head {
    display: flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 600; color: var(--ink-soft); letter-spacing: 0.01em;
  }
  .k-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex: none; }

  .k-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; font-size: 9px; color: var(--ink-soft); }
  .k-days span { text-align: center; }
  .k-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .k-cell { aspect-ratio: 1; border-radius: 5px; background: var(--line); display: block; overflow: hidden; }
  .k-cell.on { background: rgba(var(--accent-rgb), 0.55); }
  .k-cell.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .k-thumb {
    height: 74px; width: 100%; border-radius: 11px; object-fit: cover; display: block;
    background: var(--line);
  }
  .k-line { height: 7px; border-radius: 999px; background: var(--line); }
  .w90 { width: 90%; } .w85 { width: 85%; } .w80 { width: 80%; }
  .w70 { width: 70%; } .w60 { width: 60%; } .w50 { width: 50%; }

  .k-nets { display: flex; gap: 6px; margin-top: 2px; }
  .k-netgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .k-net {
    width: 22px; height: 22px; border-radius: 7px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    color: #fff; font-size: 10px; font-weight: 700;
  }
  .k-net.big { width: 100%; height: 30px; border-radius: 9px; }
  .k-net svg { width: 12px; height: 12px; }
  .k-net.big svg { width: 15px; height: 15px; }

  .k-bars { display: flex; align-items: flex-end; gap: 5px; height: 56px; }
  .k-bars i { flex: 1; border-radius: 4px 4px 2px 2px; background: rgba(var(--accent-rgb), 0.4); }

  .k-row { display: flex; align-items: center; gap: 9px; }
  .k-row b { font-size: 9.5px; font-weight: 600; color: var(--ink-soft); width: 26px; flex: none; }

  .k-bubble {
    font-size: 10.5px; color: var(--ink); line-height: 1.35;
    background: rgba(var(--accent-rgb), 0.09);
    border-radius: 12px 12px 12px 4px; padding: 8px 10px;
  }

  .k-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .k-tile { position: relative; display: block; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--line); }
  .k-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Il triangolo dice che quella e' una clip e non una foto: lo stesso segnale del riferimento,
     disegnato coi bordi invece che con un'icona da caricare. */
  .k-play {
    position: absolute; inset: 0; margin: auto; width: 0; height: 0;
    border-style: solid; border-width: 5px 0 5px 8px;
    border-color: transparent transparent transparent #fff;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
  }
  .k-tile.video::after {
    content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.22);
  }
  .k-tile.video .k-play { z-index: 1; }

  /* Su schermo stretto la composizione a sei schede non ci sta, ma sparire del tutto lascerebbe il
     telefono senza anteprima. Ne restano tre, piu' piccole e piu' sbiadite, agganciate agli angoli
     e lasciate sporgere oltre il bordo: si leggono come un accenno di prodotto dietro al testo,
     senza contendergli spazio. `overflow: hidden` sul contenitore impedisce lo scorrimento
     orizzontale che una scheda sporgente causerebbe. */
  @media (max-width: 1100px) {
    .px-card:not(.small) { display: none; }
    .px-card { opacity: 0.9; }
    .px-card.small { --w: 190px; padding: 11px 12px; }
    .px-card.small:nth-child(1) { --t: 1%;  --l: auto; right: -66px; }
    .px-card.small:nth-child(3) { --t: auto; bottom: 2%; --l: -70px; }
    .px-card.small:nth-child(4) { --t: 44%; --l: auto; right: -74px; }
  }

  @media (max-width: 560px) {
    .px-card.small { --w: 150px; padding: 9px 10px; border-radius: 14px; }
    .px-card.small:nth-child(1) { right: -58px; }
    .px-card.small:nth-child(3) { --l: -60px; }
    /* Tre schede su 560px si accavallerebbero sul testo: la terza esce, le due agli angoli bastano. */
    .px-card.small:nth-child(4) { display: none; }
  }
</style>
