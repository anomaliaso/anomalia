<script lang="ts">
  /**
   * The free agent-team tool: paste a site, then TALK to the agent that maps your processes and
   * proposes the team.
   *
   * Why a conversation and not a report. The one-shot version of this page produced a beautiful
   * org chart from a homepage — and a homepage cannot say how many quotes a week you answer by
   * hand, or that the bookings are really taken on WhatsApp. Everything that makes the team right
   * lives in the answers to two or three questions, so the tool has to be able to ask them.
   *
   * Three things carry state, and all three are the browser's: the transcript, the goal checklist,
   * and the cards. The server keeps nothing — there is no account here — so each turn sends back
   * what it has, and `sanitizeTranscript` / `sanitizeGoal` decide what is allowed in.
   */
  import { _, locale } from 'svelte-i18n';
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { seededAgentAvatar } from '$lib/agent-templates';
  import { applyChatStreamEvent, emptyStreamState, readSseEvents } from '$lib/chat-stream-events';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const origin = $derived($page.url.origin);
  const t = (k: string) => $_(`tools.agent-team.${k}`);

  type Criterion = { id: string; text: string; status: 'open' | 'done' | 'dropped'; note?: string | null };
  type Goal = { statement: string; criteria: Criterion[] };
  type TeamAgent = {
    id: string;
    name: string;
    role: string;
    department: string;
    mission: string;
    because: string;
    signals: string[];
    cadence: string;
    inputs: string[];
    outputs: string[];
    integrations: string[];
    handoffTo: string[];
    impact: 'high' | 'medium' | 'low';
    effort: 'high' | 'medium' | 'low';
    hoursSavedPerWeek: number;
    firstTask: string;
    library: { slug: string; name: string; tagline: string } | null;
  };
  /** One rendered turn: what was said, plus whatever the tools drew while saying it. */
  type Turn = { role: 'user' | 'assistant'; content: string; agents?: TeamAgent[]; reading?: string[] };

  let url = $state('');
  let started = $state(false);
  let loading = $state(false);
  let error = $state('');
  let rateLimited = $state(false);
  let turns = $state<Turn[]>([]);
  let goal = $state<Goal | null>(null);
  let draft = $state('');
  let liveText = $state('');
  let liveTools = $state<string[]>([]);
  let scroller = $state<HTMLElement | null>(null);

  const team = $derived(
    turns.flatMap((m) => m.agents ?? []).filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
  );
  const hours = $derived(Math.round(team.reduce((s, a) => s + a.hoursSavedPerWeek, 0) * 10) / 10);
  const goalDone = $derived(goal?.criteria.filter((c) => c.status === 'done').length ?? 0);
  const goalTotal = $derived(goal?.criteria.filter((c) => c.status !== 'dropped').length ?? 0);

  // svelte-i18n echoes the key back when a string is missing; never render that at a visitor.
  const label = (path: string, fallback: string) => {
    const k = `tools.agent-team.${path}`;
    const v = $_(k);
    return v === k ? fallback : v;
  };
  const signalLabel = (id: string) => label(`signals.${id}`, id.replace(/_/g, ' '));
  const chipLabel = (toolName: string) => label(`chips.${toolName}`, toolName.replace(/_/g, ' '));

  async function scrollDown() {
    await tick();
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }

  function start(e: Event) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    started = true;
    send(t('firstMessage'));
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    draft = '';
    error = '';
    rateLimited = false;
    turns = [...turns, { role: 'user', content: message }];
    loading = true;
    liveText = '';
    liveTools = [];
    await scrollDown();

    const state = emptyStreamState();
    const drawn: TeamAgent[] = [];
    const read: string[] = [];

    try {
      const res = await fetch('/api/tools/agent-team/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          goal,
          messages: turns.map((m) => ({ role: m.role, content: m.content }))
        })
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        rateLimited = res.status === 429;
        error = body?.error || $_('tools.common.errors.generic');
        turns = turns.slice(0, -1);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const consumed = new Set<string>();
      let buffered = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const { events, rest } = readSseEvents(buffered);
        buffered = rest;
        for (const evt of events) applyChatStreamEvent(state, evt);
        liveText = state.text;
        // Tool outputs ARE the checklist and the cards, so they are read as they land: the team
        // grows while the agent is still writing about it, instead of appearing all at once.
        for (const call of state.tools) {
          if (call.output === undefined || consumed.has(call.toolCallId)) continue;
          consumed.add(call.toolCallId);
          const out = (call.output ?? {}) as Record<string, unknown>;
          if (out.goal && typeof out.goal === 'object') goal = out.goal as Goal;
          if (out.agent && typeof out.agent === 'object') drawn.push(out.agent as TeamAgent);
          if (call.toolName === 'read_page' && typeof out.path === 'string') read.push(out.path);
        }
        liveTools = state.tools.filter((x) => x.status === 'running').map((x) => x.toolName);
        await scrollDown();
      }

      if (state.failed && !state.text.trim()) {
        error = $_('tools.common.errors.generic');
        turns = turns.slice(0, -1);
        return;
      }
      turns = [
        ...turns,
        { role: 'assistant', content: state.text, agents: drawn.length ? drawn : undefined, reading: read.length ? read : undefined }
      ];
    } catch {
      error = $_('tools.common.errors.network');
      turns = turns.slice(0, -1);
    } finally {
      loading = false;
      liveText = '';
      liveTools = [];
      await scrollDown();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }
