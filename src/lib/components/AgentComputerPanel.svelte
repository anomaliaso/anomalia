<script lang="ts">
  // "Il computer dell'agente" — il pannello a destra della chat: chi è l'agente del thread,
  // cosa sta facendo adesso, le sue routine, e dove intervenire. È ASSEMBLAGGIO di dati che
  // esistono già (loop_ticks, custom_agent_schedules, video_renders, l'ultimo report nel
  // thread): non inventa niente e non interroga niente da solo — tutto arriva dalla pagina.
  import { _, locale } from 'svelte-i18n';
  import { enhance } from '$app/forms';
  import { X } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { threadIdentity, type ThreadIdentitySource } from '$lib/thread-identity';
  import { fallbackAvatarFace, fallbackAvatarColor } from '$lib/agent-avatars';
  import { AGENT_HOME, JOB_HOME } from '$lib/agent-owners';
  import { computerOwner } from '$lib/agent-computer';
  import { agentScheduleSummary } from '$lib/agent-templates';
  import { postPreviewHref } from '$lib/page-modal-navigation';
  import type { StreamToolCall } from '$lib/stores/chat-session';

  type JobPanel = {
    key: string;
    cadence: string;
    enabled: boolean;
    ticks: Array<{ outcome: string; reason: string | null; at: string }>;
  };
  type CustomPanel = {
    id: string;
    name: string;
    agent: string | null;
    avatar_face: string | null;
    avatar_color: string | null;
    enabled: boolean;
    days_of_week: number[];
    times: string[];
    next_run_label: string | null;
    last_run_label: string | null;
    last_error: string | null;
  };
  type RenderRow = { id: string; post_id: string | null; status: string; submitted_at: string };

  let {
    brandSlug,
    thread,
    job = null,
    custom = null,
    renders = [],
    live,
    backgroundLabels = [],
    lastReport = null,
    lastPostId = null,
    lastPlanId = null,
    onclose
  }: {
    brandSlug: string;
    thread: ThreadIdentitySource;
    job?: JobPanel | null;
    custom?: CustomPanel | null;
    renders?: RenderRow[];
    live: { loading: boolean; streamBuf: string; streamToolCalls: StreamToolCall[]; streamReasoning: string };
    backgroundLabels?: string[];
    lastReport?: string | null;
    lastPostId?: string | null;
    lastPlanId?: string | null;
    onclose: () => void;
  } = $props();

  const base = $derived(`/app/${brandSlug}`);

  // DI CHI è il computer che questa card mostra. Ogni agente ha la sua macchina (lo schermo `:1`
  // è uno solo: due agenti sulla stessa VM si muoverebbero il puntatore a vicenda), quindi ogni
  // chiamata sul computer porta l'agente del thread. Stessa risoluzione dell'identità: prima
  // l'agente custom, poi lo specialista.
  const agentParam = $derived(`?agent=${encodeURIComponent(computerOwner(custom?.id, thread.agent) ?? '')}`);

  // Identità: la STESSA risoluzione di sidebar e topbar (threadIdentity). Per i custom la
  // lista thread non è detto sia già arrivata, quindi il nome/volto viene dalla riga di
  // custom_agent_schedules caricata dal server — con lo stesso fallback della pagina /agents
  // per le righe salvate prima che gli avatar esistessero.
  const identity = $derived.by(() => {
    const src: ThreadIdentitySource = custom
      ? {
          ...thread,
          custom_agent_id: custom.id,
          agents: [
            {
              id: custom.id,
              name: custom.name,
              face: custom.avatar_face ?? fallbackAvatarFace(custom.id),
              color: custom.avatar_color ?? fallbackAvatarColor(custom.id)
            }
          ]
        }
      : thread;
    return threadIdentity(src, (k) => $_(k));
  });

  const lang = $derived(($locale ?? 'en').slice(0, 2));

  // La riga di cadenza sotto il nome: per i job la frase umana del roster, per i custom il
  // riassunto giorni · orari (stessa funzione della libreria agenti).
  const cadenceLine = $derived(
    job
      ? $_(`app.roster.job.${job.key}.cadence`)
      : custom
        ? agentScheduleSummary(custom.days_of_week, custom.times, lang)
        : null
  );

  const isLive = $derived(
    live.loading || !!live.streamBuf || live.streamToolCalls.length > 0 || !!live.streamReasoning
  );

  // Minuti di orologio per i render attivi: un tick ogni 30s basta, è un'etichetta, non un timer.
  let now = $state(Date.now());
  $effect(() => {
    if (!renders.length) return;
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  function renderMins(r: RenderRow): number {
    const m = Math.floor((now - Date.parse(r.submitted_at)) / 60_000);
    return Number.isFinite(m) && m > 0 ? m : 0;
  }

  // Stessa lingua della pagina /agents: stato + motivo come CODICI tradotti, mai messaggi grezzi.
  function tickLabel(t: { outcome: string; reason: string | null }): string {
    if (t.outcome === 'ok') return $_('app.roster.state.ok');
    if (t.outcome === 'failed') return $_('app.roster.state.failed');
    const generic = $_('app.roster.state.skipped');
    return t.reason ? $_(`app.roster.reason.${t.reason}`, { default: generic }) : generic;
  }
  function tickDate(at: string): string {
    try {
      return new Date(at).toLocaleString($locale ?? 'en', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  }

  // Il report è testo deterministico scritto dal server (team-ignition): righe VERBATIM,
  // nessun parser oltre allo split — se il formato cambia, qui non si rompe niente.
  const reportLines = $derived(
    (lastReport ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 6)
  );

  // "Apri dove sta lavorando" — l'intervento sulla SUPERFICIE del prodotto, complementare alla
  // card «Computer» qui sotto (che invece guarda dentro la VM, quando la VM ce l'ha da mostrare).
  // Quello che questo link promette è portare l'utente sulla superficie dove il lavoro
  // dell'agente sta atterrando:
  // il render attivo → la galleria motion, l'ultimo post toccato → il calendario su quel post,
  // l'ultimo piano proposto → il piano, altrimenti la home del mestiere dell'agente.
  // Le home (JOB_HOME/AGENT_HOME) vivono in agent-owners.ts: la STESSA mappa che il topbar
  // usa al contrario per "Parla con <agente>" — una fonte, due direzioni.
  const work = $derived.by(() => {
    if (renders.length) return { href: `${base}/motion-video`, key: 'openGallery' };
    if (lastPostId) return { href: postPreviewHref(base, lastPostId), key: 'openPost' };
    if (lastPlanId) return { href: `${base}/plans/${lastPlanId}`, key: 'openPlan' };
    const path = job
      ? ((JOB_HOME as Record<string, string>)[job.key] ?? '')
      : (AGENT_HOME[custom?.agent ?? thread.agent ?? 'auto'] ?? '');
    return { href: `${base}${path}`, key: 'openWork' };
  });

  let toggleBusy = $state(false);
  const withToggle = () => {
    toggleBusy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      toggleBusy = false;
    };
  };

  // La card «Computer»: schermo della sandbox del brand, quando c'è. `agent_computers` è UNA
  // riga per BRAND (non per thread/agente — vedi computer.ts), quindi questa sezione non dipende
  // da `identity`: ogni agente dello stesso brand condivide la stessa VM.
  type ComputerStatus = {
    state: 'stopped' | 'running' | 'error';
    everActivated: boolean;
    lastTouchAt: string | null;
    hasCheckpoint: boolean;
    graphical: boolean;
  };
  let computerStatus = $state<ComputerStatus | null>(null);
  let screenUrl = $state<string | null>(null);
  let screenReason = $state<string | null>(null);
  let screenSectionEl = $state<HTMLElement | null>(null);


  // L'ultimo `shell` visto nello streaming live — SOLO quello che il pannello già riceve
  // (`live.streamToolCalls`), mai una fonte nuova da interrogare. Sparisce col turno: non è
  // uno storico, è "cosa sta facendo adesso" per la VM headless.
  const lastShellCommand = $derived.by(() => {
    for (let i = live.streamToolCalls.length - 1; i >= 0; i--) {
      const call = live.streamToolCalls[i];
      if (call.toolName !== 'shell') continue;
      const input = call.input as { command?: string } | undefined;
      return typeof input?.command === 'string' ? input.command : null;
    }
    return null;
  });

  function relativeTouch(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    // `Date.now()` diretto, non lo `now` reattivo qui sopra (quello tiene il passo dei render
    // attivi, non ha motivo di far ripartire un effect solo per questa etichetta): il poll dello
    // stato (ogni 2.5s mentre la card è visibile) rinfresca già il testo abbastanza spesso.
    const diffSec = Math.round((ms - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat($locale ?? 'en', { numeric: 'auto' });
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(diffSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    return rtf.format(Math.round(diffSec / 86400), 'day');
  }

  async function refreshComputer() {
    try {
      const res = await fetch(`${base}/agents/computer/status${agentParam}`);
      if (!res.ok) return;
      computerStatus = (await res.json()) as ComputerStatus;
    } catch {
      // Un poll fallito non è un errore da mostrare: il prossimo giro riprova.
      return;
    }
    if (computerStatus.state !== 'running' || !computerStatus.graphical) {
      if (screenUrl) URL.revokeObjectURL(screenUrl);
      screenUrl = null;
      return;
    }
    try {
      const res = await fetch(`${base}/agents/computer/screen${agentParam}`);
      if (res.status !== 200) {
        screenReason = res.headers.get('x-screen-reason');
        return;
      }
      screenReason = null;
      const blob = await res.blob();
      const next = URL.createObjectURL(blob);
      const prev = screenUrl;
      screenUrl = next;
      if (prev) URL.revokeObjectURL(prev);
    } catch {
      // Idem: 204/errore di rete sullo screenshot lascia semplicemente l'ultimo fotogramma buono.
    }
  }

  // Stesso pattern di AgentAvatar.svelte: poll SOLO mentre la card è nel viewport E la scheda
  // è in primo piano — un pannello aperto in un tab in background non deve pagare uno
  // screenshot ogni 2.5s per niente.
  $effect(() => {
    const el = screenSectionEl;
    if (!el) return;
    let onScreen = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const awake = () => onScreen && document.visibilityState === 'visible';
    const sync = () => {
      if (awake()) {
        if (!timer) {
          refreshComputer();
          timer = setInterval(refreshComputer, 2_500);
        }
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      if (timer) clearInterval(timer);
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      if (screenUrl) URL.revokeObjectURL(screenUrl);
      screenUrl = null;
    };
  });
</script>

<div class="acp">
  <header class="acp-head">
    <span class="acp-kicker">{$_('chat.computer.title', { values: { name: identity.name } })}</span>
    <button type="button" class="acp-close" onclick={onclose} aria-label={$_('chat.computer.close')}>
      <X size={16} strokeWidth={2} />
    </button>
  </header>

  <div class="acp-scroll">
    <!-- Identità -->
    <section class="acp-id">
      <AgentAvatar face={identity.face} color={identity.color} size={44} busy={live.loading} />
      <div class="acp-id-text">
        <h3>{identity.name}</h3>
        {#if cadenceLine}
          <p>{cadenceLine}</p>
        {/if}
      </div>
      {#if job}
        <!-- STESSO archivio della pagina /agents: brand_job_optouts via setJobEnabled. -->
        <form method="POST" action="?/toggleJob" use:enhance={withToggle}>
          <input type="hidden" name="job" value={job.key} />
          <label class="ios-switch" title={job.enabled ? $_('app.custom.enabled') : $_('app.custom.paused')}>
            <input
              type="checkbox"
              name="enabled"
              checked={job.enabled}
              disabled={toggleBusy}
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            <span class="ios-slider"></span>
          </label>
        </form>
      {:else if custom}
        <form method="POST" action="?/toggleRoutine" use:enhance={withToggle}>
          <input type="hidden" name="id" value={custom.id} />
          <label class="ios-switch" title={custom.enabled ? $_('app.custom.enabled') : $_('app.custom.paused')}>
            <input
              type="checkbox"
              name="enabled"
              checked={custom.enabled}
              disabled={toggleBusy}
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            <span class="ios-slider"></span>
          </label>
        </form>
      {/if}
    </section>

    <!-- Attività: la "finestra" del computer dell'agente -->
    <section class="acp-sec">
      <h4 class="acp-sec-title">{$_('chat.computer.activity')}</h4>
      <div class="acp-window">
        <div class="acp-window-bar">
          <span class="acp-dot"></span><span class="acp-dot"></span><span class="acp-dot"></span>
          <span class="acp-window-title">{identity.name}</span>
          {#if isLive || backgroundLabels.length || renders.length}
            <span class="acp-live-pill">{$_('chat.computer.nowWorking')}</span>
          {/if}
          <!-- Porta alla pagina a schermo intero: qui dentro il desktop è un francobollo, si
               vede che succede qualcosa ma non ci si lavora. Sempre offerto — la pagina accende
               la macchina se dorme, quindi non serve che l'agente l'abbia già usata. -->
          <a class="acp-control" href={`${base}/agents/computer${agentParam}`}>{$_('chat.computer.controlTake')}</a>
        </div>
        <div class="acp-window-body" bind:this={screenSectionEl}>
          <!-- LO SCHERMO della VM dentro la finestra-browser: il pannello mostra cosa FA la
               macchina, non una seconda copia della chat (che è già a sinistra). Quando non
               c'è schermo: lo stato onesto della macchina, mai un'attesa eterna. -->
          {#if screenUrl}
            <img class="acp-screen-img" src={screenUrl} alt={$_('chat.computer.machine')} />
          {:else if computerStatus?.state === 'running' && computerStatus.graphical}
            {#if screenReason}
              <p class="acp-idle">{$_('chat.computer.machineScreenError', { values: { reason: screenReason } })}</p>
            {:else}
              <div class="acp-loading">
                <span class="acp-spinner" aria-hidden="true"></span>
                <p>{$_('chat.computer.machineBooting')}</p>
              </div>
            {/if}
          {:else if computerStatus?.state === 'running'}
            <!-- La macchina lavora ma nessuno ha ancora acceso lo schermo. Non è un errore da
                 annunciare («nessuno schermo attivo» non dice cosa fare): è un'attesa, e il modo
                 di uscirne è il pulsante qui sopra. -->
            <div class="acp-loading">
              <span class="acp-spinner" aria-hidden="true"></span>
              <p>{$_('chat.computer.machineNoDesktop')}</p>
            </div>
            {#if lastShellCommand}
              <div class="acp-terminal">
                <span class="acp-terminal-label">{$_('chat.computer.machineLastCommand')}</span>
                <code>{lastShellCommand}</code>
              </div>
            {/if}
          {:else}
            <!-- Spenta o mai accesa: la differenza non cambia cosa può fare chi guarda, e
                 «non è mai stata accesa» suonava come un guasto. Una riga sola, che dice come. -->
            <p class="acp-idle">{$_('chat.computer.machineAsleep')}</p>
          {/if}
          {#if renders.length}
            <ul class="acp-lines">
              {#each renders as r (r.id)}
                <li class="acp-render">
                  <span class="acp-pulse" aria-hidden="true"></span>
                  {$_('chat.computer.renderRunning', { values: { mins: renderMins(r) } })}
                </li>
              {/each}
            </ul>
          {/if}
          {#if backgroundLabels.length}
            <ul class="acp-lines">
              {#each backgroundLabels as label (label)}
                <li class="acp-bg">{label}</li>
              {/each}
            </ul>
          {/if}
          {#if !isLive}
            {#if reportLines.length}
              <p class="acp-report-head">{$_('chat.computer.lastReport')}</p>
              <div class="acp-report">
                {#each reportLines as line (line)}
                  <p>{line}</p>
                {/each}
              </div>
            {:else if !renders.length && !backgroundLabels.length}
              <p class="acp-idle">{$_('chat.computer.idle')}</p>
            {/if}
          {/if}
        </div>
      </div>

      {#if job}
        <h4 class="acp-sec-title sub">{$_('chat.computer.lastRuns')}</h4>
        {#if job.ticks.length}
          <ul class="acp-runs">
            {#each job.ticks as t (t.at)}
              <li>
                <span class="acp-run-dot" class:ok={t.outcome === 'ok'} class:bad={t.outcome === 'failed'}></span>
                <span class="acp-run-label" class:err={t.outcome === 'failed'}>{tickLabel(t)}</span>
                <span class="acp-run-when">{tickDate(t.at)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="acp-idle">{$_('app.roster.state.never')}</p>
        {/if}
      {/if}
    </section>

    <!-- Routine -->
    <section class="acp-sec">
      <h4 class="acp-sec-title">{$_('chat.computer.routines')}</h4>
      {#if custom}
        <div class="acp-routine">
          <p class="acp-routine-when">{agentScheduleSummary(custom.days_of_week, custom.times, lang)}</p>
          <p class="acp-routine-meta">
            {#if custom.next_run_label && custom.enabled}
              <span>{$_('app.custom.nextRun')}: {custom.next_run_label}</span>
            {/if}
            {#if custom.last_run_label}
              <span>{$_('app.custom.lastRun')}: {custom.last_run_label}</span>
            {/if}
          </p>
          {#if custom.last_error}
            <p class="acp-routine-err">
              {$_('app.custom.error.' + custom.last_error, { default: $_('app.custom.error.unknown') })}
            </p>
          {/if}
        </div>
        <a class="acp-add" href={`${base}/agents?edit=${custom.id}`}>+ {$_('chat.computer.newRoutine')}</a>
      {:else if job}
        <div class="acp-routine">
          <p class="acp-routine-when">{$_(`app.roster.job.${job.key}.cadence`)}</p>
          <p class="acp-routine-meta"><span>{$_('app.custom.includedTag')}</span></p>
        </div>
        <!-- Un lavoro incluso non si ri-schedula: una routine in più è un agente custom. -->
        <a class="acp-add" href={`${base}/agents`}>+ {$_('chat.computer.proposeCustom')}</a>
      {:else}
        <a class="acp-add" href={`${base}/agents`}>+ {$_('chat.computer.proposeCustom')}</a>
      {/if}
    </section>

    <!-- Intervieni -->
    <section class="acp-sec">
      <h4 class="acp-sec-title">{$_('chat.computer.intervene')}</h4>
      <a class="acp-open" href={work.href}>{$_(`chat.computer.${work.key}`)}</a>
    </section>
  </div>
</div>

<style>
  .acp {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--paper);
    color: var(--ink);
  }
  .acp-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  .acp-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acp-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    flex: 0 0 auto;
  }
  .acp-close:hover {
    background: var(--paper-2);
    color: var(--ink);
  }
  .acp-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .acp-id {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .acp-id-text {
    min-width: 0;
    flex: 1 1 auto;
  }
  .acp-id-text h3 {
    margin: 0;
    font-family: var(--serif);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acp-id-text p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .acp-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .acp-sec-title {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .acp-sec-title.sub {
    margin-top: 8px;
  }
  /* La card "mini finestra" alla rakazo: barra col titolo, corpo con il lavoro. */
  .acp-window {
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--paper-2);
  }
  .acp-window-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--ink) 4%, var(--paper-2));
  }
  .acp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
    flex: 0 0 auto;
  }
  .acp-window-title {
    margin-left: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
  }
  .acp-live-pill {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    color: #16a34a;
    background: color-mix(in srgb, #16a34a 12%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .acp-window-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.45;
    /* L'iframe che si sta connettendo sta qui dentro in assoluto, non fuori dalla finestra. */
    position: relative;
  }
  .acp-lines {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .acp-render,
  .acp-bg {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .acp-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #16a34a;
    animation: acp-pulse 1.4s ease-in-out infinite;
    flex: 0 0 auto;
  }
  @keyframes acp-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .acp-report-head {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-faint);
  }
  .acp-report {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .acp-report p {
    margin: 0;
    color: var(--ink);
    user-select: text;
  }
  .acp-idle {
    margin: 0;
    font-size: 12px;
    color: var(--ink-faint);
  }
  .acp-runs {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .acp-runs li {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 12px;
    min-width: 0;
  }
  .acp-run-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-faint);
    align-self: center;
    flex: 0 0 auto;
  }
  .acp-run-dot.ok {
    background: #16a34a;
  }
  .acp-run-dot.bad {
    background: #dc2626;
  }
  .acp-run-label {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acp-run-label.err {
    color: #dc2626;
  }
  .acp-run-when {
    flex: 0 0 auto;
    color: var(--ink-faint);
    font-size: 11px;
  }
  .acp-routine {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--paper);
  }
  .acp-routine-when {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .acp-routine-meta {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .acp-routine-err {
    margin: 0;
    font-size: 11.5px;
    color: #dc2626;
  }
  .acp-add {
    align-self: flex-start;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }
  .acp-add:hover {
    text-decoration: underline;
  }
  .acp-open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    gap: 7px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 650;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
    text-decoration: none;
  }
  .acp-open:hover {
    background: color-mix(in srgb, var(--accent) 14%, var(--paper));
  }
  /* Stesso interruttore della pagina /agents (CSS scoped lì, quindi ricopiato qui minimo). */
  .ios-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 26px;
    flex-shrink: 0;
  }
  .ios-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  .ios-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: var(--line, #e5e5ea);
    border-radius: 26px;
    transition: background 0.25s ease;
  }
  .ios-slider::before {
    content: '';
    position: absolute;
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.25s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }
  .ios-switch input:checked + .ios-slider {
    background: #34c759;
  }
  .ios-switch input:checked + .ios-slider::before {
    transform: translateX(18px);
  }

  .acp-screen-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .acp-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px 0;
    color: var(--ink-faint);
    font-size: 12px;
  }
  .acp-loading p {
    margin: 0;
  }
  .acp-spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--ink);
    animation: acp-spin 0.8s linear infinite;
  }
  @keyframes acp-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .acp-spinner {
      animation-duration: 2.4s;
    }
  }
  .acp-control {
    margin-left: auto;
    font: inherit;
    font-size: 11px;
    line-height: 1;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  .acp-control {
    text-decoration: none;
  }
  .acp-terminal {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 10px;
    background: var(--paper-2);
  }
  .acp-terminal-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .acp-terminal code {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--ink);
    overflow-wrap: break-word;
    user-select: text;
  }
</style>
