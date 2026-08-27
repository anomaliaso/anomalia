<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { renderMd } from '$lib/chat-markdown';
  import { track } from '$lib/analytics';
  import { cancelPoll, runStepJob, type JobPoll } from './step-jobs';
  import { plabel } from './platform-utils';

  let {
    researchSteps = $bindable([]),
    researching = $bindable(false),
    researchBackground = $bindable(false),
    researchJobId = $bindable(null),
    pollRef = $bindable(),
    editorialPlan = $bindable(null),
    allowedCadences = $bindable([]),
    planVisualStyle = $bindable(null),
    report = $bindable(null),
    researchData = $bindable(null),
    buyerPersonas = $bindable([]),
    citations = [],
    brandId = null,
    draftId = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile = null,
    platforms = [],
    planParam = '',
    handles = [],
    competitors = [],
    additionalContext = '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people = [],
    userEmail = '',
    brandName = '',
    isContinueMode = false,
    oncontinue,
    onskip,
    onresult,
    onresearched,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror
  }: {
    researchSteps?: { step: string; message: string; result?: any }[];
    researching?: boolean;
    researchBackground?: boolean;
    researchJobId?: string | null;
    pollRef?: JobPoll | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editorialPlan?: any | null;
    allowedCadences?: string[];
    planVisualStyle?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    report?: any | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    researchData?: any | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buyerPersonas?: any[];
    citations?: { uri: string; title: string }[];
    brandId?: string | null;
    draftId?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: any;
    platforms?: string[];
    planParam?: string;
    handles?: { platform: string; username: string | null; profileUrl: string | null }[];
    competitors?: { name: string; website: string; kind: 'direct' | 'indirect'; rationale: string; source: 'ai' | 'user' }[];
    additionalContext?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people?: any[];
    userEmail?: string;
    brandName?: string;
    isContinueMode?: boolean;
    oncontinue: () => void;
    onskip: () => void;
    onresult: (result: Record<string, any> | null | undefined) => void;
    onresearched?: () => void;
    onerror?: (step: string, message: unknown, context?: Record<string, unknown>) => void;
  } = $props();

  let openSteps = $state<Record<string, boolean>>({});
  let researchProgress = $state('');
  let researchError = $state('');

  function pushStep(step: string, message: string) {
    if (researchSteps.some((s) => s.step === step)) {
      researchSteps = researchSteps.map((s) => (s.step === step ? { ...s, message } : s));
    } else {
      researchSteps = [...researchSteps, { step, message }];
    }
  }

  export async function research(force = false) {
    if (researching) return;
    if (!force && editorialPlan) return;
    researching = true;
    researchBackground = false;
    researchError = '';
    if (force || !editorialPlan) {
      researchSteps = [];
      report = null;
      researchData = null;
      buyerPersonas = [];
      editorialPlan = null;
      planVisualStyle = null;
    }
    researchProgress = $_('onboarding.status.researchingMarket');
    cancelPoll(pollRef);
    const poll: JobPoll = { cancelled: false };
    pollRef = poll;
    try {
      const outcome = await runStepJob({
        path: '/app/onboarding/research',
        jobId: researchJobId,
        force,
        poll,
        body: {
          brandId,
          draftId,
          profile,
          platforms,
          plan: planParam || null,
          handles,
          competitors,
          additionalContext,
          people
        },
        onProgress: (m, progress) => {
          researchProgress = m || researchProgress;
          if (progress.step) pushStep(String(progress.step), m || researchProgress);
        },
        onResult: onresult
      });
      if (outcome.jobId) researchJobId = outcome.jobId;
      if (outcome.status === 'cancelled') {
        researchBackground = !editorialPlan;
        return;
      }
      if (outcome.status === 'failed' && outcome.error === 'poll timeout') {
        researchBackground = true;
        researchError = '';
        return;
      }
      if (outcome.status === 'failed') {
        onerror?.('research', outcome.error || 'research failed');
        if (!researchError) researchError = $_('onboarding.status.researchFailed');
        return;
      }
      if (editorialPlan) {
        onresearched?.();
        researchBackground = false;
        track('onboarding_plan_proposed', { zero_to_one: editorialPlan?.gtm?.stage === 'zero_to_one' });
      } else if (!researchError) {
        onerror?.('research', 'job done without a plan');
        researchError = $_('onboarding.status.researchFailed');
      }
    } catch (e) {
      onerror?.('research', e instanceof Error ? e.message : 'enqueue failed');
      if (!researchError) researchError = $_('onboarding.status.researchFailed');
    } finally {
      researching = false;
    }
  }

  onMount(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (editorialPlan || researching || researchError) return;
      if (!researchJobId && !researchBackground) return;
      research(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });
