<script lang="ts">
  /**
   * LA PILA IN FINTO 3D: uno davanti al centro, gli altri dietro, tutti che seguono il puntatore.
   *
   * Viveva dentro `ChatColumn` (la testata del composer con piu' destinatari) ed e' uscita di li'
   * quando l'onboarding ha dovuto mostrare gli stessi cinque specialisti: due copie della stessa
   * composizione divergono al primo ritocco, e questa e' gia' stata regolata a mano una volta
   * (niente sfocatura, il piu' a sinistra specchiato, il parallasse al posto della prospettiva).
   *
   * NON e' un secondo sistema di animazione: e' lo stesso rAF di `AgentAvatar`, chiamato con
   * `gazeAmount`/`gazeEase` diversi per chi sta dietro — arrivano meno lontano e in ritardo, ed
   * e' quel ritardo che si legge come profondita'. Con `prefers-reduced-motion` l'inseguimento
   * non parte affatto (guardia dentro `AgentAvatar`) e resta la composizione, ferma e composta.
   */
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import type { ThreadAgentAvatar } from '$lib/stores/chat';

  let {
    agents,
    /** Il diametro della faccia DAVANTI: tutto il resto e' una frazione di questa. */
    front = 64,
    pitch = 0,
    follow = 'none',
    /** Specchia la faccia davanti (la Panoramica lo fa; una hero centrata a tutta pagina no). */
    frontMirror = false
  }: {
    agents: ThreadAgentAvatar[];
    front?: number;
    pitch?: number;
    follow?: 'none' | 'pointer';
    frontMirror?: boolean;
  } = $props();

  type Slot = { x: number; y: number; s: number; o: number; mirror: boolean };

  /**
   * Le posizioni sono FRAZIONI della misura del primo, cosi' la composizione scala da sola.
   *
   * Il piu' a SINISTRA guarda a sinistra: le facce laterali si voltano verso l'esterno invece di
   * puntare tutte nella stessa direzione, che e' l'effetto "fila di cloni". `mirror` ribalta la
   * faccia alla SORGENTE (non un `scaleX` in CSS) e — per costruzione, vedi AgentAvatar — NON
   * specchia lo sguardo: l'inseguimento del cursore resta in coordinate schermo.
   *
   * Da 1 a 3 dietro sono i numeri gia' regolati per la Panoramica, invariati. Con QUATTRO dietro
   * (i cinque mestieri dell'onboarding) la piramide non regge: aggiungere una quarta faccia alla
   * disposizione a tre la sbilancia da un lato e le tre in basso diventano una fila. Quindi a
   * cinque la composizione cambia forma — due profondita' simmetriche, un arco che sale ai lati:
   * le medie si infilano dietro la prima, le lontane dietro le medie, e la profondita' si legge
   * nella catena che rincula invece che nella sola scala.
   */
  const BACK: Record<number, Slot[]> = {
    1: [{ x: 0.72, y: -0.06, s: 0.6, o: 0.76, mirror: false }],
    2: [
      { x: 0.72, y: -0.06, s: 0.6, o: 0.76, mirror: false },
      { x: -0.72, y: -0.06, s: 0.6, o: 0.76, mirror: true }
    ],
    3: [
      { x: 0.72, y: -0.06, s: 0.6, o: 0.76, mirror: false },
      { x: -0.72, y: -0.06, s: 0.6, o: 0.76, mirror: true },
      { x: 0, y: -0.6, s: 0.46, o: 0.64, mirror: false }
    ],
    4: [
      { x: 0.62, y: -0.12, s: 0.62, o: 0.82, mirror: false },
      { x: -0.62, y: -0.12, s: 0.62, o: 0.82, mirror: true },
      { x: 1.08, y: -0.42, s: 0.44, o: 0.6, mirror: false },
      { x: -1.08, y: -0.42, s: 0.44, o: 0.6, mirror: true }
    ]
  };

  const behind = $derived(agents.slice(1));
  // Oltre i quattro dietro si tiene l'ultima disposizione conosciuta e si taglia: meglio una
  // composizione giusta con una faccia in meno che cinque palle stipate in un arco a quattro.
  const slots = $derived(BACK[Math.min(Math.max(behind.length, 1), 4)]);
  /**
   * Disegnate dalla piu' LONTANA alla piu' vicina. Il posto di ciascuno resta quello assegnato
   * (il secondo agente sta in mezzo, non in fondo): cambia solo l'ordine di pittura, che e' cio'
   * che decide chi copre chi quando due si sovrappongono — con un solo `z-index` per tutti,
   * l'ordine del DOM metteva le lontane SOPRA le vicine, cioe' la profondita' al contrario.
   */
  const placed = $derived(
    behind
      .slice(0, slots.length)
      .map((a, i) => ({ a, slot: slots[i] }))
      .sort((p, q) => p.slot.s - q.slot.s)
  );
</script>

<span class="hero-3d" style="--front: {front}px">
  {#each placed as p (p.a.id)}
    <span class="hero-back" style="--x: {p.slot.x}; --y: {p.slot.y}; --o: {p.slot.o}">
      <AgentAvatar
        face={p.a.face}
        color={p.a.color}
        size={Math.round(front * p.slot.s)}
        {pitch}
        {follow}
        gazeAmount={p.slot.s * 0.62}
        gazeEase={0.05}
        mirror={p.slot.mirror}
        title={p.a.name}
      />
    </span>
  {/each}
  <span class="hero-front">
    <AgentAvatar
      face={agents[0].face}
      color={agents[0].color}
      size={front}
      {pitch}
      {follow}
      mirror={frontMirror}
      title={agents[0].name}
    />
  </span>
</span>

<style>
  .hero-3d {
    position: relative;
    display: inline-flex;
    justify-content: center;
    flex: none;
  }
  .hero-front {
    position: relative;
    z-index: 2;
    display: inline-flex;
  }
  /* Profondità SUGGERITA, e senza sfocatura: le facce dietro restano NITIDE. Il distacco lo
     fanno la scala, l'offset, un filo di trasparenza e soprattutto il parallasse — arrivano
     meno lontano e in ritardo. Un blur su una palla di 40px non dice "lontano", dice
     "immagine sbagliata". */
  .hero-back {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 1;
    display: inline-flex;
    transform: translate(-50%, -50%)
      translate(calc(var(--x) * var(--front)), calc(var(--y) * var(--front)));
    opacity: var(--o);
    pointer-events: none;
  }
</style>
