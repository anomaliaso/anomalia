<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { siClaude } from 'simple-icons';
  import { PLATFORM_META } from '$lib/components/platform-meta';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';

  /**
   * La prima cosa dopo la hero e' l'artefatto, non una spiegazione, e i tre passi sono tre
   * schermate diverse perche' nel prodotto sono tre posti diversi: la conversazione con la tua AI,
   * la richiesta di approvazione, il profilo pubblico.
   *
   * DUE IMPIANTI, non uno adattato. Con due colonne la schermata sta ferma a destra mentre i passi
   * scorrono, e a legarla ai tre momenti c'e' UNA sola immagine che si sposta nella casella che le
   * tocca — l'anteprima nella chat, la foto del post in attesa, la cella del profilo. Su una
   * colonna quella grammatica non esiste: qualunque cosa si tenga ferma copre cio' che le passa
   * sotto. Li' ogni passo si porta la propria schermata, subito sotto il proprio testo, e non si
   * sovrappone niente. Le schermate sono scritte una volta sola e rese due volte: a raddoppiarsi
   * e' il markup, non il testo che lo descrive.
   */
  const TK = 'landing.story.output';
  const STEPS = ['s1', 's2', 's3'] as const;
  const SHOT = '/showcase-gen/flashcamp-1.webp';
  const SCREENS = ['chat', 'review', 'profile'] as const;

  /** Le altre caselle del profilo: il post appena pubblicato atterra fra lavoro gia' fatto. */
  const WALL = [
    '/showcase-gen/mellon-1.webp',
    '/hero/post2.png',
    '/showcase-gen/andrea-1.webp',
    '/styles/scene-a.jpg',
    '/showcase-gen/flashcamp-2.webp'
  ];

  /** I numeri del profilo partono da zero e salgono quando il pannello arriva: il post e' appena
   *  uscito, e quello che si vede muovere e' l'effetto che ha. */
  const FOLLOWERS = 18432;
  const VIEWS = 96200;
  const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n)}`);

  let active = $state(0);
  /** Una volta saliti, i numeri restano su: tornando indietro li si vedrebbe scendere, e un
   *  contatore che scende racconta il contrario di quello che e' appena successo. */
  let counted = $state(false);
  /** L'anteprima nella chat non c'e' da subito: arriva verso la fine del primo passo, quando si
   *  e' finito di leggere cosa sta facendo. E' da li' che parte il viaggio dell'immagine. */
  let previewOut = $state(false);

  let steps: HTMLElement[] = [];
  let cue = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);
  /** Il riquadro contro cui si misura e' quello che posiziona l'immagine — il suo offsetParent —
   *  non la griglia che la contiene: sbagliare riferimento la manda fuori schermo di uno schermo. */
  let stack = $state<HTMLElement | null>(null);

  let fly = $state({ x: 0, y: 0, w: 0, h: 0, r: 14 });
  const flying = $derived(previewOut || active > 0);

  const RADII = [14, 0, 0];

  /**
   * La casella di destinazione si cerca nel DOM invece di legarla a una variabile: le schermate
   * esistono in due copie e solo una delle due e' disegnata — quella nascosta misura zero, e si
   * scarta da sola.
   */
  function place() {
    const box = stack?.getBoundingClientRect();
    if (!box) return;
    for (const node of root?.querySelectorAll(`[data-slot="${active}"]`) ?? []) {
      const slot = node.getBoundingClientRect();
      if (!slot.width) continue;
      fly = {
        x: slot.left - box.left,
        y: slot.top - box.top,
        w: slot.width,
        h: slot.height,
        r: RADII[active]
      };
      return;
    }
  }

  $effect(() => {
    void active;
    void previewOut;
    void tick().then(place);
  });

  $effect(() => {
    if (active === 2) counted = true;
  });

  onMount(() => {
    if (!('IntersectionObserver' in window)) return;

    // La banda stretta al centro dello schermo decide il passo: quello che la attraversa e' quello
    // che si sta leggendo. Serve solo dove la schermata sta ferma — su una colonna ogni passo ha
    // gia' la sua sotto il naso, e non c'e' niente da sincronizzare.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = steps.indexOf(e.target as HTMLElement);
          if (i >= 0) active = i;
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    for (const s of steps) {
      if (s) io.observe(s);
    }

    // Il segnale dell'anteprima sta in fondo al primo testo: entra nella meta' bassa dello schermo
    // solo quando quel passo e' quasi finito di scorrere.
    const cueIo = new IntersectionObserver(
      ([e]) => {
        previewOut = e.isIntersecting;
      },
      { rootMargin: '-58% 0px 0px 0px', threshold: 0 }
    );
    if (cue) cueIo.observe(cue);

    const ro = new ResizeObserver(() => place());
    if (root) ro.observe(root);
    place();

    return () => {
      io.disconnect();
      cueIo.disconnect();
      ro.disconnect();
    };
  });
</script>

{#snippet chatScreen()}
  <header class="so-chat-head">
    <svg class="so-claude" viewBox="0 0 24 24" aria-hidden="true"><path d={siClaude.path} fill="currentColor" /></svg>
    {$_(`${TK}.chat.head`)}
  </header>
  <div class="so-chat-body">
    <p class="so-bubble">{$_(`${TK}.chat.ask`)}</p>
    <div class="so-chips">
      <span class="so-chip"><i></i>query brands</span>
      <span class="so-chip"><i></i>query competitors</span>
    </div>
    <p class="so-line">{$_(`${TK}.chat.l1`)}</p>
    <p class="so-line">{$_(`${TK}.chat.l2`)}</p>
    <p class="so-line last">{$_(`${TK}.chat.l3`)}</p>
    <div class="so-prev" class:is-out={previewOut}>
      <span class="so-slot so-prev-slot" data-slot="0">
        <img src={SHOT} alt="" loading="lazy" decoding="async" />
      </span>
      <span class="so-prev-txt">{$_(`${TK}.chat.preview`)}</span>
    </div>
  </div>
{/snippet}

{#snippet reviewScreen()}
  <header class="so-rv-head">
    <span class="so-plat" style="background:{PLATFORM_META.instagram.bg}">
      <svg viewBox="0 0 24 24" fill="#fff"><path d={PLATFORM_META.instagram.icon?.path} /></svg>
    </span>
    <b>@flashcamp</b>
    <span class="so-badge">{$_(`${TK}.state.approve`)}</span>
  </header>
  <span class="so-slot so-rv-slot" data-slot="1">
    <img src={SHOT} alt="" loading="lazy" decoding="async" />
  </span>
  <p class="so-rv-cap">{$_(`${TK}.caption`)}</p>
  <footer class="so-rv-foot">
    <span class="so-act">{$_(`${TK}.meta.approve`)}</span>
    <span class="so-meta">{$_(`${TK}.meta.edit`)}</span>
    <span class="so-when">{$_(`${TK}.meta.when`)}</span>
  </footer>
{/snippet}

{#snippet profileScreen()}
  <header class="so-pf-head">
    <span class="so-avatar"></span>
    <div class="so-pf-id">
      <b>flashcamp</b>
      <span>{$_(`${TK}.profile.bio`)}</span>
    </div>
  </header>

  <div class="so-pf-stats">
    <div><b>128</b><span>{$_(`${TK}.profile.posts`)}</span></div>
    <div>
      <b><AnimatedNum value={counted ? FOLLOWERS : 0} enter={false} format={compact} /></b>
      <span>{$_(`${TK}.profile.followers`)}</span>
    </div>
    <div>
      <b><AnimatedNum value={counted ? VIEWS : 0} enter={false} format={compact} /></b>
      <span>{$_(`${TK}.profile.views`)}</span>
    </div>
  </div>

  <div class="so-pf-grid">
    <span class="so-slot so-cell" data-slot="2">
      <img src={SHOT} alt="" loading="lazy" decoding="async" />
    </span>
    {#each WALL as src (src)}
      <span class="so-cell"><img {src} alt="" loading="lazy" decoding="async" /></span>
    {/each}
  </div>
{/snippet}

{#snippet screen(i: number)}
  {#if i === 0}{@render chatScreen()}{:else if i === 1}{@render reviewScreen()}{:else}{@render profileScreen()}{/if}
{/snippet}

<section class="so">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.title`)}</h2>
      <p>{$_(`${TK}.sub`)}</p>
    </div>

    <div class="so-grid" bind:this={root}>
      <ol class="so-steps">
        {#each STEPS as s, i (s)}
          <li class="so-step">
            <!-- L'osservatore guarda il testo, non il blocco che lo contiene: il blocco e' alto
                 mezzo schermo e il testo ci sta dentro dove serve, quindi la loro meta' non e' la
                 stessa cosa — e il passo attivo deve essere quello che si sta leggendo. -->
            <div class="so-txt" class:is-on={active === i} bind:this={steps[i]}>
              <span class="so-n">{i + 1}</span>
              <h3>{$_(`${TK}.${s}.title`)}</h3>
              <p>{$_(`${TK}.${s}.body`)}</p>
              {#if i === 0}
                <span class="so-cue" bind:this={cue} aria-hidden="true"></span>
              {/if}
            </div>

            <!-- La copia in colonna: esiste solo su schermo stretto, dove non c'e' niente di
                 incollato e ogni passo si porta la propria schermata. -->
            <article class="so-panel so-inline so-{SCREENS[i]}">
              {@render screen(i)}
            </article>
          </li>
        {/each}
      </ol>

      <div class="so-visual">
        <div class="so-stack" bind:this={stack}>
          <article class="so-panel so-chat" class:is-on={active === 0} aria-hidden={active !== 0}>
            {@render chatScreen()}
          </article>
          <article class="so-panel so-review" class:is-on={active === 1} aria-hidden={active !== 1}>
            {@render reviewScreen()}
          </article>
          <article class="so-panel so-profile" class:is-on={active === 2} aria-hidden={active !== 2}>
            {@render profileScreen()}
          </article>

          <!-- L'immagine, una sola, sopra tutte e tre. -->
          <img
            class="so-fly"
            class:is-out={flying}
            src={SHOT}
            alt=""
            decoding="async"
            style="transform: translate3d({fly.x}px, {fly.y}px, 0); width: {fly.w}px; height: {fly.h}px; border-radius: {fly.r}px"
          />
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  /* Expo in-out con un filo di resistenza in coda: parte piano, prende velocita' in mezzo e si
     posa oltrepassando di un soffio la meta' prima di assestarsi. La stessa curva la usano il
     viaggio dell'immagine, la dissolvenza delle schermate e l'arrivo dell'anteprima: tre tempi
     diversi sulla stessa legge si leggono come un movimento solo, tre leggi diverse no. */
  .so {
    --fly-ease: cubic-bezier(0.82, 0, 0.12, 1.04);
    --fly-time: 900ms;
    padding: clamp(80px, 10vw, 150px) 0 clamp(30px, 4vw, 60px);
  }

  .so-grid {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(40px, 7vw, 110px);
    align-items: start;
    max-width: 1080px;
    margin: 0 auto;
  }

  /* La colonna dei passi e' deliberatamente alta: e' lei a dare alla scheda incollata lo spazio
     in cui restare ferma mentre il resto scorre. */
  .so-steps { list-style: none; margin: 0; padding: 0; }
  .so-step {
    min-height: 58vh;
    display: flex; flex-direction: column; justify-content: center;
  }
  .so-txt { opacity: 0.32; transition: opacity 420ms var(--fly-ease); }
  .so-txt.is-on { opacity: 1; }
  .so-cue { margin-top: auto; display: block; height: 1px; }
  .so-n {
    display: inline-grid; place-items: center;
    width: 30px; height: 30px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.14); color: var(--accent);
    font-size: 13px; font-weight: 700; margin-bottom: 18px;
  }
  .so-txt h3 {
    margin: 0 0 12px;
    font-size: clamp(1.5rem, 2.6vw, 2.1rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.12;
  }
  .so-txt p { margin: 0; color: var(--ink-soft); font-size: 1.05rem; line-height: 1.55; max-width: 34ch; }

  /* Un'altezza sola per tutte e tre, decisa qui e non dal contenuto: e' cosi' che il riquadro
     resta fermo mentre cambia schermata, ed e' anche il freno che impedisce alla foto di tirare
     la scheda oltre lo schermo. */
  .so-visual { position: sticky; top: 14vh; max-width: 430px; margin-inline: auto; }
  .so-stack { position: relative; display: grid; height: clamp(440px, 58vh, 560px); }

  .so-panel {
    grid-area: 1 / 1;
    display: flex; flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 26px;
    overflow: hidden;
    box-shadow: 0 40px 90px -60px rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity 620ms var(--fly-ease);
  }
  .so-panel.is-on { opacity: 1; pointer-events: auto; }
  /* La copia in colonna vive solo su schermo stretto. */
  .so-inline { display: none; }

  /* Le caselle non disegnano niente dove c'e' l'immagine volante: dicono dove va, e la loro
     geometria e' l'unica cosa che il codice legge. La foto dentro serve alla copia in colonna. */
  .so-slot { display: block; background: var(--paper-2); overflow: hidden; }
  .so-slot img { display: none; width: 100%; height: 100%; object-fit: cover; }
  .so-fly {
    position: absolute; top: 0; left: 0; z-index: 2;
    object-fit: cover; pointer-events: none;
    opacity: 0;
    transform-origin: top left;
    will-change: transform, width, height;
    transition:
      transform var(--fly-time) var(--fly-ease),
      width var(--fly-time) var(--fly-ease),
      height var(--fly-time) var(--fly-ease),
      border-radius var(--fly-time) var(--fly-ease),
      opacity 420ms ease;
  }
  .so-fly.is-out { opacity: 1; }

  /* 1 — la conversazione con la propria AI */
  .so-chat-head {
    display: flex; align-items: center; gap: 9px;
    padding: 14px 18px; border-bottom: 1px solid var(--line);
    font-size: 12.5px; font-weight: 600; color: var(--ink-soft);
  }
  .so-claude { width: 16px; height: 16px; color: #d97757; }
  .so-chat-body { flex: 1; padding: 18px; display: flex; flex-direction: column; gap: 13px; }
  .so-bubble {
    margin: 0; align-self: flex-end; max-width: 80%;
    font-size: 13.5px; line-height: 1.45; color: var(--ink);
    background: rgba(var(--accent-rgb), 0.12);
    border-radius: 14px 14px 4px 14px; padding: 10px 13px;
  }
  .so-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .so-chip {
    display: inline-flex; align-items: center; gap: 7px;
    font-family: var(--mono); font-size: 11px; color: var(--ink-soft);
    border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px;
  }
  .so-chip i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
  .so-line { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-soft); }
  .so-line.last { color: var(--ink); }

  .so-prev {
    margin-top: auto;
    display: flex; align-items: center; gap: 12px;
    opacity: 0; transform: translateY(10px);
    transition: opacity 520ms var(--fly-ease), transform 520ms var(--fly-ease);
  }
  .so-prev.is-out { opacity: 1; transform: none; }
  .so-prev-slot { width: 78px; height: 98px; border-radius: 14px; flex: none; }
  .so-prev-txt { font-size: 12.5px; line-height: 1.4; color: var(--ink-soft); }

  /* 2 — la richiesta di approvazione */
  .so-rv-head { display: flex; align-items: center; gap: 9px; padding: 14px 16px; }
  .so-plat {
    width: 26px; height: 26px; border-radius: 8px; flex: none;
    display: inline-grid; place-items: center;
  }
  .so-plat svg { width: 15px; height: 15px; }
  .so-rv-head b { font-size: 14px; }
  .so-badge {
    margin-left: auto;
    font-size: 11px; font-weight: 650;
    padding: 4px 10px; border-radius: 999px;
    background: rgba(var(--accent-rgb), 0.13); color: var(--accent-ink);
  }
  .so-rv-slot { flex: 1; min-height: 0; width: 100%; }
  .so-rv-cap { margin: 0; padding: 15px 18px 4px; font-size: 14px; line-height: 1.5; color: var(--ink); }
  .so-rv-foot { display: flex; align-items: center; gap: 12px; padding: 12px 18px 18px; flex-wrap: wrap; flex: none; }
  .so-act {
    font-size: 13px; font-weight: 600;
    background: var(--ink); color: var(--paper);
    padding: 8px 18px; border-radius: 999px;
  }
  .so-meta { font-size: 12.5px; color: var(--ink-faint); }
  .so-when { font-size: 12.5px; color: var(--ink-faint); margin-left: auto; }

  /* 3 — il post pubblicato, visto dal profilo */
  .so-pf-head { display: flex; align-items: center; gap: 13px; padding: 18px 18px 14px; }
  .so-avatar {
    width: 52px; height: 52px; border-radius: 50%; flex: none;
    background: linear-gradient(135deg, var(--accent-2), var(--accent));
  }
  .so-pf-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .so-pf-id b { font-size: 14.5px; }
  .so-pf-id span { font-size: 12.5px; color: var(--ink-soft); line-height: 1.35; }

  .so-pf-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    padding: 0 18px 16px; border-bottom: 1px solid var(--line);
  }
  .so-pf-stats div { display: flex; flex-direction: column; gap: 2px; }
  .so-pf-stats b { font-size: 16px; font-weight: 650; color: var(--ink); font-variant-numeric: tabular-nums; }
  .so-pf-stats span { font-size: 11.5px; color: var(--ink-faint); }

  .so-pf-grid {
    flex: 1; min-height: 0; overflow: hidden;
    display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: min-content;
    gap: 2px; padding: 2px;
  }
  .so-cell { display: block; overflow: hidden; aspect-ratio: 4 / 5; }
  .so-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* ---------- Una colonna: niente di incollato, niente che copra niente ----------
     Ogni passo e' il suo testo e poi la sua schermata, una dopo l'altra. La scheda ferma a destra
     e l'immagine che vola sono grammatica da due colonne: qui non esistono, e le caselle tornano
     a contenere la loro foto. */
  @media (max-width: 900px) {
    .so-grid { grid-template-columns: 1fr; gap: 0; }
    .so-visual { display: none; }
    .so-step { min-height: 0; display: block; padding-bottom: clamp(48px, 10vw, 80px); }
    /* Su una colonna tutto sta sull'asse centrale: numero, titolo, testo e schermata. Allineare
       a sinistra una colonna sola lascia un margine destro che sembra un errore di impaginazione. */
    .so-txt { opacity: 1; text-align: center; }
    .so-txt p { max-width: 34ch; margin-inline: auto; }

    .so-inline {
      display: flex; opacity: 1; pointer-events: auto;
      margin: 22px auto 0; max-width: 430px; text-align: left;
    }
    .so-slot img { display: block; }
    .so-prev { opacity: 1; transform: none; }
    .so-rv-slot { flex: none; aspect-ratio: 4 / 5; }
    .so-pf-grid { flex: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .so { --fly-time: 0ms; }
    .so-panel, .so-prev { transition: opacity 200ms linear; transform: none; }
    .so-fly { transition: opacity 200ms linear; }
  }
</style>