</script>

{#if researchSteps.length}
  <ol class="timeline">
    {#each researchSteps as s, si (s.step)}
      {@const isLast = si === researchSteps.length - 1}
      {@const pending = (researching || researchBackground) && isLast}
      {@const hasDetail = !!s.result || (s.step === 'strategy' && report)}
      <li class="tl-item">
        <span class="tl-dot" class:pending>{#if !pending}✓{/if}</span>
        <div class="tl-msg" class:pending>
          {s.message}
          {#if hasDetail}
            <button type="button" class="tl-toggle" onclick={() => (openSteps = { ...openSteps, [s.step]: !openSteps[s.step] })}>
              {openSteps[s.step] ? $_('onboarding.research.hide') : $_('onboarding.research.show')}
            </button>
          {/if}
        </div>

        {#if openSteps[s.step]}
          {#if s.step === 'handles' && s.result?.competitors?.length}
            <div class="tl-result">
              {#each s.result.competitors as c (c.name)}
                <div class="tl-row">
                  <b>{c.name}</b>
                  {#if c.handles?.length}
                    <span class="tl-muted">{c.handles.map((h: { platform: string; username: string | null }) => `${plabel(h.platform)}${h.username ? ` @${h.username}` : ''}`).join(' · ')}</span>
                  {:else}
                    <span class="tl-muted">{$_('onboarding.research.noProfiles')}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if s.step === 'scraping' && s.result?.counts?.length}
            <div class="tl-result">
              {#each s.result.counts as c (c.name)}
                <div class="tl-row"><b>{c.name}</b><span class="tl-muted">{$_('onboarding.research.postsRead', { values: { count: c.posts } })}</span></div>
              {/each}
            </div>
          {:else if s.step === 'benchmark' && s.result}
            <div class="tl-result">
              <div class="tl-row"><b>{$_('onboarding.research.market')}</b><span class="tl-muted">{$_('onboarding.research.marketLine', { values: { eng: s.result.market?.medianEngagement ?? 0, week: s.result.market?.postsPerWeek ?? 0 } })}</span></div>
              {#if s.result.brand}
                <div class="tl-row"><b>{brandName}</b><span class="tl-muted">{$_('onboarding.research.benchStats', { values: { count: s.result.brand.count, eng: s.result.brand.medianEngagement, week: s.result.brand.postsPerWeek } })}</span></div>
              {/if}
              {#each s.result.competitors ?? [] as c (c.name)}
                <div class="tl-row"><b>{c.name}</b><span class="tl-muted">{$_('onboarding.research.benchStats', { values: { count: c.count, eng: c.medianEngagement, week: c.postsPerWeek } })}</span></div>
              {/each}
            </div>
          {:else if s.step === 'analysis' && s.result?.text}
            <div class="tl-result"><div class="tl-text md">{@html renderMd(s.result.text)}</div></div>
          {:else if s.step === 'strategy' && report}
            <div class="report tl-report">
              {#if report.whiteSpace?.length}
                <div class="report-sec"><div class="report-h">{$_('onboarding.report.whiteSpace')}</div>
                  <ul>{#each report.whiteSpace as w (w)}<li>{w}</li>{/each}</ul></div>
              {/if}
              {#if report.differentiators?.length}
                <div class="report-sec"><div class="report-h">{$_('onboarding.report.edge')}</div>
                  <ul>{#each report.differentiators as dd (dd)}<li>{dd}</li>{/each}</ul></div>
              {/if}
            </div>
          {/if}
        {/if}
      </li>
    {/each}
  </ol>
{:else if researching || researchBackground}
  <div class="preview-head"><span class="hsp"></span>{researchProgress || $_('onboarding.status.researchingMarket')}</div>
  {#if researchBackground}
    <p class="hint">{$_('onboarding.status.researchBackground')}</p>
  {/if}
{/if}

{#if report}
  <div class="report">
    <div class="report-top">
      <span class="report-badge">{$_('onboarding.report.badge')}</span>
      {#if citations.length}<span class="report-sources">{$_('onboarding.report.sourcesResearched', { values: { count: citations.length } })}</span>{/if}
    </div>
    {#if report.summary}<p class="mf-summary">{report.summary}</p>{/if}
    {#if report.whiteSpace?.length}
      <div class="report-sec"><div class="report-h">{$_('onboarding.report.whiteSpace')}</div>
        <ul>{#each report.whiteSpace as w (w)}<li>{w}</li>{/each}</ul></div>
    {/if}
    {#if report.differentiators?.length}
      <div class="report-sec"><div class="report-h">{$_('onboarding.report.edge')}</div>
        <ul>{#each report.differentiators as dd (dd)}<li>{dd}</li>{/each}</ul></div>
    {/if}
    {#if report.platformGuidance?.length}
      <div class="report-sec"><div class="report-h">{$_('onboarding.report.platformGuidance')}</div>
        <ul class="report-plats">{#each report.platformGuidance as g (g.platform)}
          <li><b>{plabel(g.platform)}:</b> {g.recommendation} — {g.why}</li>
        {/each}</ul></div>
    {/if}
  </div>
{/if}

{#if buyerPersonas.length}
  <div class="personas-box">
    <div class="report-h">{$_('onboarding.strategy.personas')}</div>
    <div class="personas-grid">
      {#each buyerPersonas as persona (persona.name)}
        <div class="persona-card">
          {#if persona.imageUrl}<img src={persona.imageUrl} alt={persona.name} class="persona-image" />{/if}
          <div class="persona-name">{persona.name}</div>
          {#if persona.role}<div class="persona-role">{persona.role}</div>{/if}
          {#if persona.painPoints?.length}
            <ul class="persona-list">{#each persona.painPoints.slice(0, 3) as pain (pain)}<li>{pain}</li>{/each}</ul>
          {/if}
          {#if persona.preferredChannels?.length}
            <div class="persona-channels">
              {#each persona.preferredChannels as channel (channel)}<span class="channel-badge">{plabel(channel)}</span>{/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if researchError}
  <p class="err">{researchError}</p>
  <button type="button" class="ghost retry-btn" onclick={() => research(true)} disabled={researching}>{$_('onboarding.retry')}</button>
{/if}

{#if (researching || researchBackground) && !editorialPlan && !researchError}
  <div class="cta-row cta-row-setup">
    {#if isContinueMode}
      <button type="button" class="ghost" onclick={onskip}>{$_('onboarding.finishLater')}</button>
    {/if}
  </div>
{/if}

{#if editorialPlan && !researching}
  <!-- Sticky: il report è lungo, Continua non deve mai richiedere di scorrere fino in fondo. -->
  <div class="cta-row cta-row-setup">
    {#if isContinueMode}
      <button type="button" class="ghost" onclick={onskip}>{$_('onboarding.finishLater')}</button>
    {/if}
    <button class="primary cta-press" onclick={oncontinue}>{$_('onboarding.strategy.continue')}</button>
  </div>
{/if}

<style>
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }
  .retry-btn { margin-top: 12px; }

  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }

  .cta-row .primary, .cta-row .ghost { margin-top: 0; }
  /* Azione primaria appiccicata in fondo negli step lunghi. I margini negativi pareggiano il
     padding orizzontale di .wrap: senza, la barra non arriva ai bordi. */
  .cta-row-setup {
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin: 24px calc(-1 * clamp(24px, 5vw, 64px)) 0;
    padding: 14px clamp(24px, 5vw, 64px) calc(14px + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--paper, #fff) 92%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-top: 1px solid var(--line, #e3e3e6);
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .preview-head { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 9px; margin: 24px 0 14px; color: var(--ink-soft, #6e6e73); }
  .hsp { width: 15px; height: 15px; flex: 0 0 auto; border-radius: 50%; border: 2px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent, #7c5cff); animation: spin 0.8s linear infinite; }

  .timeline { list-style: none; margin: 24px 0 0; padding: 0; display: flex; flex-direction: column; }
  .tl-item { position: relative; padding: 0 0 18px 36px; }
  .tl-item::before { content: ''; position: absolute; left: 10px; top: 24px; bottom: -2px; width: 2px; background: var(--line, #e3e3e6); }
  .tl-item:last-child { padding-bottom: 0; }
  .tl-item:last-child::before { display: none; }
  .tl-dot { position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
    background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .tl-dot.pending { background: transparent; border: 2.5px solid rgba(var(--accent-rgb), 0.25);
    border-top-color: var(--accent, #7c5cff); animation: spin 0.8s linear infinite; }
  .tl-msg { font-size: 14px; font-weight: 600; color: var(--ink, #1d1d1f); line-height: 1.5; padding-top: 1px; }
  .tl-msg.pending { color: var(--ink-soft, #6e6e73); }
  .tl-result { margin-top: 8px; border: 1px solid var(--line, #e3e3e6); border-radius: 12px;
    background: var(--paper, #fff); padding: 11px 13px; display: flex; flex-direction: column; gap: 6px; }
  .tl-row { display: flex; align-items: baseline; gap: 9px; font-size: 13px; flex-wrap: wrap; }
  .tl-row b { color: var(--ink, #1d1d1f); }
  .tl-muted { color: var(--ink-soft, #6e6e73); }
  .tl-text { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink, #1d1d1f); white-space: pre-wrap; word-wrap: break-word; }
  /* Variante markdown: il formatter emette blocchi suoi, quindi niente pre-wrap. */
  .tl-text.md { white-space: normal; }
  .tl-text.md :global(h1), .tl-text.md :global(h2), .tl-text.md :global(h3), .tl-text.md :global(h4) {
    font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; margin: 12px 0 4px; }
  .tl-text.md :global(h1:first-child), .tl-text.md :global(h2:first-child),
  .tl-text.md :global(h3:first-child), .tl-text.md :global(h4:first-child) { margin-top: 0; }
  .tl-text.md :global(ul), .tl-text.md :global(ol) { margin: 6px 0; padding-left: 18px; }
  .tl-text.md :global(li) { margin: 3px 0; }
  .tl-text.md :global(strong) { font-weight: 700; color: var(--ink, #1d1d1f); }
  .tl-text.md :global(em) { color: var(--ink-soft, #6e6e73); }
  .tl-text.md :global(a) { color: var(--accent, #7c5cff); }
  .tl-text.md :global(blockquote) { margin: 6px 0; padding-left: 10px; border-left: 2px solid var(--line, #e3e3e6); color: var(--ink-soft, #6e6e73); }
  .tl-text.md :global(hr) { border: none; border-top: 1px solid var(--line, #e3e3e6); margin: 10px 0; }
  .tl-text.md :global(code) { font-size: 12.5px; padding: 1px 4px; border-radius: 5px; background: var(--paper-2, #f5f5f7); }
  .tl-report { margin-top: 10px; }
  .tl-toggle { background: none; border: none; padding: 0 0 0 8px; font-size: 12px; font-weight: 600; color: var(--accent, #7c5cff); cursor: pointer; }
  .tl-toggle:hover { text-decoration: underline; }
  .tl-item { animation: rise 0.45s var(--ease, ease) both; }
  @media (prefers-reduced-motion: reduce) {
    .tl-item { animation: none; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

  .report { border: 1px solid var(--line, #e3e3e6); border-radius: 16px; padding: 18px 18px 20px; margin-top: 22px;
    background: linear-gradient(165deg, rgba(var(--accent-rgb), 0.04), rgba(var(--accent-2-rgb), 0.05)); }
  .report-top { display: flex; align-items: center; gap: 10px; }
  .report-badge { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #fff;
    background: var(--accent, #7c5cff); border-radius: 980px; padding: 3px 10px; }
  .report-sources { font-size: 12px; color: var(--ink-faint, #86868b); }
  .report-sec { margin-top: 14px; }
  .report-h { font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--ink-faint, #86868b); margin-bottom: 6px; }
  .report-sec ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  .report-sec li { font-size: 13.5px; line-height: 1.45; color: var(--ink, #1d1d1f); }
  .report-plats { padding-left: 0; }
  .report-plats li { list-style: none; }

  .personas-box { margin-top: 26px; padding: 20px; border-radius: 16px; border: 1px solid var(--line, #e3e3e6); background: var(--paper-2, #f5f5f7); }
  .personas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 12px; }
  .persona-card { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 12px; border: 1px solid var(--line, #e3e3e6); background: var(--paper, #fff); }
  .persona-image { width: 100%; height: 130px; object-fit: cover; border-radius: 8px; margin-bottom: 6px; }
  .persona-name { font-weight: 700; font-size: 14px; color: var(--ink, #1d1d1f); }
  .persona-role { font-size: 12px; color: var(--ink-soft, #6e6e73); }
  .persona-list { margin: 4px 0 0; padding-left: 16px; color: var(--ink-soft, #6e6e73); font-size: 12px; }
  .persona-list li { margin: 2px 0; line-height: 1.4; }
  .persona-channels { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .channel-badge { display: inline-block; padding: 4px 8px; border-radius: 6px; background: rgba(var(--accent-rgb), 0.1); color: var(--accent, #7c5cff); font-size: 11px; font-weight: 600; }

  @media (max-width: 860px) {
    /* On phones the sticky bar goes full-width and its button spans it (thumb-sized target). */
    .cta-row-setup {
      justify-content: stretch;
      margin: 24px -22px 0;
      padding: 14px 22px calc(14px + env(safe-area-inset-bottom));
    }
    .cta-row-setup .primary { flex: 1; height: 48px; font-size: 16px; margin-top: 0; }
  }
</style>