</script>

<svelte:head>
  <title>{t('meta.title')}</title>
  <meta name="description" content={t('meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:title" content={t('meta.title')} />
  <meta property="og:description" content={t('meta.description')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: t('meta.title'),
    url: `${origin}${lp('/tools/agent-team')}`,
    description: t('meta.description'),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    provider: { '@type': 'Organization', name: 'Anomalia', url: 'https://anomalia.so' }
  })}</script>`}
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="hero" class:compact={started}>
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{t('hero.title')}</h1>
      {#if !started}
        <p class="subhead">{t('hero.subhead')}</p>
      {/if}

      <form onsubmit={start}>
        <div class="input-row">
          <input
            type="text"
            bind:value={url}
            placeholder={t('form.url')}
            aria-label={t('form.url')}
            disabled={started}
          />
          {#if !started}
            <button type="submit" class="btn btn-primary" disabled={!url.trim()}>{t('form.submit')}</button>
          {/if}
        </div>
        {#if !started}<p class="hint">{t('form.hint')}</p>{/if}
      </form>

      {#if error}
        <div class="error-box" class:limit={rateLimited}>
          {error}
          {#if rateLimited}<a href={lp('/waitlist')} class="limit-cta">{$_('tools.common.cta.tryFree')}</a>{/if}
        </div>
      {/if}

      {#if !started}
        <div class="intro">
          <p>{t('intro.body')}</p>
          <ul>
            <li>{t('intro.b1')}</li>
            <li>{t('intro.b2')}</li>
            <li>{t('intro.b3')}</li>
          </ul>
        </div>
      {/if}
    </div>
  </section>

  {#if started}
    <section class="convo">
      <div class="wrap chat-wrap">
        {#if goal}
          <!-- The checklist the agent wrote for itself. It is here because a goal nobody can see is
               a promise nobody can hold it to. -->
          <aside class="goal">
            <div class="goal-head">
              <span class="goal-label">{t('goal.title')}</span>
              <span class="goal-count">{goalDone}/{goalTotal}</span>
            </div>
            <p class="goal-statement">{goal.statement}</p>
            <ul>
              {#each goal.criteria as c (c.id)}
                <li class={c.status}>
                  <span class="tick">{c.status === 'done' ? '✓' : c.status === 'dropped' ? '—' : '○'}</span>
                  <span>{c.text}</span>
                </li>
              {/each}
            </ul>
            {#if team.length}
              <div class="goal-team">
                <strong>{team.length}</strong> {t('goal.agents')} · <strong>{hours}h</strong> {t('goal.hours')}
              </div>
            {/if}
          </aside>
        {/if}

        <div class="thread" bind:this={scroller}>
          {#each turns as m, i (i)}
            {#if m.role === 'user'}
              <div class="msg user">{m.content}</div>
            {:else}
              {#if m.reading?.length}
                <div class="read-chips">
                  {#each m.reading as p (p)}<span>{t('chips.read')} <code>{p}</code></span>{/each}
                </div>
              {/if}
              {#if m.content.trim()}<div class="msg bot">{m.content}</div>{/if}
              {#each m.agents ?? [] as a (a.id)}
                {@const avatar = seededAgentAvatar(a.id)}
                <article class="agent-card">
                  <header>
                    <AgentAvatar face={avatar.face} color={avatar.color} size={38} title={a.name} />
                    <div class="who">
                      <strong>{a.name}</strong>
                      <span>{a.role}</span>
                    </div>
                    <div class="badges">
                      <span class="dept">{$_(`tools.agent-team.departments.${a.department}`)}</span>
                      <span class="impact imp-{a.impact}">
                        {t('agent.impact')}: {$_(`tools.common.severity.${a.impact}`)}
                      </span>
                    </div>
                  </header>

                  <p class="mission">{a.mission}</p>
                  {#if a.because}<p class="because"><span>{t('agent.because')}</span> {a.because}</p>{/if}

                  {#if a.signals.length}
                    <div class="sig">
                      {#each a.signals as s (s)}<span>{signalLabel(s)}</span>{/each}
                    </div>
                  {/if}

                  <dl>
                    {#if a.cadence}<div><dt>{t('agent.cadence')}</dt><dd>{a.cadence}</dd></div>{/if}
                    {#if a.inputs.length}<div><dt>{t('agent.inputs')}</dt><dd>{a.inputs.join(', ')}</dd></div>{/if}
                    {#if a.outputs.length}<div><dt>{t('agent.outputs')}</dt><dd>{a.outputs.join(', ')}</dd></div>{/if}
                    {#if a.integrations.length}
                      <div><dt>{t('agent.integrations')}</dt><dd>{a.integrations.join(', ')}</dd></div>
                    {/if}
                    {#if a.handoffTo.length}
                      <div><dt>{t('agent.handoff')}</dt><dd>{a.handoffTo.join(', ')}</dd></div>
                    {/if}
                    <div>
                      <dt>{t('agent.hours')}</dt>
                      <dd>{a.hoursSavedPerWeek}h · {t('agent.effort')}: {$_(`tools.common.severity.${a.effort}`)}</dd>
                    </div>
                  </dl>

                  {#if a.firstTask}
                    <p class="first"><span>{t('agent.firstTask')}</span> {a.firstTask}</p>
                  {/if}

                  {#if a.library}
                    <a class="library" href={lp(`/agents/${a.library.slug}`)}>
                      <strong>{t('agent.library')}</strong>
                      <span>{a.library.name} — {a.library.tagline}</span>
                    </a>
                  {/if}
                </article>
              {/each}
            {/if}
          {/each}

          {#if loading}
            {#if liveTools.length}
              <div class="read-chips live">
                {#each liveTools as name (name)}<span>{chipLabel(name)}</span>{/each}
              </div>
            {/if}
            {#if liveText.trim()}
              <div class="msg bot">{liveText}</div>
            {:else if !liveTools.length}
              <div class="msg bot thinking">{t('thinking')}</div>
            {/if}
          {/if}
        </div>

        <form class="composer" onsubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea
            bind:value={draft}
            onkeydown={onKey}
            rows="2"
            placeholder={t('composer.placeholder')}
            disabled={loading}
          ></textarea>
          <button type="submit" class="btn btn-primary" disabled={loading || !draft.trim()}>
            {loading ? t('composer.sending') : t('composer.send')}
          </button>
        </form>

        {#if team.length}
          <div class="upsell">
            <p>{t('upsell')}</p>
            <a href={lp('/waitlist')} class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<SiteFooter />

<style>
  .hero { padding: 56px 0 20px; }
  .hero.compact { padding: 32px 0 8px; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 0 20px; }
  .eyebrow {
    display: inline-block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--ink-soft); margin-bottom: 12px;
  }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 12px; letter-spacing: -0.03em; line-height: 1.15; }
  .hero.compact h1 { font-size: 1.35rem; margin-bottom: 10px; }
  .subhead { color: var(--ink-soft); font-size: 1.05rem; line-height: 1.5; margin: 0 0 28px; }
  .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .input-row input {
    flex: 1; min-width: 220px; padding: 14px 16px; border: 1px solid var(--line);
    border-radius: 12px; font-size: 1rem; background: var(--paper);
  }
  .input-row input:disabled { opacity: 0.75; }
  .hint { margin: 10px 0 0; font-size: 0.85rem; color: var(--ink-faint); }
  .error-box {
    background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
    border-radius: 12px; padding: 12px 16px; margin-top: 16px;
  }
  .error-box.limit { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .limit-cta { display: inline-block; margin-left: 8px; font-weight: 600; color: inherit; }
  .intro { margin-top: 28px; color: var(--ink-soft); font-size: 0.95rem; line-height: 1.6; }
  .intro ul { margin: 10px 0 0; padding-left: 18px; }
  .intro li { margin-bottom: 4px; }

  .convo { padding: 8px 0 80px; }
  .goal {
    background: var(--wash); border: 1px solid var(--line); border-radius: 14px;
    padding: 14px 16px; margin-bottom: 16px;
  }
  .goal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .goal-label {
    font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--ink-faint);
  }
  .goal-count { font-size: 0.8rem; font-weight: 600; color: var(--ink-soft); }
  .goal-statement { margin: 6px 0 10px; font-size: 0.92rem; font-weight: 600; line-height: 1.4; }
  .goal ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .goal li { display: flex; gap: 8px; font-size: 0.86rem; color: var(--ink-soft); line-height: 1.4; }
  .goal li.done { color: var(--ink); }
  .goal li.dropped { text-decoration: line-through; opacity: 0.6; }
  .tick { width: 12px; flex: none; }
  .goal-team { margin-top: 10px; font-size: 0.84rem; color: var(--ink-soft); }

  .thread { display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto; padding: 4px 2px; }
  .msg { line-height: 1.55; font-size: 0.96rem; white-space: pre-wrap; }
  .msg.user {
    align-self: flex-end; max-width: 85%; background: var(--wash); border: 1px solid var(--line);
    border-radius: 14px; padding: 10px 14px;
  }
  .msg.bot { max-width: 100%; }
  .msg.thinking { color: var(--ink-faint); }
  .read-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .read-chips span {
    font-size: 0.75rem; color: var(--ink-faint); background: var(--wash);
    border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px;
  }
  .read-chips code { font-family: ui-monospace, monospace; }
  .read-chips.live span { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

  .agent-card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px;
  }
  .agent-card header { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
  .who { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 2px; }
  .who strong { font-size: 1rem; }
  .who span { color: var(--ink-soft); font-size: 0.88rem; line-height: 1.4; }
  .badges { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
  .dept, .impact {
    font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    border-radius: 999px; padding: 3px 9px; background: var(--wash); color: var(--ink-soft);
    white-space: nowrap;
  }
  .impact.imp-high { background: #fef2f2; color: #b91c1c; }
  .impact.imp-medium { background: #fffbeb; color: #92400e; }
  .mission { margin: 12px 0 0; line-height: 1.55; font-size: 0.94rem; }
  .because { margin: 8px 0 0; color: var(--ink-soft); font-size: 0.88rem; line-height: 1.5; }
  .because span, .first span { font-weight: 600; }
  .sig { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .sig span {
    font-size: 0.72rem; color: var(--ink-soft); background: var(--wash);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px;
  }
  dl { margin: 12px 0 0; display: grid; gap: 5px; }
  dl > div { display: grid; grid-template-columns: 120px 1fr; gap: 10px; font-size: 0.85rem; }
  dt { color: var(--ink-faint); font-weight: 600; }
  dd { margin: 0; color: var(--ink-soft); }
  .first { margin: 12px 0 0; font-size: 0.86rem; line-height: 1.5; }
  .library {
    display: flex; flex-direction: column; gap: 2px; margin-top: 12px; text-decoration: none;
    color: inherit; background: var(--wash); border: 1px solid var(--line); border-radius: 12px;
    padding: 11px 13px;
  }
  .library:hover { border-color: var(--ink-faint); }
  .library strong { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); }
  .library span { font-size: 0.86rem; }

  .composer { display: flex; gap: 10px; margin-top: 16px; align-items: flex-end; }
  .composer textarea {
    flex: 1; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
    font-size: 0.95rem; font-family: inherit; background: var(--paper); resize: vertical;
  }
  .upsell {
    margin-top: 28px; padding: 22px; border: 1px solid var(--line);
    border-radius: 16px; background: var(--wash); text-align: center;
  }
  .upsell p { margin: 0 0 14px; color: var(--ink-soft); line-height: 1.5; }
  @media (max-width: 600px) {
    dl > div { grid-template-columns: 1fr; gap: 2px; }
    .badges { flex-direction: row; align-items: center; }
    .input-row input, .input-row :global(button) { width: 100%; flex: none; }
  }
</style>
