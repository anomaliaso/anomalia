<script lang="ts">
  // Un disegno solo, in inchiostro neutro: la palla è `currentColor` e i tratti una variabile
  // CSS, quindi un colore è un valore di stylesheet (e un hex in DB), mai un secondo SVG.
  // Cambiare `face` MORFA l'espressione: le spec sono numeri, interpolati e riproiettati a ogni
  // frame ($lib/avatar-morph). Con reduced-motion resta il cross-fade.
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import {
    AVATAR_FACE_SPECS,
    LOADING_FACE_MS,
    avatarBeatAt,
    loadingFaceAt,
    adaptAvatarColor,
    avatarFeatureColor,
    decalTransform,
    normalizeAvatarColor,
    normalizeAvatarFace,
    THEME_AVATAR_COLOR,
    type AgentAvatarFace,
    type AvatarBeat,
    type AvatarMove
  } from '$lib/agent-avatars';
  import {
    MORPH_MS,
    applyMorph,
    createMorphFrame,
    easeInOutExpo,
    morphArcPath,
    planMorph,
    toMorphSpec,
    type MorphSpec
  } from '$lib/avatar-morph';
  import { isDarkTheme } from '$lib/stores/theme';

  let {
    face = 'wide',
    color = '#111111',
    size = 36,
    title = null,
    /** Gentle breathing while the agent is working. */
    busy = false,
    /**
     * Il ciclo di streaming: morfa fra le facce a riposo finché è true, e sveglia lo sguardo che
     * insegue il puntatore. Sovrascrive `face`; con reduced-motion la faccia resta ferma.
     */
    cycle = false,
    /**
     * Una vita propria SOPRA il ciclo: espressioni a intervalli irregolari e ogni tanto una mossa
     * vistosa. Solo per l'avatar grande in chat — in sidebar sarebbe rumore. Richiede `cycle`.
     */
    alive = false,
    /**
     * Sguardo verso il basso (negativo: in alto) — il gemello verticale di `spec.yaw`, stessa
     * unità e stessa proiezione: i tratti scorrono sulla palla, la testa non si inclina. ~6 è
     * quanto lo yaw arriva di lato.
     */
    pitch = 0,
    /** `'pointer'`: lo sguardo segue il caret mentre si scrive, il puntatore altrimenti. Spento
     * di default — gli altri avatar sono glifi da 17-36px in una lista, non hanno cosa guardare. */
    follow = 'none',
    /** Riflette la faccia sull'asse verticale (tutte guardano a destra di default). Applicato
     * alla SORGENTE, mai come CSS scaleX: vedi `flip`. */
    mirror = false,
    /** Quanto lontano arriva lo sguardo, come frazione dell'ampiezza piena. Serve al parallasse
     * della pila in finto 3D: stesso vettore, stesso rAF, solo un numero diverso. */
    gazeAmount = 1,
    /** Quota della distanza residua coperta per frame: più basso = più inerzia. */
    gazeEase = 0.16
  }: {
    face?: AgentAvatarFace | string | null;
    color?: string | null;
    size?: number;
    title?: string | null;
    busy?: boolean;
    cycle?: boolean;
    alive?: boolean;
    pitch?: number;
    follow?: 'none' | 'pointer';
    mirror?: boolean;
    gazeAmount?: number;
    gazeEase?: number;
  } = $props();

  // Il loop vive qui e non nei chiamanti, così ogni avatar occupato suona la stessa animazione.
  // null = non cicla (spento, SSR o reduced-motion) → la `face` a riposo resta ferma.
  // La faccia del passo viene da `loadingFaceAt` (pura, pinnata dai test); qui c'è solo il timer,
  // che avanza di LOADING_FACE_MS sintetici invece di leggere l'orologio: un tick in ritardo non
  // salta mai una posa.
  let loopFace = $state<AgentAvatarFace | null>(null);
  // La mossa grande in corso: una classe sul <g>, quindi una keyframe CSS che il compositor fa
  // girare da sola e che si spegne su `animationend` — nessun secondo timer.
  let move = $state<AvatarMove | null>(null);
  $effect(() => {
    if (!cycle || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      loopFace = null;
      move = null;
      return;
    }
    if (!alive) {
      let step = 0;
      loopFace = loadingFaceAt(0);
      const id = setInterval(() => {
        step += 1;
        loopFace = loadingFaceAt(step * LOADING_FACE_MS);
      }, LOADING_FACE_MS);
      return () => clearInterval(id);
    }

    // Il ritmo irregolare: UN solo timeout alla volta, riarmato dal battito appena suonato
    // con la durata che il battito stesso chiede (`avatarBeatAt`). Non un intervallo fisso,
    // e non un timer per tratto. Il seme nasce qui, quindi due attese non si somigliano.
    const el = svgEl;
    const seed = Math.floor(Math.random() * 1e9);
    const t0 = performance.now();
    let step = 0;
    let prev: AvatarBeat | null = null;
    let timer = 0;

    const beat = () => {
      timer = 0;
      const b = avatarBeatAt(step++, seed, performance.now() - t0, prev);
      prev = b;
      loopFace = b.face;
      if (b.move) move = b.move;
      timer = window.setTimeout(beat, b.holdMs);
    };

    // Fuori schermo o scheda in secondo piano non si recita per nessuno: si ferma tutto e si
    // riprende dal battito dopo. `elapsedMs` resta il tempo dell'ATTESA, non del recitato.
    let onScreen = true;
    const awake = () => onScreen && document.visibilityState === 'visible';
    const sync = () => {
      if (awake()) {
        if (!timer) beat();
      } else if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };
    const io = el
      ? new IntersectionObserver(([e]) => {
          onScreen = e.isIntersecting;
          sync();
        })
      : null;
    io?.observe(el!);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      if (timer) clearTimeout(timer);
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      move = null;
    };
  });
  const shape = $derived(loopFace ?? normalizeAvatarFace(face));
  // `theme` hands the colours over to the stylesheet, so the ball inverts in dark mode.
  const themed = $derived(color === THEME_AVATAR_COLOR);
  // A saved hex that would sink into the page gets lifted off it — the stored value stands.
  const fill = $derived(adaptAvatarColor(normalizeAvatarColor(color), $isDarkTheme));
  const ink = $derived(avatarFeatureColor(fill));
  const spec = $derived(AVATAR_FACE_SPECS[shape]);

  // La spec d'arrivo in forma canonica (dot e capsule collassati in blob): è ciò che si
  // disegna da fermi, e la destinazione di ogni tween.
  const target = $derived(toMorphSpec(spec));
  // Il frame del tween in corso, o null da fermi. $state PROFONDO di proposito: il rAF muta i
  // numeri dentro il proxy e Svelte ridisegna solo gli attributi toccati — nessuna riallocazione
  // per frame.
  let tween = $state<MorphSpec | null>(null);
  const drawn = $derived(tween ?? target);

  // Il gate di accessibilità: con reduced-motion il template tiene il cross-fade di prima.
  let reduced = $state(false);
  $effect(() => {
    reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });

  // La spec da cui si parte, tenuta a mano. NON si legge `drawn`: quando l'effect gira, `target`
  // ha GIÀ il volto d'arrivo (i derived si aggiornano prima degli effect), quindi da fermi `drawn`
  // è la destinazione e il piano era da X a X — nessun movimento, cioè il cambio di botto.
  // Da fermi la sorgente è l'ultima spec approdata; a tween in corso, il frame vivo, così i
  // cambi concatenati riprendono da dove sta il disegno invece di scattare.
  // null = primo giro dell'effect: si registra la faccia e basta, il morph parte dal cambio dopo.
  let shownShape: AgentAvatarFace | null = null;
  let shownSpec: MorphSpec | null = null;
  let morphRaf = 0;
  $effect(() => {
    const next = shape; // unica dipendenza tracciata: il tween riparte solo al cambio di faccia
    if (next === shownShape) return;
    const first = shownShape === null;
    shownShape = next;
    const to = toMorphSpec(AVATAR_FACE_SPECS[next]);
    // `untrack` deve avvolgere anche lo SNAPSHOT, non solo la lettura del tween: la copia
    // attraversa il proxy proprietà per proprietà, e fuori da untrack quelle letture iscrivono
    // l'effect al tween che sta per creare — si auto-invalida e la cleanup cancella il rAF prima
    // del PRIMO frame (morph mai partito, occhi a dimensione zero).
    const from = untrack(() => (tween ? ($state.snapshot(tween) as MorphSpec) : shownSpec));
    shownSpec = to;
    if (first || !from) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      tween = null;
      return;
    }
    const plan = planMorph(from, to);
    tween = createMorphFrame(plan);
    // Anche questa lettura va untracked, stessa trappola: leggere `tween` qui lo rende una
    // dipendenza dell'effect che lo ha appena scritto. Serve il proxy e non l'oggetto grezzo, o
    // le mutazioni del rAF non ridisegnerebbero nulla.
    const frame = untrack(() => tween)!; // il proxy reattivo: applyMorph scrive qui
    // L'orologio parte al PRIMO FRAME, non qui. Fra l'effect e il primo rAF può passare molto:
    // scheda in secondo piano (dove il rAF non gira affatto), avatar fuori schermo, o il thread
    // occupato — cioè esattamente il turno di un agente. Timbrando `t0` adesso, quel ritardo si
    // mangia il morph: il primo frame arriva già oltre MORPH_MS, t vale 1 e il cambio è di botto.
    let t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / MORPH_MS);
      applyMorph(plan, easeInOutExpo(t), frame);
      if (t < 1) {
        morphRaf = requestAnimationFrame(step);
      } else {
        // A fine corsa il frame coincide con la spec d'arrivo: tornare a `target` non salta.
        morphRaf = 0;
        tween = null;
      }
    };
    morphRaf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(morphRaf);
  });

  /**
   * Il mirror è un SEGNO su ogni quantità in x che entra nella proiezione (offset del tratto,
   * yaw, roll della palla, tilt di una capsula). Mai un CSS `scaleX(-1)` sull'<svg>: rifletterebbe
   * il disegno DOPO che decalTransform l'ha già scorciato per l'altro lato, e l'occhio chiuso di
   * `wink` finirebbe dove il disegno mette quello aperto.
   *
   * `gazeX` NON è riflesso — vedi il frame loop.
   */
  const flip = $derived(mirror ? -1 : 1);

  // Following is the same mechanism as `spec.yaw`, on both axes: arc length added to a
  // feature's x and y before decalTransform wraps it onto the ball. Nothing rotates — the
  // features ride the surface, narrow as they near the limb, and the head reads as turning.

  /**
   * Quanto può oscillare lo sguardo, nelle stesse unità di arco: metà dello yaw che le facce già
   * portano, così il punto più lontano resta dentro il MAX_ANGLE di decalTransform e un puntatore
   * all'angolo satura sul tanh invece di parcheggiare un occhio sul bordo.
   * `agent-avatars.gaze.test.ts` tiene quel margine contro facce nuove.
   */
  const GAZE_ARC = 4;
  /** Distance at which the swing is ~76% of GAZE_ARC; tanh does the saturating. */
  const GAZE_REACH = 260;
  /** How far inside the focused field's edge to aim, so it is not the literal corner. */
  const FIELD_INSET = 14;

  let gazeX = $state(0);
  let gazeY = $state(0);
  let svgEl = $state<SVGSVGElement | null>(null);

  const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

  // Col ciclo di caricamento la testa si muove anche senza `follow`. Booleano derivato apposta:
  // cambia valore solo on/off, non a ogni passo del ciclo.
  const wander = $derived(loopFace !== null);

  // `$effect` è la guardia SSR: sul server non gira mai, quindi niente import di `browser`.
  $effect(() => {
    const el = svgEl;
    if ((follow !== 'pointer' && !wander) || !el) return;
    // Continuous tracking is precisely what this setting exists to stop: hold the rest pose.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let px = 0;
    let py = 0;
    let havePointer = false;
    let field: HTMLInputElement | HTMLTextAreaElement | null = null;
    let x = 0;
    let y = 0;
    let frame = 0;

    /** Where the caret is, near enough: the end of the text, or the start of an empty field. */
    const caretEnd = (f: HTMLInputElement | HTMLTextAreaElement) => {
      const r = f.getBoundingClientRect();
      // ponytail: the corner the caret is heading for, not the caret pixel. Interpolating the
      // real caret x needs a mirrored measuring element; nobody can tell at 64px.
      return f.value
        ? ([r.right - FIELD_INSET, r.bottom - FIELD_INSET] as const)
        : ([r.left + FIELD_INSET, r.top + Math.min(FIELD_INSET, r.height / 2)] as const);
    };

    const tick = () => {
      frame = 0;
      // ponytail: one rect read per frame, on one element, and only while the loop is awake.
      const [ax, ay] = centre(el.getBoundingClientRect());
      // A focused field OWNS the gaze: while they write, the face watches the writing and the
      // pointer is ignored outright. It goes back to the pointer on blur, not on a timer.
      const watching = !!field && field.isConnected;
      const at = watching
        ? caretEnd(field as HTMLInputElement | HTMLTextAreaElement)
        : havePointer
          ? ([px, py] as const)
          : null;
      // The gaze is NOT flipped by `mirror`: the face is reflected, but it still has to point
      // at the real pointer on the real screen, so this term stays in screen space.
      const arc = GAZE_ARC * gazeAmount;
      const tx = at ? arc * Math.tanh((at[0] - ax) / GAZE_REACH) : 0;
      const ty = at ? arc * Math.tanh((at[1] - ay) / GAZE_REACH) : 0;

      // Smorzamento: quota della distanza residua coperta per frame. Più bassa = più inerzia.
      const ease = gazeEase;
      x += (tx - x) * ease;
      y += (ty - y) * ease;
      const settled = Math.abs(tx - x) < 0.01 && Math.abs(ty - y) < 0.01;
      if (settled) {
        x = tx;
        y = ty;
      }
      gazeX = x;
      gazeY = y;
      // Keep the loop only while it still has somewhere to go, or while the target can move.
      if (!settled || watching) frame = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      // Un frame per paint, e niente jitter che non muoverebbe gli occhi.
      if (havePointer && Math.abs(e.clientX - px) < 2 && Math.abs(e.clientY - py) < 2) return;
      px = e.clientX;
      py = e.clientY;
      havePointer = true;
      kick();
    };

    // focusin/focusout, non focus/blur: solo questi fanno bubble, quindi una coppia di listener
    // sulla window copre ogni campo della pagina.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      field =
        t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement ? t : null;
      kick();
    };
    // Fires before the next focusin, so moving between two fields still lands on the new one.
    const onFocusOut = () => {
      field = null;
      kick();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
      if (frame) cancelAnimationFrame(frame);
      gazeX = 0;
      gazeY = 0;
    };
  });

  /** Il vecchio cambio a dissolvenza: resta come comportamento per reduced-motion. */
  function crossFade(_node: Element, { duration = 260 }): TransitionConfig {
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t}; transform: scale(${0.82 + 0.18 * t});`
    };
  }
</script>

<svg
  bind:this={svgEl}
  class="agent-avatar"
  class:busy
  class:themed
  viewBox="0 0 40 40"
  width={size}
  height={size}
  style="--avatar-morph-ms: {MORPH_MS}ms; {themed ? '' : `color: ${fill}; --avatar-ink: ${ink}`}"
  role={title ? 'img' : 'presentation'}
  aria-label={title ?? undefined}
  aria-hidden={title ? undefined : 'true'}
>
  <circle cx="20" cy="20" r="20" fill="currentColor" />

  <!-- Un dot è un blob con w = h (rect arrotondato = cerchio), quindi occhio tondo e occhio
       chiuso si disegnano — e si morfano — con lo stesso nodo. -->
  {#snippet facePaint(s: MorphSpec)}
    <g transform="rotate({flip * s.roll} 20 20)">
      {#each s.features as f, i (i)}
        <g
          transform={decalTransform(
            flip * (f.x + s.yaw) + gazeX,
            f.y + pitch + gazeY,
            f.kind === 'blob' ? flip * f.tilt : 0
          )}
        >
          {#if f.kind === 'blob'}
            <rect x={-f.w / 2} y={-f.h / 2} width={f.w} height={f.h} rx={Math.min(f.w, f.h) / 2} />
          {:else}
            <path
              d={morphArcPath(f)}
              fill="none"
              stroke="var(--avatar-ink)"
              stroke-width={f.weight}
              stroke-linecap="round"
            />
          {/if}
        </g>
      {/each}
    </g>
  {/snippet}

  {#if reduced}
    <!-- Reduced-motion: niente morph né tween — il cross-fade di sempre fra pose ferme. -->
    {#key shape}
      <g class="face" in:crossFade={{ duration: 280 }} out:crossFade={{ duration: 200 }}>
        {@render facePaint(target)}
      </g>
    {/key}
  {:else}
    <!-- La mossa grande sta QUI, come trasformazione CSS del volto intero, e lo sguardo resta
         dentro come offset delle feature: due strati diversi, quindi si compongono invece di
         contendersi la stessa trasformazione. Il respiro (`.busy`) scala l'<svg>, non il <g>. -->
    <g
      class="face"
      class:nod={move === 'nod'}
      class:tilt={move === 'tilt'}
      class:stretch={move === 'stretch'}
      onanimationend={() => (move = null)}
    >
      {@render facePaint(drawn)}
    </g>
  {/if}
</svg>

<style>
  .agent-avatar {
    /* La bezier che approssima expo in-out, la stessa curva del rAF; la durata la passa
       l'inline style da MORPH_MS, così il numero vive in un posto solo. */
    --avatar-morph-ease: cubic-bezier(0.87, 0, 0.13, 1);
    display: block;
    flex: none;
    /* Cambiare agente cambia faccia E colore: la faccia la morfa il rAF, il colore lo fa la
       CSS sulla stessa durata e sulla stessa curva (MORPH_MS, expo in-out), o la palla
       scatterebbe mentre gli occhi scivolano. */
    transition: color var(--avatar-morph-ms) var(--avatar-morph-ease);
  }
  /* Theme-bound avatar: ink ball, paper features — both flip with dark mode. */
  .agent-avatar.themed {
    color: var(--ink, #1d1d1f);
    --avatar-ink: var(--paper, #ffffff);
  }
  .face {
    fill: var(--avatar-ink);
    transition: fill var(--avatar-morph-ms) var(--avatar-morph-ease);
    /* The cross-fade scales about the middle of the ball, not the corner of the box. */
    transform-box: view-box;
    transform-origin: 20px 20px;
  }
  .agent-avatar.busy {
    /* Slower and shallower than before: the face cycle carries the movement now. */
    animation: avatar-breathe 2.4s ease-in-out infinite;
  }
  /* Le mosse grandi di `alive`: una per volta, una passata sola, poi `animationend` toglie la
     classe. Niente giravolta a 360°: dentro una riga da 28px legge come uno spinner. */
  .face.nod {
    animation: avatar-nod 700ms ease-in-out;
  }
  .face.tilt {
    animation: avatar-tilt 800ms ease-in-out;
  }
  .face.stretch {
    animation: avatar-stretch 1000ms ease-in-out;
  }
  @keyframes avatar-nod {
    0%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(2.6px) scale(0.97);
    }
  }
  @keyframes avatar-tilt {
    0%,
    100% {
      transform: rotate(0deg);
    }
    35% {
      transform: rotate(-16deg);
    }
    70% {
      transform: rotate(7deg);
    }
  }
  @keyframes avatar-stretch {
    0%,
    100% {
      transform: scale(1);
    }
    35% {
      transform: scale(1.1) translateY(-1.5px);
    }
    70% {
      transform: scale(0.95);
    }
  }
  @keyframes avatar-breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-avatar.busy,
    /* Doppio giro di chiave: il loop di `alive` non parte nemmeno (vedi l'effect), e una classe
       rimasta appesa da prima del cambio di preferenza qui non si muove. */
    .face.nod,
    .face.tilt,
    .face.stretch {
      animation: none;
    }
    .agent-avatar,
    .face {
      transition: none;
    }
  }
</style>
