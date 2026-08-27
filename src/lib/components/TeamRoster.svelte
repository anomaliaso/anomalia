<script lang="ts">
  // La squadra sulla homepage è la STESSA del prodotto, non un disegno di marketing:
  // l'ordine viene da TEAM_SPECIALIST_IDS e i volti da BUILTIN_AGENT_AVATARS, gli stessi due
  // moduli che vestono gli agenti dentro l'app. Se domani entra un sesto specialista o
  // cambia una faccia, questa sezione lo mostra senza che nessuno la tocchi — ed è
  // impossibile che la homepage prometta un agente che in chat non esiste.
  //
  // Entrambi i moduli sono client-safe (nessun import server, nessuno store dell'app):
  // le etichette invece vivono in `$lib/server/chat/agents.ts` e non sono importabili da
  // qui, quindi nome e descrizione sono stringhe i18n — che è comunque quello che serve
  // a una pagina in quattro lingue.
  import { _ } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS, DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';
  import { TEAM_SPECIALIST_IDS, JOB_OWNERS, type OwnerJobKey, type TeamAgentId } from '$lib/agent-owners';

  // Quante routine ricorrenti possiede ciascuno. Non è un numero scritto a mano: è la
  // conta vera di JOB_OWNERS, così la card non può dire "3 routine" quando ne ha 2.
  const ROUTINES: Record<string, number> = TEAM_SPECIALIST_IDS.reduce(
    (acc, id) => {
      acc[id] = (Object.keys(JOB_OWNERS) as OwnerJobKey[]).filter((j) => JOB_OWNERS[j] === id).length;
      return acc;
    },
    {} as Record<string, number>
  );

  const avatarFor = (id: TeamAgentId) => BUILTIN_AGENT_AVATARS[id] ?? DEFAULT_CHAT_AGENT_AVATAR;

  // ── Lo sguardo, e da che parte è girata la testa ────────────────────────────────────────
  // Nessun'animazione nuova: `follow="pointer"` accende lo STESSO rAF che la Panoramica già usa
  // dentro AgentAvatar (gaze + smorzamento), e `mirror` specchia la faccia alla sorgente. Qui
  // c'è solo il quando (in vista, e solo con un puntatore vero) e il chi (chi sta a destra).
  let listEl = $state<HTMLUListElement | null>(null);
  let live = $state(false);
  /** Per card: sta a destra del centro della lista? Misurato, non dedotto dall'indice. */
  let mirrored = $state<boolean[]>([]);

  // `$effect` è già la guardia SSR: sul server non gira.
  $effect(() => {
    const el = listEl;
    if (!el) return;

    // La linea dello specchio è il centro VERO della lista, e il lato lo decide il centro della
    // card, non quello dell'avatar (che sta appoggiato a sinistra dentro la card). Così la
    // regola sopravvive ai breakpoint: nella riga da 3 la card di mezzo cade sulla linea e resta
    // non specchiata, in colonna singola ci cadono tutte. Niente tabella di indici da tenere
    // allineata alla CSS.
    const measure = () => {
      const r = el.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      mirrored = [...el.children].map((li) => {
        const c = li.getBoundingClientRect();
        return c.left + c.width / 2 - mid > 8;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    // Una pagina pubblica non fa girare un rAF per chi non sta guardando: fuori vista `follow`
    // torna a 'none', l'effect dentro AgentAvatar si smonta e lo sguardo torna a riposo.
    // Su touch non c'è puntatore da seguire: si resta nella posa composta invece di congelarsi
    // dove è finito l'ultimo trascinamento.
    // ponytail: matchMedia letto una volta — nessuno passa da trackpad a dito a metà scroll.
    const fine = window.matchMedia('(pointer: fine)').matches;
    const io = new IntersectionObserver(([e]) => (live = fine && e.isIntersecting));
    io.observe(el);

    return () => {
      ro.disconnect();
      io.disconnect();
      live = false;
    };
  });
</script>

<section class="team-sec">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_('landing.team.kicker')}</div>
      <h2>{$_('landing.team.title')} <span class="gr-accent">{$_('landing.team.titleAccent')}</span></h2>
      <p class="team-sub">{$_('landing.team.sub')}</p>
    </div>

    <ul class="team-grid" bind:this={listEl}>
      {#each TEAM_SPECIALIST_IDS as id, i (id)}
        {@const av = avatarFor(id)}
        <li class="team-card reveal" data-d={(i % 3) + 1}>
          <span class="team-face">
            <AgentAvatar
              face={av.face}
              color={av.color}
              size={56}
              follow={live ? 'pointer' : 'none'}
              mirror={mirrored[i] ?? false}
            />
          </span>
          <h3>{$_(`landing.team.${id}.name`)}</h3>
          <p class="team-role">{$_(`landing.team.${id}.role`)}</p>
          <p class="team-note">
            {#if ROUTINES[id] > 0}
              <span class="team-dot" aria-hidden="true"></span>
              {$_('landing.team.routines', { values: { count: ROUTINES[id] } })}
            {:else}
              {$_('landing.team.onDemand')}
            {/if}
          </p>
        </li>
      {/each}
    </ul>

    <p class="team-dm reveal">{$_('landing.team.dm')}</p>
  </div>
</section>

<style>
  .team-sec { padding: 84px 0 8px; }
  .team-sub {
    margin: 14px auto 0;
    max-width: 60ch;
    font-size: 1.05rem;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  /* Tre sopra, due sotto, e i due sotto CENTRATI: sei colonne, ogni card ne occupa due, e la
     seconda riga parte da mezza card più in là. Così il centro di ciascuna delle due cade
     esattamente sul vuoto fra due delle tre sopra — che è la forma voluta, e che una griglia da
     tre con a-capo automatico non dà mai.
     Le due regole valgono SOLO se gli specialisti sono esattamente cinque (`:nth-last-child`):
     con un sesto la lista torna da sola a tre per riga, invece di rompersi in silenzio. */
  .team-grid {
    list-style: none;
    margin: 44px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 16px;
  }
  .team-card { grid-column: span 2; }
  .team-card:nth-child(4):nth-last-child(2) { grid-column: 2 / span 2; }
  .team-card:nth-child(5):nth-last-child(1) { grid-column: 4 / span 2; }

  .team-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 26px 24px 24px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--paper-2);
    transition: border-color 0.25s var(--ease), transform 0.25s var(--ease);
  }
  .team-card:hover { border-color: var(--line-2); transform: translateY(-2px); }

  /* Il volto è un SVG a colori propri: il cerchio dietro lo stacca dalla card senza
     ridipingerlo. */
  .team-face {
    display: inline-flex;
    padding: 8px;
    border-radius: 50%;
    background: var(--paper);
    box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
  }

  .team-card h3 {
    margin: 18px 0 0;
    font-size: 1.06rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .team-role {
    margin: 7px 0 0;
    font-size: 0.94rem;
    line-height: 1.5;
    color: var(--ink-soft);
  }
  .team-note {
    margin: 16px 0 0;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.8rem;
    letter-spacing: 0.01em;
    color: var(--ink-faint);
  }
  .team-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex: 0 0 auto;
  }

  .team-dm {
    margin: 34px auto 0;
    max-width: 62ch;
    text-align: center;
    font-size: 0.98rem;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  /* Stretti, il 3+2 non ci sta: si torna alle colonne piene e le due regole di centratura
     vengono annullate, o la quarta card resterebbe rientrata di mezza colonna. */
  @media (max-width: 900px) {
    .team-grid { grid-template-columns: repeat(2, 1fr); }
    .team-card,
    .team-card:nth-child(4):nth-last-child(2),
    .team-card:nth-child(5):nth-last-child(1) { grid-column: auto; }
  }
  @media (max-width: 560px) {
    .team-sec { padding-top: 60px; }
    .team-grid { grid-template-columns: 1fr; gap: 12px; }
  }
</style>
