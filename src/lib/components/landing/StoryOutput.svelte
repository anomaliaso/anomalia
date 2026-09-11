<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { siClaude } from 'simple-icons';
  import { PLATFORM_META } from '$lib/components/platform-meta';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';

  /**
   * La prima cosa dopo la hero e' l'artefatto, non una spiegazione. E i tre passi non sono lo
   * stesso oggetto con un'etichetta diversa: sono tre schermate diverse, perche' nel prodotto
   * sono tre posti diversi — la conversazione con la tua AI, la richiesta di approvazione, il
   * profilo pubblico.
   *
   * A tenerle insieme c'e' UNA sola immagine. Non tre copie che appaiono e spariscono: un solo
   * elemento che vive sopra le schermate e si sposta nella casella che gli tocca — l'anteprima
   * nella chat, la foto del post in attesa, la cella del profilo. Le caselle sono vuote e servono
   * solo a dire dove: si misurano, e l'immagine ci va sopra. Cosi' il lettore segue lo stesso
   * oggetto invece di guardare tre schede che si alternano, che e' anche cio' che succede davvero.
   */
  const TK = 'landing.story.output';
  const STEPS = ['s1', 's2', 's3'] as const;
  const SHOT = '/showcase-gen/flashcamp-1.webp';

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
  let slots: HTMLElement[] = [];
  let cue = $state<HTMLElement | null>(null);
  let stack = $state<HTMLElement | null>(null);

  let fly = $state({ x: 0, y: 0, w: 0, h: 0, r: 12 });
  const flying = $derived(previewOut || active > 0);

  const RADII = [14, 0, 0];

  function place() {
    const box = stack?.getBoundingClientRect();
    const slot = slots[active]?.getBoundingClientRect();
    if (!box || !slot) return;
    fly = {
      x: slot.left - box.left,
      y: slot.top - box.top,
      w: slot.width,
      h: slot.height,
      r: RADII[active]
    };
  }

  $effect(() => {
    // Le due letture sono le dipendenze: a ogni cambio di passo (o all'arrivo dell'anteprima) si
    // rimisura la casella di destinazione, dopo che il DOM ha finito di aggiornarsi.
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
    // che si sta leggendo. Senza banda, due passi restano visibili insieme e il vincitore lo
    // sceglie l'ordine di callback, che non e' una regola.
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

    // Il segnale dell'anteprima sta in fondo al primo passo: entra nella meta' bassa dello schermo
    // solo quando quel passo e' quasi finito di scorrere.
    const cueIo = new IntersectionObserver(
      ([e]) => {
        previewOut = e.isIntersecting;
      },
      { rootMargin: '-58% 0px 0px 0px', threshold: 0 }
    );
    if (cue) cueIo.observe(cue);

    const ro = new ResizeObserver(() => place());
    if (stack) ro.observe(stack);
    place();

    return () => {
      io.disconnect();
      cueIo.disconnect();
      ro.disconnect();
    };
  });
</script>

