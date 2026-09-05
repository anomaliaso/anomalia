<script lang="ts">
  // Gli agenti che hanno lavorato in una chat, in due rese diverse.
  //
  // `layout="row"` (default) — la fila sovrapposta di sempre: serve dove lo spazio in
  //   larghezza c'è, e le facce devono restare grandi (l'hero della chat vuota).
  // `layout="cluster"` — le facce dentro il perimetro di UN avatar singolo: la riga della
  //   sidebar ha una colonna avatar sola e la fila la sfondava, spostando nome, orario e
  //   anteprima di qualche pixel a seconda di quanti agenti c'erano. Nel cluster
  //   l'ingombro è identico a quello di un `AgentAvatar` della stessa `size`, sempre,
  //   da 1 a 4+ membri: la riga non si muove mai.
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import type { ThreadAgentAvatar } from '$lib/agent-avatars';
  import { hoverFaceFor } from '$lib/agent-avatars';

  let {
    agents,
    /**
     * In `row` è il diametro di UNA faccia (la fila poi è più larga).
     * In `cluster` è il lato dello spazio TOTALE — cioè lo stesso numero che daresti a un
     * `AgentAvatar` singolo al suo posto; le facce dentro si rimpiccioliscono da sole.
     */
    size = 16,
    max = 3,
    layout = 'row',
    /** Under the cursor the whole row perks up, each avatar with its own expression. */
    hovered = false
  }: {
    agents: ThreadAgentAvatar[];
    size?: number;
    max?: number;
    layout?: 'row' | 'cluster';
    hovered?: boolean;
  } = $props();

  const label = $derived(agents.map((a) => a.name).join(' · '));

  // ── Fila ──────────────────────────────────────────────────────────────
  const shown = $derived(agents.slice(0, max));
  const extra = $derived(Math.max(agents.length - shown.length, 0));
  // Overlap by a fifth: enough to read as a group, little enough to tell them apart at 15px.
  const step = $derived(Math.round(size * 0.78));

  // ── Cluster ───────────────────────────────────────────────────────────
  // Quattro posti al massimo: oltre, il quarto diventa il chip +N. Cinque palle in 34px
  // sarebbero coriandoli, non facce.
  const cShown = $derived(agents.length > 4 ? agents.slice(0, 3) : agents.slice(0, 4));
  const cExtra = $derived(agents.length - cShown.length);
  const cCount = $derived(cShown.length + (cExtra > 0 ? 1 : 0));

  /**
   * Disposizioni e misure, per numero di occupanti. `f` è la frazione del lato che prende
   * una faccia; `at` sono le posizioni in frazione dello spazio libero (lato − faccia),
   * quindi 0 = attaccato a un bordo, 1 = all'altro, e il gruppo riempie sempre tutto il
   * quadrato senza sbordare.
   *
   * Le frazioni sono scelte perché le palle NON si sovrappongano, e resti fra loro ~2px di
   * fondo riga: è quello che le stacca, al posto dell'anello che usa la fila. L'anello qui
   * sarebbe sbagliato due volte — è dipinto in un colore fisso mentre il fondo della riga
   * cambia (hover, riga aperta), e a queste misure morde 1.5px del volto accanto, che su una
   * palla da 16px è un occhio. Un vuoto vero funziona su qualsiasi fondo e non toglie niente.
   *
   * Il tetto è geometrico, non un gusto: due file dentro 34px non possono passare i 17px a
   * testa, e con il vuoto in mezzo restano 16. La faccia più magra del set è l'arco della
   * bocca, spesso il 7.5% della palla → 1.2px a 16px di palla: è la stessa misura a cui
   * questo componente è sempre stato usato di default (16px), e il minimo a cui una faccia
   * resta una faccia. Sotto, sarebbero macchie: per questo il quinto membro diventa "+N"
   * invece di rimpicciolire tutti.
   * In due, la diagonale è più generosa di una griglia: ci stanno 19px (21 su mobile).
   *
   * 2 → obliquo alto-sinistra ▸ basso-destra: è il verso di lettura, e soprattutto lascia
   *   una palla nell'angolo in basso a destra, dove la riga della sidebar ancora il pallino
   *   verde di presenza — sull'anti-diagonale il pallino galleggerebbe nel vuoto.
   * 3 → piramide (uno sopra centrato, due sotto).
   * 4 → 2×2 in ordine di lettura.
   */
  const CLUSTER: Record<number, { f: number; at: [number, number][] }> = {
    1: { f: 1, at: [[0, 0]] },
    2: { f: 0.56, at: [[0, 0], [1, 1]] },
    3: { f: 0.47, at: [[0.5, 0], [0, 1], [1, 1]] },
    4: { f: 0.47, at: [[0, 0], [1, 0], [0, 1], [1, 1]] }
  };
  const plan = $derived(CLUSTER[cCount] ?? CLUSTER[4]);
  const faceSize = $derived(Math.round(size * plan.f));
  const free = $derived(size - faceSize);
  const spotAt = (i: number) => {
    const [fx, fy] = plan.at[i] ?? [0, 0];
    return `left: ${(fx * free).toFixed(1)}px; top: ${(fy * free).toFixed(1)}px`;
  };
</script>

{#if layout === 'cluster'}
  <span
    class="agent-cluster"
    style="--box: {size}px; --face: {faceSize}px"
    title={label}
    aria-label={label}
  >
    {#each cShown as a, i (a.id)}
      <span class="spot" style={spotAt(i)}>
        <AgentAvatar face={hovered ? hoverFaceFor(a.id) : a.face} color={a.color} size={faceSize} />
      </span>
    {/each}
    {#if cExtra > 0}
      <span class="spot more" style={spotAt(cShown.length)}>+{cExtra}</span>
    {/if}
  </span>
{:else}
  <span class="agent-stack" style="--size: {size}px; --step: {step}px" title={label} aria-label={label}>
    {#each shown as a, i (a.id)}
      <span class="slot" style={i === 0 ? undefined : `margin-left: calc(var(--step) - var(--size))`}>
        <AgentAvatar face={hovered ? hoverFaceFor(a.id) : a.face} color={a.color} {size} />
      </span>
    {/each}
    {#if extra}
      <span class="more row-more" style="margin-left: calc(var(--step) - var(--size))">+{extra}</span>
    {/if}
  </span>
{/if}

<style>
  .agent-stack {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .slot {
    display: inline-flex;
    border-radius: 50%;
    /* A ring in the sidebar's own background keeps overlapping balls apart. */
    box-shadow: 0 0 0 1.5px var(--sidebar, var(--sidebar-bg, var(--paper, #fff)));
  }
  .agent-cluster {
    position: relative;
    display: inline-block;
    flex: none;
    width: var(--box);
    height: var(--box);
    /* `vertical-align` perché il cluster sta in linea come l'avatar singolo che sostituisce. */
    vertical-align: middle;
  }
  .spot {
    position: absolute;
    display: inline-flex;
    /* Nessun anello: qui a separare è il vuoto fra le palle (vedi CLUSTER). */
  }
  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    box-shadow: 0 0 0 1.5px var(--sidebar, var(--sidebar-bg, var(--paper, #fff)));
    font-weight: 600;
    line-height: 1;
    opacity: 0.75;
  }
  .row-more {
    height: var(--size);
    min-width: var(--size);
    padding: 0 3px;
    font-size: calc(var(--size) * 0.56);
  }
  .spot.more {
    width: var(--face);
    height: var(--face);
    box-shadow: none;
    /* Più stretto della fila: il chip non può allargarsi, il quadrato è quello. */
    font-size: calc(var(--face) * 0.46);
  }
</style>
