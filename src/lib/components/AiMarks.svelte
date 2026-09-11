<script lang="ts">
  import { onMount } from 'svelte';
  import {
    siClaude,
    siCursor,
    siGooglegemini,
    siPerplexity,
    siGithubcopilot,
    siMistralai,
    siOpencode,
    siWindsurf,
    siCline,
    siReplit,
    siWarp,
    siRaycast,
    siQwen,
    siWebflow,
    siZapier,
    siMake,
    siOllama
  } from 'simple-icons';
  import { siOpenaiMark } from '$lib/marks';

  /**
   * I marchi che rendono concreto «la tua AI»: non stanno in posizioni decise a tavolino, cadono
   * DOVE passa il cursore sopra le due parole, uno dopo l'altro, e si sovrappongono liberamente —
   * una scia di adesivi, non una disposizione.
   *
   * Un marchio puo' arrivare da `simple-icons` (tracciato + colore) o da un file in `static/`.
   * Le due forme convivono perche' `simple-icons` NON ha OpenAI ne' xAI — li ha ritirati per il
   * marchio — e ChatGPT e Grok sono i due che chiunque si aspetta di vedere. Quando i due SVG
   * arrivano, si aggiungono qui con una riga per uno e nient'altro cambia. Disegnarli a mano
   * sarebbe peggio che non averli: un logo approssimato si riconosce, e si riconosce come sbagliato.
   */
  type Mark = { path: string; hex: string } | { src: string };

  const MARKS: Mark[] = [
    siClaude,
    siOpenaiMark,
    siCursor,
    siGooglegemini,
    siOpencode,
    siWindsurf,
    siPerplexity,
    siCline,
    siGithubcopilot,
    siReplit,
    siWarp,
    siQwen,
    siMistralai,
    siRaycast,
    siZapier,
    siWebflow,
    siMake,
    siOllama
    // { src: '/marks/grok.svg' },
    // { src: '/marks/lovable.svg' },
    // { src: '/marks/deepseek.svg' },
    // { src: '/marks/kimi.svg' },
    // { src: '/marks/glm.svg' }
  ];

  /** Quanto deve muoversi il puntatore prima che cada il prossimo: sotto, ne uscirebbe una colata. */
  const STEP_PX = 38;
  /** Quanti ne restano in vita insieme. Oltre, il DOM cresce mentre nessuno li guarda piu'. */
  const MAX = 10;
  const LIFE_MS = 1100;

  type Sticker = { id: number; x: number; y: number; icon: Mark; rot: number };
  let stickers = $state<Sticker[]>([]);

  let host: HTMLElement;

  onMount(() => {
    const word = host.parentElement;
    if (!word) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let seq = 0;
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    const drop = (e: PointerEvent) => {
      const r = word.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const far = !Number.isFinite(lastX) || Math.hypot(x - lastX, y - lastY) >= STEP_PX;
      if (!far) return;
      lastX = x;
      lastY = y;

      const id = seq++;
      const icon = MARKS[id % MARKS.length];
      // L'angolo viene dall'indice, non da Math.random: la stessa passata rende lo stesso risultato,
      // e un adesivo che ruota a caso a ogni render si nota come un difetto.
      const rot = ((id * 37) % 34) - 17;
      stickers = [...stickers, { id, x, y, icon, rot }].slice(-MAX);
      setTimeout(() => {
        stickers = stickers.filter((s) => s.id !== id);
      }, LIFE_MS);
    };

    const reset = () => {
      lastX = Number.NaN;
      lastY = Number.NaN;
    };

    word.addEventListener('pointermove', drop);
    word.addEventListener('pointerleave', reset);
    return () => {
      word.removeEventListener('pointermove', drop);
      word.removeEventListener('pointerleave', reset);
    };
  });
</script>

<span class="marks" bind:this={host} aria-hidden="true">
  {#each stickers as s (s.id)}
    <span
      class="sticker"
      style="left:{s.x}px; top:{s.y}px; --rot:{s.rot}deg{'hex' in s.icon ? `; color:#${s.icon.hex}` : ''}"
    >
      {#if 'path' in s.icon}
        <svg viewBox="0 0 24 24"><path d={s.icon.path} fill="currentColor" /></svg>
      {:else}
        <img src={s.icon.src} alt="" />
      {/if}
    </span>
  {/each}
</span>

<style>
  /* Larghezza e altezza zero: il gruppo non entra nel flusso, quindi il titolo non si muove di un
     pixel mentre gli adesivi cadono e spariscono. */
  .marks {
    position: absolute; left: 0; top: 0;
    width: 0; height: 0; pointer-events: none;
  }

  .sticker {
    position: absolute;
    width: 0.52em; height: 0.52em;
    margin: -0.26em 0 0 -0.26em; /* centrato sul punto in cui e' passato il cursore */
    display: grid; place-items: center;
    /* Bianco fisso e non `var(--paper)`: due marchi sono neri puri e in dark mode la carta e' nera,
       quindi sparirebbero. Un adesivo e' carta chiara appoggiata sopra: non segue il tema. */
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.10);
    border-radius: 0.11em;
    box-shadow: 0 0.06em 0.18em -0.05em rgba(0, 0, 0, 0.38);
    transform: rotate(var(--rot));
    animation: drop 1100ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .sticker svg,
  .sticker img { width: 62%; height: 62%; display: block; object-fit: contain; }

  @keyframes drop {
    0%   { opacity: 0; transform: scale(0.4) rotate(0deg); }
    18%  { opacity: 1; transform: scale(1.08) rotate(var(--rot)); }
    30%  { transform: scale(1) rotate(var(--rot)); }
    72%  { opacity: 1; }
    100% { opacity: 0; transform: scale(0.94) rotate(var(--rot)); }
  }

  @media (prefers-reduced-motion: reduce) {
    .sticker { animation: none; opacity: 0.9; }
  }
</style>