<section class="so">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.title`)}</h2>
      <p>{$_(`${TK}.sub`)}</p>
    </div>

    <div class="so-grid">
      <ol class="so-steps">
        {#each STEPS as s, i (s)}
          <li bind:this={steps[i]} class="so-step" class:is-on={active === i}>
            <span class="so-n">{i + 1}</span>
            <h3>{$_(`${TK}.${s}.title`)}</h3>
            <p>{$_(`${TK}.${s}.body`)}</p>
            {#if i === 0}
              <span class="so-cue" bind:this={cue} aria-hidden="true"></span>
            {/if}
          </li>
        {/each}
      </ol>

      <div class="so-visual">
        <div class="so-stack" bind:this={stack}>
          <article class="so-panel so-chat" class:is-on={active === 0} aria-hidden={active !== 0}>
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
                <span class="so-slot so-prev-slot" bind:this={slots[0]}></span>
                <span class="so-prev-txt">{$_(`${TK}.chat.preview`)}</span>
              </div>
            </div>
          </article>

          <article class="so-panel so-review" class:is-on={active === 1} aria-hidden={active !== 1}>
            <header class="so-rv-head">
              <span class="so-plat" style="background:{PLATFORM_META.instagram.bg}">
                <svg viewBox="0 0 24 24" fill="#fff"><path d={PLATFORM_META.instagram.icon?.path} /></svg>
              </span>
              <b>@flashcamp</b>
              <span class="so-badge">{$_(`${TK}.state.approve`)}</span>
            </header>
            <span class="so-slot so-rv-slot" bind:this={slots[1]}></span>
            <p class="so-rv-cap">{$_(`${TK}.caption`)}</p>
            <footer class="so-rv-foot">
              <span class="so-act">{$_(`${TK}.meta.approve`)}</span>
              <span class="so-meta">{$_(`${TK}.meta.edit`)}</span>
              <span class="so-when">{$_(`${TK}.meta.when`)}</span>
            </footer>
          </article>

          <article class="so-panel so-profile" class:is-on={active === 2} aria-hidden={active !== 2}>
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
              <span class="so-slot so-cell" bind:this={slots[2]}></span>
              {#each WALL as src (src)}
                <span class="so-cell"><img {src} alt="" loading="lazy" decoding="async" /></span>
              {/each}
            </div>
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
  .so { padding: clamp(80px, 10vw, 150px) 0 clamp(30px, 4vw, 60px); }

  .so-grid {
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
    opacity: 0.32;
    transition: opacity 420ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .so-step.is-on { opacity: 1; }
  .so-cue { margin-top: auto; display: block; height: 1px; }
  .so-n {
    display: inline-grid; place-items: center;
    width: 30px; height: 30px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.14); color: var(--accent);
    font-size: 13px; font-weight: 700; margin-bottom: 18px;
  }
  .so-step h3 {
    margin: 0 0 12px;
    font-size: clamp(1.5rem, 2.6vw, 2.1rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.12;
  }
  .so-step p { margin: 0; color: var(--ink-soft); font-size: 1.05rem; line-height: 1.55; max-width: 34ch; }

  /* Un'altezza sola per tutte e tre, decisa qui e non dal contenuto: e' cosi' che il riquadro
     resta fermo mentre cambia schermata, ed e' anche il freno che impedisce alla foto di tirare
     la scheda oltre lo schermo. */
  .so-visual { position: sticky; top: 14vh; max-width: 430px; margin-inline: auto; }
  .so-stack { position: relative; display: grid; height: clamp(430px, 56vh, 540px); }

  /* Le tre schermate sono alte uguali — la riga della griglia le stira tutte alla piu' alta —
     cosi' il riquadro non cambia forma mentre cambia contenuto. */
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
    transition: opacity 520ms var(--ease, ease);
  }
  .so-panel.is-on { opacity: 1; pointer-events: auto; }

  /* Le caselle non disegnano niente: dicono dove va l'immagine, e la loro geometria e' l'unica
     cosa che il codice legge. Restano visibili come vuoto grigio solo il tempo di un caricamento. */
  .so-slot { display: block; background: var(--paper-2); }
  .so-fly {
    position: absolute; top: 0; left: 0; z-index: 2;
    object-fit: cover; pointer-events: none;
    opacity: 0;
    transform-origin: top left;
    transition:
      transform 820ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1)),
      width 820ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1)),
      height 820ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1)),
      border-radius 820ms var(--ease, ease),
      opacity 380ms ease;
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
    transition: opacity 420ms var(--ease, ease), transform 420ms var(--ease, ease);
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
    flex: 1; min-height: 0;
    display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr);
    gap: 2px; padding: 2px;
  }
  .so-cell { display: block; overflow: hidden; min-height: 0; }
  .so-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }

  @media (max-width: 900px) {
    .so-grid { grid-template-columns: 1fr; gap: 28px; }
    /* Su una colonna la scheda va in cima e i passi le scorrono sotto: incollarla piu' in basso
       la farebbe uscire dallo schermo proprio mentre cambia. */
    .so-visual { position: sticky; top: 72px; order: -1; width: 100%; }
    .so-step { min-height: 0; padding: 26px 0; opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .so-panel, .so-prev { transition: opacity 200ms linear; transform: none; }
    .so-fly { transition: opacity 200ms linear; }
  }
</style>
