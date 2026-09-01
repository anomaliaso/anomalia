<script lang="ts">
  // La chat del prodotto, in piccolo e da fermo: a sinistra la sidebar VERA (voci di nav, la
  // lista dei thread con volto/nome/anteprima/orario, la riga del brand in fondo — la stessa
  // forma di DashboardSidebar.svelte), a destra la conversazione. Cliccando un agente cambia
  // il caso d'uso: otto thread — cinque mestieri, due richieste di connessione e una stanza.
  //
  // Finto ma NON inventato. Ogni battuta corrisponde a una capacità che esiste nel codice oggi:
  //   content → produce_week + generate_image + approve_post, e il DM all'Analyst (message_agent)
  //   motion  → create_motion_video + generate_voiceover/cut_voiceover + generate_music +
  //             render_motion_video, con la craft review prima del render
  //   web     → run_seo_geo_audit (grade tipo "C+") + add_seo_initiatives + write_planned_article
  //             + schedule_article, più il controllo GEO
  //   analyst → la routine `weekly_recap` che scrive il suo report NEL thread del suo proprietario
  //             (team-ignition/agent-turns), più run_analytics_review
  //   ugc     → il budget parole dello script, il casting condiviso, review_video sullo standard
  //             organic e il ri-render della sola clip sbagliata (ugc-agent)
  //   connect → `propose_open_tab` verso Impostazioni › Account collegati: i social NON passano
  //             da Composio, si autorizzano lì, e finché non c'è il canale l'agente scrive ma
  //             non pubblica e non legge i numeri (sync_analytics per piattaforma)
  //   drive   → `propose_app_connection` (Composio) su GOOGLEDRIVE: il connettore di conoscenza
  //             che porta i documenti in `brand_documents` (knowledge-sources.ts). Chiede per
  //             SAPERE, non per fare — ed è l'alternativa all'inventare
  //   room    → la chat di gruppo (`chat/room.ts`): fino a 4 membri, massimo 2 voci per
  //             messaggio, sequenziali (la seconda legge la prima), e chi non ha niente da dire
  //             non lascia nessun messaggio — per questo nel thread non c'è nessuna riga
  //             "è rimasto zitto": nel prodotto non esiste
  //
  // Copiato a occhio e non importato: ChatDmChip/ChatToolChips/DashboardSidebar vogliono store,
  // tool-call vere e uno slug di brand. Qui serve solo il disegno — e una pagina marketing non
  // deve dipendere da file che la chat sta ancora cambiando. Volti e colori invece sono quelli
  // veri (BUILTIN_AGENT_AVATARS), perché quelli sì sono client-safe e non devono mentire. Le due
  // card di connessione ricalcano la forma vera: ChatConnectCard.svelte (logo + nome + pillola
  // ghost + motivo rientrato) e la riga `.open-tab-card` di ChatColumn.svelte (riga quieta
  // centrata, motivo sopra e azione in accent sotto).
  import { _ } from 'svelte-i18n';
  import { siGoogledrive } from 'simple-icons';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import AgentAvatarStack from '$lib/components/AgentAvatarStack.svelte';
  import HomeAgentPanel from '$lib/components/HomeAgentPanel.svelte';
  import { BUILTIN_AGENT_AVATARS, DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';

  type Card = { img: string; title: string; sub: string; more?: string };
  type Beat =
    | { k: 'user'; t: string }
    /** `who` = chi parla, e serve solo in stanza: altrove è sempre l'agente del thread. */
    | { k: 'agent'; t: string; card?: Card; cta?: boolean; who?: string }
    | { k: 'sys'; t: string }
    | { k: 'dm'; t: string; who: string }
    | { k: 'bg'; t: string }
    | { k: 'routine'; t: string }
    /** propose_app_connection — `t` è il motivo, l'app è Google Drive (ponytail: un caso solo). */
    | { k: 'connect'; t: string }
    /** propose_open_tab — `t` è il motivo, la pagina è Impostazioni. */
    | { k: 'tab'; t: string };

  /** `agents` = stanza: più membri, e il primo è il padrone di casa (come `roomRoster`). */
  type Case = { id: string; agent: string; agents?: string[]; time: string; beats: Beat[] };

  // Gli otto casi, ordinati come la sidebar vera: dal thread più recente al più vecchio.
  // Le chiavi sono relative a `landing.chat.` — il testo sta in i18n perché la pagina gira in
  // quattro lingue; la STRUTTURA sta qui perché è disegno, non traduzione.
  const CASES: Case[] = [
    {
      id: 'content',
      agent: 'content',
      time: '09:24',
      beats: [
        { k: 'user', t: 'm1' },
        { k: 'agent', t: 'm2' },
        { k: 'sys', t: 'actions' },
        { k: 'dm', t: 'dm', who: 'analyst' },
        { k: 'bg', t: 'background' },
        {
          k: 'agent',
          t: 'm3',
          card: {
            img: '/showcase-gen/flashcamp-1.webp',
            title: 'draftTitle',
            sub: 'draftSub',
            more: 'draftMore'
          },
          cta: true
        }
      ]
    },
    {
      // Stanza: tre mestieri sulla stessa richiesta. Due voci sul primo messaggio (il tetto vero,
      // ROOM_MAX_SPEAKERS), una sola sul secondo — e la seconda voce risponde alla prima.
      id: 'room',
      agent: 'content',
      agents: ['content', 'analyst', 'motion'],
      time: '09:05',
      beats: [
        { k: 'user', t: 'cases.room.b1' },
        { k: 'agent', t: 'cases.room.b2', who: 'analyst' },
        { k: 'agent', t: 'cases.room.b3', who: 'motion' },
        { k: 'user', t: 'cases.room.b4' },
        { k: 'agent', t: 'cases.room.b5', who: 'content' }
      ]
    },
    {
      id: 'connect',
      agent: 'content',
      time: '08:40',
      beats: [
        { k: 'user', t: 'cases.connect.b1' },
        { k: 'agent', t: 'cases.connect.b2' },
        { k: 'tab', t: 'cases.connect.b3' },
        { k: 'sys', t: 'cases.connect.b4' },
        { k: 'agent', t: 'cases.connect.b5' }
      ]
    },
    {
      id: 'drive',
      agent: 'web',
      time: '08:12',
      beats: [
        { k: 'user', t: 'cases.drive.b1' },
        { k: 'agent', t: 'cases.drive.b2' },
        { k: 'connect', t: 'cases.drive.b3' },
        { k: 'sys', t: 'cases.drive.b4' },
        { k: 'agent', t: 'cases.drive.b5' }
      ]
    },
    {
      id: 'motion',
      agent: 'motion',
      time: 'Mon',
      beats: [
        { k: 'user', t: 'cases.motion.b1' },
        { k: 'agent', t: 'cases.motion.b2' },
        { k: 'sys', t: 'cases.motion.b3' },
        { k: 'bg', t: 'cases.motion.b4' },
        {
          k: 'agent',
          t: 'cases.motion.b5',
          card: {
            img: '/showcase/lipstick.jpg',
            title: 'cases.motion.cardTitle',
            sub: 'cases.motion.cardSub'
          }
        }
      ]
    },
    {
      id: 'web',
      agent: 'web',
      time: 'Mon',
      beats: [
        { k: 'user', t: 'cases.web.b1' },
        { k: 'agent', t: 'cases.web.b2' },
        { k: 'sys', t: 'cases.web.b3' },
        { k: 'agent', t: 'cases.web.b4' }
      ]
    },
    {
      id: 'analyst',
      agent: 'analyst',
      time: 'Mon',
      beats: [
        { k: 'routine', t: 'cases.analyst.routine' },
        { k: 'agent', t: 'cases.analyst.b1' },
        { k: 'sys', t: 'cases.analyst.b2' },
        { k: 'dm', t: 'cases.analyst.b3', who: 'content' },
        { k: 'user', t: 'cases.analyst.b4' },
        { k: 'agent', t: 'cases.analyst.b5' }
      ]
    },
    {
      id: 'ugc',
      agent: 'ugc',
      time: 'Fri',
      beats: [
        { k: 'user', t: 'cases.ugc.b1' },
        { k: 'agent', t: 'cases.ugc.b2' },
        { k: 'sys', t: 'cases.ugc.b3' },
        {
          k: 'agent',
          t: 'cases.ugc.b4',
          card: { img: '/showcase/macha-latte.jpg', title: 'cases.ugc.cardTitle', sub: 'cases.ugc.cardSub' }
        }
      ]
    }
  ];

  const av = (id: string) => BUILTIN_AGENT_AVATARS[id] ?? DEFAULT_CHAT_AGENT_AVATAR;
  const k = (key: string) => $_(`landing.chat.${key}`);

  /** La roster di una stanza nella forma che vuole `AgentAvatarStack` (id, nome, volto, colore). */
  const stackOf = (ids: string[]) =>
    ids.map((id) => ({ id, name: $_(`landing.team.${id}.name`), ...av(id) }));
  /** Il nome di una stanza è l'elenco dei membri, come in `threadIdentity`. */
  const roomName = (ids: string[]) => ids.map((id) => $_(`landing.team.${id}.name`)).join(', ');

  let picked = $state(0);
  const active = $derived(CASES[picked]);
  // Il volto dell'agente del caso aperto: `{@const}` non è ammesso come figlio di un <div>.
  const mainAv = $derived(av(active.agent));

  // Le voci del pannello sono TAB: nome del caso a sinistra, conversazione a destra. Le frecce
  // muovono la selezione (roving tabindex) come in ogni tablist — con otto bottoni normali il
  // lettore di schermo non direbbe mai "2 di 8", che è l'unica cosa che serve sapere qui.
  let tabs: HTMLButtonElement[] = [];
  function onKey(e: KeyboardEvent) {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    picked = (picked + d + CASES.length) % CASES.length;
    tabs[picked]?.focus();
  }

  // La finestra ha altezza fissa (vedi CSS): a scorrere è solo la colonna dei messaggi. Il
  // contenitore però sopravvive al cambio di caso, quindi la posizione di scroll resterebbe
  // quella di prima e la conversazione nuova si aprirebbe a metà. Salto secco in cima: nessuna
  // animazione da smorzare, quindi niente da chiedere a prefers-reduced-motion.
  let threadEl: HTMLDivElement;
  $effect(() => {
    picked;
    if (threadEl) threadEl.scrollTop = 0;
  });

</script>

<section class="chat-sec">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_('landing.chat.kicker')}</div>
      <h2>{$_('landing.chat.title')} <span class="gr-accent">{$_('landing.chat.titleAccent')}</span></h2>
      <p class="chat-sub">{$_('landing.chat.sub')}</p>
    </div>

    <div class="cm reveal">
      <!-- ── Sidebar: nav, lista thread, brand in fondo ──────────────────────────── -->
      <div class="cm-side">
        <nav class="cm-nav" aria-hidden="true">
          <span class="cm-nav-item is-on"><span class="cm-nav-ic"></span>{$_('app.nav.homeOverview')}</span>
          <span class="cm-nav-item"><span class="cm-nav-ic"></span>{$_('app.nav.calendar')}</span>
          <span class="cm-nav-item"><span class="cm-nav-ic"></span>{$_('app.nav.plan')}</span>
          <span class="cm-nav-item"><span class="cm-nav-ic"></span>{$_('app.nav.analytics')}</span>
        </nav>

        <p class="cm-side-label">{$_('app.nav2.team')}</p>

        <div class="cm-threads" role="tablist" aria-label={$_('landing.chat.pick')}>
          {#each CASES as c, i (c.id)}
            {@const a = av(c.agent)}
            <button
              type="button"
              role="tab"
              class="cm-row"
              class:is-on={picked === i}
              id={`cmtab-${c.id}`}
              aria-selected={picked === i}
              aria-controls="cm-panel"
              tabindex={picked === i ? 0 : -1}
              bind:this={tabs[i]}
              onclick={() => (picked = i)}
              onkeydown={onKey}
            >
              <span class="cm-row-face">
                <!-- 34 come DashboardSidebar.svelte, e non è un gusto: nel cluster una faccia
                     prende il 47% del lato, quindi solo da 34 in su le tre facce della stanza
                     restano da 16px — la misura sotto la quale l'arco della bocca sparisce. -->
                {#if c.agents}
                  <AgentAvatarStack agents={stackOf(c.agents)} layout="cluster" size={34} />
                {:else}
                  <AgentAvatar face={a.face} color={a.color} size={34} />
                {/if}
              </span>
              <span class="cm-row-lines">
                <span class="cm-row-top">
                  <span class="cm-row-name">
                    {c.agents ? roomName(c.agents) : $_(`landing.team.${c.agent}.name`)}
                  </span>
                  <span class="cm-row-time">{c.time}</span>
                </span>
                <span class="cm-row-prev">{k(`cases.${c.id}.preview`)}</span>
              </span>
            </button>
          {/each}
        </div>

        <div class="cm-brand">
          <span class="cm-brand-mark">FC</span>
          <span class="cm-brand-name">Flash Camp</span>
        </div>
      </div>

      <!-- ── Conversazione ───────────────────────────────────────────────────────── -->
      <div class="cm-main" id="cm-panel" role="tabpanel" aria-labelledby={`cmtab-${active.id}`}>
        <div class="cm-top">
          {#if active.agents}
            <AgentAvatarStack agents={stackOf(active.agents)} layout="cluster" size={26} />
          {:else}
            <AgentAvatar face={mainAv.face} color={mainAv.color} size={26} />
          {/if}
          <span class="cm-top-name">
            {active.agents ? roomName(active.agents) : $_(`landing.team.${active.agent}.name`)}
          </span>
          <span class="cm-top-case">{k(`cases.${active.id}.name`)}</span>
        </div>

        <div class="cm-thread" bind:this={threadEl}>
          {#each active.beats as b, i (active.id + i)}
            {#if b.k === 'user'}
              <p class="cm-b cm-user">{k(b.t)}</p>
            {:else if b.k === 'sys'}
              <p class="cm-sys">{k(b.t)}</p>
            {:else if b.k === 'routine'}
              <p class="cm-sys cm-routine"><span class="cm-clock" aria-hidden="true"></span>{k(b.t)}</p>
            {:else if b.k === 'dm'}
              {@const w = av(b.who)}
              <p class="cm-sys cm-dm">
                <AgentAvatar face={w.face} color={w.color} size={16} />
                <span>{k(b.t)}</span>
              </p>
            {:else if b.k === 'bg'}
              <p class="cm-sys cm-bg"><span class="cm-pulse"></span><span>{k(b.t)}</span></p>
            {:else if b.k === 'tab'}
              <!-- propose_open_tab: riga quieta centrata, motivo sopra e azione in accent sotto. -->
              <div class="cm-tab">
                <span class="cm-tab-reason">{k(b.t)}</span>
                <span class="cm-tab-cta">{k('openSettings')}</span>
              </div>
            {:else if b.k === 'connect'}
              <!-- propose_app_connection: logo + nome + pillola ghost, motivo rientrato sotto. -->
              <div class="cm-connect">
                <span class="cm-cc-head">
                  <svg class="cm-cc-logo" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={siGoogledrive.path} fill="#{siGoogledrive.hex}" />
                  </svg>
                  <span class="cm-cc-name">Google Drive</span>
                  <span class="cm-cc-cta">{k('connectDrive')}</span>
                </span>
                <span class="cm-cc-reason">{k(b.t)}</span>
              </div>
            {:else}
              {@const sp = b.who ? av(b.who) : mainAv}
              <div class="cm-line">
                <AgentAvatar face={sp.face} color={sp.color} size={26} />
                <div class="cm-b cm-b-wide">
                  <!-- In stanza il nome di chi parla sta sopra la bolla: le voci si alternano. -->
                  {#if b.who}
                    <span class="cm-who">{$_(`landing.team.${b.who}.name`)}</span>
                  {/if}
                  <span class="cm-text">{k(b.t)}</span>

                  {#if b.card}
                    <span class="cm-draft">
                      <img
                        class="cm-thumb"
                        src={b.card.img}
                        alt=""
                        width="56"
                        height="56"
                        loading="lazy"
                        decoding="async"
                      />
                      <span class="cm-draft-meta">
                        <span class="cm-draft-title">{k(b.card.title)}</span>
                        <span class="cm-draft-sub">{k(b.card.sub)}</span>
                      </span>
                      {#if b.card.more}
                        <span class="cm-draft-more">{k(b.card.more)}</span>
                      {/if}
                    </span>
                  {/if}

                  {#if b.cta}
                    <span class="cm-actions">
                      <span class="cm-approve">{$_('landing.chat.approve')}</span>
                      <span class="cm-secondary">{$_('landing.chat.review')}</span>
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="cm-agent-panel"><HomeAgentPanel /></div>
    </div>

    <p class="chat-foot reveal">{$_('landing.chat.foot')}</p>
  </div>
</section>

<style>
  .chat-sec { padding: 84px 0 8px; }
  .chat-sub {
    margin: 14px auto 0;
    max-width: 60ch;
    font-size: 1.05rem;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  /* La finestra: sidebar + conversazione, come l'app. */
  .cm {
    margin: 44px auto 0;
    max-width: 1200px;
    /* Altezza FISSA, uguale per tutti e otto i casi: cambiando thread la pagina sotto non si
       deve muovere di un pixel. Era 560px con cinque righe in sidebar; con otto la lista da
       sola chiede ~390px e a 560 sarebbe la SIDEBAR a dover scorrere — cioè tre casi su otto
       nascosti sotto la piega, che su una homepage vale come non averli. 640 su 940 di
       larghezza resta la proporzione di una finestra d'app (~3:2) e tiene la sidebar intera:
       nav + otto righe + riga del brand stanno in ~610px. A scorrere resta solo la
       conversazione, come prima. */
    height: 640px;
    display: grid;
    grid-template-columns: 252px minmax(0, 1fr) 318px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--paper);
    box-shadow: 0 20px 50px -32px rgb(0 0 0 / 35%);
    overflow: hidden;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────────── */
  .cm-side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 14px 10px 12px;
    background: var(--sidebar-bg, var(--paper-2));
    border-right: 1px solid var(--line);
  }
  .cm-nav { display: flex; flex-direction: column; gap: 2px; }
  .cm-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cm-nav-item.is-on { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  /* Segnaposto dell'icona: PIENO e non contornato — il quadrato vuoto si legge come
     una checkbox, e la nav dell'app non ne ha. */
  .cm-nav-ic {
    width: 13px;
    height: 13px;
    border-radius: 4px;
    background: currentColor;
    opacity: 0.22;
    flex: 0 0 auto;
  }

  .cm-side-label {
    margin: 4px 0 0 8px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .cm-threads { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .cm-row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-width: 0;
    padding: 7px 8px;
    border: 0;
    border-radius: 11px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.15s var(--ease);
  }
  .cm-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .cm-row.is-on { background: color-mix(in srgb, var(--ink) 8%, transparent); }
  .cm-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cm-row-face { display: inline-flex; flex: 0 0 auto; }
  .cm-row-lines { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .cm-row-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .cm-row-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: 0;
  }
  .cm-row-time { font-size: 0.7rem; color: var(--ink-faint); white-space: nowrap; flex: 0 0 auto; }
  .cm-row-prev {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.71rem;
    line-height: 1.35;
    color: var(--ink-soft);
  }

  .cm-brand {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 8px 3px;
    border-top: 1px solid var(--line);
  }
  .cm-brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--accent-2), var(--accent));
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0;
    flex: 0 0 auto;
  }
  .cm-brand-name {
    font-size: 0.8rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Conversazione ───────────────────────────────────────────────────────── */
  /* min-height:0 o il figlio scorrevole gonfia la griglia invece di scorrere. */
  .cm-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .cm-agent-panel { display: flex; min-width: 0; min-height: 0; }
  .cm-top {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 13px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--paper-2);
  }
  /* Una riga sola: il nome di una STANZA è l'elenco dei membri e su schermo stretto
     manderebbe a capo l'intestazione, cambiandole altezza da un caso all'altro. */
  .cm-top-name {
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-top-case {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cm-thread {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 22px 18px 24px;
    /* L'unica cosa che scorre: intestazione e sidebar restano ferme. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink) 22%, transparent) transparent;
  }
  .cm-thread::-webkit-scrollbar { width: 8px; }
  .cm-thread::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--ink) 20%, transparent);
    border-radius: 999px;
  }

  /* Bolle: l'utente a destra piena, l'agente a sinistra su fondo tenue — come in chat. */
  .cm-b {
    margin: 0;
    padding: 10px 14px;
    border-radius: 16px;
    background: var(--paper-3);
    font-size: 0.92rem;
    line-height: 1.55;
    letter-spacing: 0.01em;
    max-width: 42ch;
  }
  .cm-user {
    align-self: flex-end;
    background: var(--ink);
    color: var(--paper);
    border-bottom-right-radius: 6px;
  }
  .cm-line { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .cm-line .cm-b { border-top-left-radius: 6px; }
  .cm-b-wide { display: flex; flex-direction: column; gap: 11px; max-width: 46ch; min-width: 0; }
  .cm-text { display: block; }
  /* Chi parla, in stanza. Il gap della bolla è pensato per la card, non per un'etichetta:
     qui si riprende quello spazio, così il nome resta attaccato alla sua battuta. */
  .cm-who {
    display: block;
    margin-bottom: -7px;
    font-size: 0.73rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--ink-faint);
  }

  /* Eventi di sistema: centrati, senza cornice — non sono messaggi. */
  .cm-sys {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    max-width: 100%;
    font-size: 0.76rem;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ink-soft);
    text-align: center;
  }
  .cm-dm span, .cm-bg span { overflow: hidden; text-overflow: ellipsis; }

  .cm-clock {
    width: 11px;
    height: 11px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    opacity: 0.6;
    flex: 0 0 auto;
  }

  .cm-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: 0 0 auto;
    animation: cm-breathe 1.6s ease-in-out infinite;
  }
  @keyframes cm-breathe { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

  .cm-draft {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper);
    min-width: 0;
  }
  .cm-thumb { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; }
  .cm-draft-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
  .cm-draft-title {
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-draft-sub { font-size: 0.74rem; color: var(--ink-faint); }
  .cm-draft-more {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--paper-3);
    border-radius: 20px;
    padding: 3px 9px;
    flex: 0 0 auto;
  }

  /* ── Le due richieste di connessione, nella forma che hanno nel prodotto ──────
     `.cm-tab` = la riga `.open-tab-card` di ChatColumn.svelte: evento di sistema, quindi
     centrata e senza cornice, con l'azione come testo accent.
     `.cm-connect` = ChatConnectCard.svelte: contenuto del TURNO, quindi allineata alla
     colonna dell'agente (26px di avatar + 8 di gap), logo + nome + pillola ghost. */
  .cm-tab {
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    max-width: 42ch;
    text-align: center;
  }
  .cm-tab-reason { font-size: 0.76rem; line-height: 1.4; color: var(--ink-soft); }
  .cm-tab-cta { font-size: 0.76rem; font-weight: 600; color: var(--accent); }

  .cm-connect { align-self: flex-start; margin-left: 34px; max-width: 42ch; min-width: 0; }
  .cm-cc-head { display: flex; align-items: center; gap: 8px; }
  .cm-cc-logo { width: 18px; height: 18px; flex: none; }
  .cm-cc-name {
    font-size: 0.81rem;
    font-weight: 650;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-cc-cta {
    margin-left: auto;
    border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--line));
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
    flex: none;
  }
  .cm-cc-reason {
    display: block;
    margin-top: 3px;
    padding-left: 26px; /* allinea alla colonna del nome, sotto il logo */
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--ink-soft);
  }

  .cm-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .cm-approve {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--paper);
    background: var(--ink);
    border-radius: 20px;
    padding: 7px 15px;
  }
  .cm-secondary { font-size: 0.78rem; color: var(--ink-faint); }

  .chat-foot {
    margin: 30px auto 0;
    max-width: 62ch;
    text-align: center;
    font-size: 0.98rem;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  @media (prefers-reduced-motion: reduce) { .cm-pulse { animation: none; opacity: 1; } }

  /* ── Stretto: la sidebar non ci sta ────────────────────────────────────────
     Diventa una FILA di thread scorrevole sopra la conversazione, non un <select>:
     i volti sono metà del messaggio di questa sezione, e un menu a tendina li
     nasconderebbe proprio dove lo schermo è già povero di segnali. Stesso markup,
     stessi bottoni, stesse tab — cambia solo il verso. */
  @media (max-width: 860px) {
    /* dvh e non vh: su iOS vh conta la barra degli indirizzi come se non ci fosse mai, e il
       riquadro sborderebbe. Il tetto a 560px tiene la finestra uguale a quella desktop sui
       tablet alti; il pavimento a 380px la salva sui telefoni bassi in orizzontale. */
    .cm { grid-template-columns: minmax(0, 1fr); height: clamp(380px, 76dvh, 560px); }
    .cm-agent-panel { display: none; }
    .cm-side {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding: 10px;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
    .cm-side::-webkit-scrollbar { display: none; }
    .cm-nav, .cm-side-label, .cm-brand { display: none; }
    .cm-threads { flex-direction: row; gap: 6px; }
    .cm-row {
      width: auto;
      flex: 0 0 auto;
      gap: 7px;
      padding: 6px 11px 6px 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ink) 4%, transparent);
      min-height: 44px;
    }
    .cm-row.is-on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
    .cm-row-lines { flex: 0 0 auto; }
    .cm-row-time, .cm-row-prev { display: none; }
    /* Le pillole mostrano il nome intero — tranne la stanza, che ne ha tre dentro e da
       sola occuperebbe tutta la riga scorrevole. Il tetto morde solo lei. */
    .cm-row-name { font-size: 0.78rem; max-width: 20ch; }
    .cm-top-case { display: none; }
  }

  @media (max-width: 560px) {
    .chat-sec { padding-top: 60px; }
    .cm-thread { padding: 18px 12px 20px; }
    .cm-b { font-size: 0.88rem; }
    .cm-draft-more { display: none; }
  }
</style>
