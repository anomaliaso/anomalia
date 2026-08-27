<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { onDestroy } from 'svelte';
  import PlatformMixBars from '$lib/components/PlatformMixBars.svelte';
  import StrategyHistory from '$lib/components/StrategyHistory.svelte';
  import { pageTips } from '$lib/stores/page-tips';
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import { Pencil } from '@lucide/svelte';

  // Reset tips when navigating away from this page.
  onDestroy(() => pageTips.set([]));
  type Horizon = '90d' | '6m';
  type PhaseUI = {
    index: number; name: string; objective: string; rationale: string; duration_weeks: number;
    start_date: string | null; end_date: string | null;
    platform_weights: Array<{ platform: string; percent: number }>; pillars: string[];
    // metric tags a CODE-STAMPED funnel goal — surfaced in the dedicated Funnel panel, filtered
    // out of the per-phase goals grid to avoid crowding/duplication (data kept for planner/review).
    goals: Array<{ kpi: string; target: string; why: string; metric?: string }>;
  };
  type FunnelUI = {
    final: { metric: string; value: number };
    rates: { reach_to_click: number; click_to_signup: number; signup_to_active: number };
  };
  type DualPlanUI = {
    id?: string; status?: string; horizon: string; objective: string;
    phases: PhaseUI[]; phases_90d?: PhaseUI[]; phases_6m?: PhaseUI[];
    funnel?: FunnelUI | null;
    reply?: string; changes_summary?: string[];
  };

  // Client-side helpers (mirrors of $lib/server/gtm.ts — kept inline to avoid server import).
  function phasesFor(plan: DualPlanUI | null, h: Horizon): PhaseUI[] {
    if (!plan) return [];
    return h === '90d' ? (plan.phases_90d ?? []) : (plan.phases_6m ?? []);
  }
  function pStatus(p: { start_date: string | null; end_date: string | null }, tz: string): 'done' | 'now' | 'next' {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (p.end_date && today >= p.end_date) return 'done';
    if (p.start_date && today >= p.start_date) return 'now';
    return 'next';
  }
  function curPhaseIdx(phases: PhaseUI[], tz: string): number | null {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!phases.length || !phases[0].start_date) return null;
    if (today < phases[0].start_date) return 0;
    for (const p of phases) {
      if (p.start_date && p.end_date && today >= p.start_date && today < p.end_date) return p.index;
    }
    return null;
  }

  let { data, form } = $props();

  const PMETA: Record<string, { l: string; c: string }> = {
    instagram: { l: 'Instagram', c: '#dd2a7b' },
    tiktok: { l: 'TikTok', c: '#111' },
    facebook: { l: 'Facebook', c: '#1877f2' },
    linkedin: { l: 'LinkedIn', c: '#0a66c2' },
    x: { l: 'X', c: '#0a0a0a' },
    threads: { l: 'Threads', c: '#444' },
    youtube: { l: 'YouTube', c: '#ff0000' },
    bluesky: { l: 'Bluesky', c: '#0285ff' },
    reddit: { l: 'Reddit', c: '#ff4500' }
  };

  let busy = $state('');
  const working = (name: string) => () => {
    busy = name;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = '';
    };
  };

  // Client-side horizon toggle: switches the view without re-generating.
  let viewHorizon = $state<Horizon>('6m');
  const gtm = $derived(data.gtm as DualPlanUI | null);

  // ── Funnel assumptions (Correzione 2): the explicit, editable source of truth for the plan's
  // numbers. The server owns the arithmetic; here we only MIRROR it to preview the chain and to
  // render the rates as percentages, always labelled as "ipotesi". ──
  const funnel = $derived(gtm?.funnel ?? null);
  const pctOf = (v: number) => Math.round(v * 1000) / 10;
  // Mirror of computeFunnelTargets (ceil at each stage) — display only; server value is canonical.
  const funnelChain = $derived(
    funnel
      ? (() => {
          const active = funnel.final.value;
          const signups = Math.ceil(active / funnel.rates.signup_to_active);
          const clicks = Math.ceil(signups / funnel.rates.click_to_signup);
          const reach = Math.ceil(clicks / funnel.rates.reach_to_click);
          return { active, signups, clicks, reach };
        })()
      : null
  );
  const fmtN = (n: number) => n.toLocaleString('it-IT');

  // Edit state: the form pre-fills from the current spec (percentages as whole numbers).
  let editingFunnel = $state(false);
  let fFinalMetric = $state('');
  let fFinalValue = $state(0);
  let fReachToClick = $state(0);
  let fClickToSignup = $state(0);
  let fSignupToActive = $state(0);
  function openFunnelEdit() {
    if (!funnel) return;
    fFinalMetric = funnel.final.metric;
    fFinalValue = funnel.final.value;
    fReachToClick = pctOf(funnel.rates.reach_to_click);
    fClickToSignup = pctOf(funnel.rates.click_to_signup);
    fSignupToActive = pctOf(funnel.rates.signup_to_active);
    editingFunnel = true;
  }

  const activePhases = $derived(phasesFor(gtm, viewHorizon));
  // Derived plan object that reflects the currently selected horizon's phases.
  const plan = $derived(gtm ? { ...gtm, phases: activePhases, horizon: viewHorizon } as DualPlanUI : null);
  // Phase statuses derived client-side for the active horizon.
  const phaseStatuses = $derived(activePhases.map((p) => pStatus(p, data.brand.timezone)));
  const currentPhase = $derived(activePhases.length ? curPhaseIdx(activePhases, data.brand.timezone) : null);
  const reviewablePhase = $derived(plan ? (() => {
    const reversed = [...activePhases].reverse();
    const done = reversed.find((p) => pStatus(p, data.brand.timezone) === 'done');
    return done?.index ?? null;
  })() : null);

  // Selected phase drives the three panels below the timeline.
  let selected = $state(0);
  $effect(() => {
    selected = currentPhase ?? 0;
  });

  let objective = $state('');

  // Inline objective edit: re-proposes the whole roadmap around the new goal —
  // still a proposal the user reviews, per the propose→approve principle.
  let editingObjective = $state(false);
  function openObjectiveEdit() {
    objective = plan?.objective ?? '';
    editingObjective = true;
  }

  // Trash the active roadmap (delete the gtm_plan row) — 2-step inline confirm.
  let delConfirm = $state(false);

  // Proposal horizon toggle: switch between 90d/6m views within a pending proposal.
  let proposalHorizon = $state<Horizon>('6m');
  const proposedGtm = $derived(data.proposed as DualPlanUI | null);
  const proposedPhases = $derived(phasesFor(proposedGtm, proposalHorizon));

  function rangeLabel(p: { start_date: string | null; end_date: string | null }): string {
    if (!p.start_date || !p.end_date) return '';
    const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `${f(p.start_date)} → ${f(p.end_date)}`;
  }

  // "Mese 1-2" style label from the cumulative week position — friendlier than raw weeks and
  // works for unstamped proposals too.
  const WEEKS_PER_MONTH = 4.345;
  type PhaseLike = { duration_weeks: number };
  function monthLabel(phases: PhaseLike[], i: number): string {
    const prev = phases.slice(0, i).reduce((a, p) => a + p.duration_weeks, 0);
    const a = Math.round(prev / WEEKS_PER_MONTH) + 1;
    const b = Math.max(a, Math.round((prev + phases[i].duration_weeks) / WEEKS_PER_MONTH));
    return b > a ? $_('gtm.monthRange', { values: { a, b } }) : $_('gtm.month', { values: { n: a } });
  }

  // "Settimana 3 di 9" + fill ratio for the running phase — where we are inside the phase.
  function phaseProgress(p: { start_date: string | null; duration_weeks: number }): { week: number; pct: number } | null {
    if (!p.start_date || !p.duration_weeks) return null;
    const start = new Date(`${p.start_date}T00:00:00Z`).getTime();
    const week = Math.min(Math.max(Math.floor((Date.now() - start) / (7 * 864e5)) + 1, 1), p.duration_weeks);
    return { week, pct: Math.round((week / p.duration_weeks) * 100) };
  }

  // Horizontal timeline data: positions and ticks derived from phases + horizon.
  const totalWeeks = $derived(plan ? plan.phases.reduce((a, p) => a + p.duration_weeks, 0) : 0);
  const tlPhases = $derived(plan ? (() => {
    let cumWeeks = 0;
    return plan.phases.map((p) => {
      const left = totalWeeks > 0 ? (cumWeeks / totalWeeks) * 100 : 0;
      const width = totalWeeks > 0 ? (p.duration_weeks / totalWeeks) * 100 : 0;
      cumWeeks += p.duration_weeks;
      return { index: p.index, left, width };
    });
  })() : []);
  const nowPct = $derived((() => {
    if (!plan || !plan.phases.length || !plan.phases[0].start_date) return null;
    const start = new Date(`${plan.phases[0].start_date}T00:00:00Z`).getTime();
    const endMs = totalWeeks * 7 * 864e5;
    const elapsed = Date.now() - start;
    if (endMs <= 0) return null;
    return Math.min(Math.max((elapsed / endMs) * 100, 0), 100);
  })());
  const nowPhaseIdx = $derived(nowPct != null ? (() => {
    for (const tp of tlPhases) {
      if (nowPct < tp.left + tp.width) return tp.index;
    }
    return tlPhases[tlPhases.length - 1]?.index ?? 0;
  })() : null);
  const tlTicks = $derived((() => {
    if (!plan || totalWeeks <= 0) return [];
    const ticks: Array<{ pct: number; label: string }> = [];
    const startDate = plan.phases[0]?.start_date;
    const startLabel = startDate
      ? new Date(`${startDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : $_('gtm.tl.start');
    if (viewHorizon === '90d') {
      for (let w = 0; w <= totalWeeks; w++) {
        ticks.push({ pct: (w / totalWeeks) * 100, label: w === 0 ? startLabel : `${w}` });
      }
    } else {
      for (let m = 0; m * WEEKS_PER_MONTH <= totalWeeks; m++) {
        ticks.push({ pct: Math.min((m * WEEKS_PER_MONTH / totalWeeks) * 100, 100), label: m === 0 ? startLabel : $_('gtm.month', { values: { n: m } }) });
      }
    }
    return ticks;
  })());

  const phase = $derived(plan?.phases?.[selected] ?? null);

  // Page tips: populate the floating bubble with contextual suggestions.
  $effect(() => {
    const tips = [];
    if (data.studioPct < 100) {
      tips.push({
        id: 'studio',
        text: $_('gtm.studio.note', { values: { pct: data.studioPct } }),
        cta: $_('gtm.studio.cta'),
        href: `/app/${data.brand.slug}/settings/brand`
      });
    }
    if (data.needs90dRefresh && plan) {
      tips.push({
        id: 'refresh90d',
        text: $_('gtm.refresh90d.banner'),
        cta: $_('gtm.refresh90d.cta')
      });
    }
    pageTips.set(tips);
  });
</script>

<svelte:head><title>Anomalia — {$_('gtm.title')}</title></svelte:head>

<div class="content">
  <PageHead
    title={$_('gtm.title')}
    subtitle={(plan?.objective ? $_('gtm.objective', { values: { o: plan.objective } }) : $_('gtm.subtitle')) + ' · ' + $_('gtm.principle')}
  >
    {#snippet actions()}
      {#if plan && !editingObjective}
        <TopbarCta type="button" variant="ghost" Icon={Pencil} onclick={openObjectiveEdit}>
          {$_('gtm.objectiveEdit.open')}
        </TopbarCta>
      {/if}
    {/snippet}
  </PageHead>

  {#if data.horizons && viewHorizon !== undefined}
    <div class="horizon-filter">
      {#each data.horizons as h (h)}
        <button
          type="button"
          class="hseg"
          class:on={viewHorizon === h}
          onclick={() => (viewHorizon = h as typeof viewHorizon)}
        >{$_('gtm.horizons.' + h)}</button>
      {/each}
    </div>
  {/if}

  <!-- Inline objective change: Anomalia re-proposes the roadmap (both horizons) around the new goal -->
  {#if editingObjective && plan}
    <form method="POST" action="?/propose" use:enhance={working('propose')} class="obj-form">
      <input class="obj-input" name="objective" bind:value={objective} placeholder={$_('gtm.empty.objectivePlaceholder')} />
      <button class="btn-primary" disabled={busy !== ''}>{$_('gtm.objectiveEdit.send')}</button>
      <button type="button" class="btn-ghost" onclick={() => (editingObjective = false)}>{$_('gtm.redirect.cancel')}</button>
    </form>
  {/if}

  <!-- 90d plan expired but 6m still active → prompt to regenerate the tactical plan -->
  {#if data.needs90dRefresh && plan}
    <div class="banner refresh">
      <p>{$_('gtm.refresh90d.banner')}</p>
      <form method="POST" action="?/refresh90d" use:enhance={working('refresh90d')}>
        <input type="hidden" name="plan_id" value={plan.id} />
        <button class="btn-primary" disabled={busy !== ''}>{busy === 'refresh90d' ? $_('gtm.refresh90d.working') : $_('gtm.refresh90d.cta')}</button>
      </form>
    </div>
  {/if}

  {#if form?.error}<p class="err">{$_('gtm.actionFailed')}</p>{/if}
  {#if form?.reviewed && form?.verdict === 'on_track'}
    <div class="banner ok">{form.message}</div>
  {/if}
  {#if busy === 'propose'}<div class="working"><span class="hsp"></span>{$_('gtm.proposing')}</div>{/if}

  <!-- Pending proposal (first plan / redirect / phase-review correction) -->
  {#if data.proposed}
    <section class="proposal">
      <div class="prop-head">
        <span class="prop-badge">
          {data.proposedSource === 'phase_review' ? $_('gtm.proposal.reviewTitle') : $_('gtm.proposal.title')}
        </span>
        <!-- Horizon toggle within proposal: shows 90d or 6m phases -->
        <div class="prop-horizon-toggle">
          {#each data.horizons as h (h)}
            <button
              type="button"
              class="hseg"
              class:on={proposalHorizon === h}
              onclick={() => (proposalHorizon = h as Horizon)}
            >{$_('gtm.horizons.' + h)}</button>
          {/each}
        </div>
      </div>
      <!-- The conversation: the user's request and Anomalia's motivated reply (brief §5.3) -->
      {#if data.proposedFeedback || data.proposed.reply}
        <div class="convo">
          {#if data.proposedFeedback}<p class="convo-user">"{data.proposedFeedback}"</p>{/if}
          {#if data.proposed.reply}<p class="convo-anomalia"><b>Anomalia:</b> {data.proposed.reply}</p>{/if}
        </div>
      {/if}
      {#if data.proposed.changes_summary?.length}
        <ul class="prop-changes">{#each data.proposed.changes_summary as c (c)}<li>{c}</li>{/each}</ul>
      {/if}
      {#if data.proposed.objective}<p class="prop-obj">{$_('gtm.objective', { values: { o: data.proposed.objective } })}</p>{/if}
      <div class="prop-phases">
        {#each proposedPhases as p (p.index)}
          <div class="prop-phase">
            <div class="pp-name">{p.index + 1}. {p.name} <span class="pp-w">({monthLabel(proposedPhases, p.index)} · {$_('gtm.weeks', { values: { n: p.duration_weeks } })})</span></div>
            <p class="pp-obj">{p.objective}</p>
            {#if p.platform_weights?.length}
              <p class="pp-mix">{p.platform_weights.map((w: { platform: string; percent: number }) => `${PMETA[w.platform]?.l ?? w.platform} ${w.percent}%`).join(' · ')}</p>
            {/if}
            {#if p.goals?.length}<p class="pp-goals">{p.goals.map((g: { kpi: string; target: string }) => `${g.kpi}: ${g.target}`).join(' · ')}</p>{/if}
          </div>
        {/each}
      </div>
      <div class="prop-actions">
        <form method="POST" action="?/approve" use:enhance={working('approve')}>
          <input type="hidden" name="plan_id" value={data.proposed.id} />
          <button class="btn-primary" disabled={busy !== ''}>{$_('gtm.proposal.approve')}</button>
        </form>
        <form method="POST" action="?/discard" use:enhance={working('discard')}>
          <input type="hidden" name="plan_id" value={data.proposed.id} />
          <button class="btn-ghost" disabled={busy !== ''}>{$_('gtm.proposal.discard')}</button>
        </form>
      </div>
    </section>
  {/if}

  {#if plan}
    <!-- Horizontal phase timeline with week/month ticks and "now" marker -->
    <div class="phases-timeline">
      <div class="tl-bar-wrap">
        <div class="tl-bar-track">
          {#each tlPhases as tp (tp.index)}
            <button
              type="button"
              class="tl-seg"
              class:sel={selected === tp.index}
              data-s={phaseStatuses[tp.index]}
              style={`left:${tp.left}%;width:${tp.width}%`}
              onclick={() => (selected = tp.index)}
              title={plan.phases[tp.index]?.name}
            >
              <span class="tl-seg-name">{plan.phases[tp.index]?.name}</span>
            </button>
          {/each}
          {#if nowPct != null}
            <div class="tl-now" style={`left:${nowPct}%`}>
              <span class="tl-now-label">{$_('gtm.tl.nowMarker')}</span>
            </div>
          {/if}
        </div>
        <div class="tl-ticks">
          {#each tlTicks as tick, ti (ti)}
            <span class="tl-tick" style={`left:${tick.pct}%`}>{tick.label}</span>
          {/each}
        </div>
      </div>
    </div>

    <!-- Funnel assumptions: explicit, editable, always labelled as hypotheses (Correzione 2) -->
    {#if funnel && funnelChain}
      <section class="funnel">
        <div class="fn-head">
          <span class="fn-title">{$_('gtm.funnel.title')}</span>
          <span class="fn-badge">{$_('gtm.funnel.assumptionsBadge')}</span>
          {#if plan && !editingFunnel}
            <button type="button" class="fn-edit" onclick={openFunnelEdit}>{$_('gtm.funnel.edit')}</button>
          {/if}
        </div>
        <p class="fn-intro">{$_('gtm.funnel.intro')}</p>

        {#if form?.funnelUpdated}<p class="fn-saved">{$_('gtm.funnel.saved')}</p>{/if}

        {#if editingFunnel}
          <form method="POST" action="?/updateFunnel" use:enhance={working('funnel')} class="fn-form">
            <input type="hidden" name="plan_id" value={plan?.id} />
            <div class="fn-grid">
              <label class="fn-field fn-wide">
                <span>{$_('gtm.funnel.finalLabel')}</span>
                <div class="fn-final-inputs">
                  <input type="number" name="final_value" min="1" step="1" bind:value={fFinalValue} />
                  <input type="text" name="final_metric" bind:value={fFinalMetric} placeholder={$_('gtm.funnel.metricPlaceholder')} />
                </div>
              </label>
              <label class="fn-field">
                <span>{$_('gtm.funnel.reachToClick')}</span>
                <div class="fn-pct"><input type="number" name="reach_to_click_pct" min="0.1" max="10" step="0.1" bind:value={fReachToClick} /><span>%</span></div>
              </label>
              <label class="fn-field">
                <span>{$_('gtm.funnel.clickToSignup')}</span>
                <div class="fn-pct"><input type="number" name="click_to_signup_pct" min="0.5" max="25" step="0.5" bind:value={fClickToSignup} /><span>%</span></div>
              </label>
              <label class="fn-field">
                <span>{$_('gtm.funnel.signupToActive')}</span>
                <div class="fn-pct"><input type="number" name="signup_to_active_pct" min="5" max="80" step="1" bind:value={fSignupToActive} /><span>%</span></div>
              </label>
            </div>
            <p class="fn-hint">{$_('gtm.funnel.hint')}</p>
            <div class="fn-actions">
              <button class="btn-primary" disabled={busy !== ''}>{busy === 'funnel' ? $_('gtm.funnel.saving') : $_('gtm.funnel.save')}</button>
              <button type="button" class="btn-ghost" onclick={() => (editingFunnel = false)}>{$_('gtm.funnel.cancel')}</button>
            </div>
          </form>
        {:else}
          <div class="fn-body">
            <div class="fn-final">
              <span class="fn-final-num">{fmtN(funnelChain.active)}</span>
              <span class="fn-final-metric">{funnel.final.metric}</span>
            </div>
            <p class="fn-chain">{$_('gtm.funnel.chain', { values: { signups: fmtN(funnelChain.signups), clicks: fmtN(funnelChain.clicks), reach: fmtN(funnelChain.reach) } })}</p>
            <div class="fn-rates">
              <span class="fn-rate">{$_('gtm.funnel.reachToClick')} <b>ipotesi: {pctOf(funnel.rates.reach_to_click)}%</b></span>
              <span class="fn-rate">{$_('gtm.funnel.clickToSignup')} <b>ipotesi: {pctOf(funnel.rates.click_to_signup)}%</b></span>
              <span class="fn-rate">{$_('gtm.funnel.signupToActive')} <b>ipotesi: {pctOf(funnel.rates.signup_to_active)}%</b></span>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    {#if phase}
      {@const qualGoals = phase.goals.filter((g) => !g.metric)}
      <section class="phase-story">
          <div class="ps-head">
            <div class="ps-head-left">
              <h3 class="ps-name">{phase.name}</h3>
              <div class="ps-meta">
                <span class="ps-status" data-s={phaseStatuses[selected]}>{$_('gtm.status.' + phaseStatuses[selected])}</span>
                <span class="ps-range">{monthLabel(plan.phases, selected)}{#if rangeLabel(phase)} · {rangeLabel(phase)}{/if}</span>
              </div>
            </div>
            {#if phase.rationale}
              <p class="ps-rationale">{phase.rationale}</p>
            {/if}
          </div>

        {#if qualGoals.length}
          <div class="ps-block">
            <div class="ps-label">{$_('gtm.goals')}</div>
            <div class="ps-goals">
              {#each qualGoals as g (g.kpi)}
                {@const numMatch = g.target.match(/(\d[\d.,]*)/)}
                {@const num = numMatch ? numMatch[1] : null}
                {@const rest = num ? g.target.replace(num, '').trim() : g.target}
                <div class="ps-goal">
                  <span class="ps-goal-kpi">{g.kpi}</span>
                  {#if num}
                    <div class="ps-goal-hero">
                      <span class="ps-goal-num">{num}</span>
                      <span class="ps-goal-unit">{rest}</span>
                    </div>
                  {:else}
                    <div class="ps-goal-hero">
                      <span class="ps-goal-unit plain">{g.target}</span>
                    </div>
                  {/if}
                  {#if g.why}<p class="ps-goal-why">{g.why}</p>{/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if phase.pillars?.length}
          <div class="ps-block">
            <div class="ps-label">{$_('gtm.pillars')}</div>
            <div class="ps-pillars">{#each phase.pillars as pl (pl)}<span class="ps-pillar">{pl}</span>{/each}</div>
          </div>
        {/if}

        {#if phase.platform_weights?.length}
          <div class="ps-block">
            <div class="ps-label">{$_('gtm.weightsLabel')}</div>
            <PlatformMixBars mix={phase.platform_weights} />
          </div>
        {/if}
      </section>

      {#if reviewablePhase != null}
        <section class="review-cta">
          <p>{$_('gtm.review.prompt', { values: { name: plan.phases[reviewablePhase]?.name ?? '' } })}</p>
          <form method="POST" action="?/review" use:enhance={working('review')}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="phase" value={reviewablePhase} />
            <button class="btn-ghost" disabled={busy !== ''}>{busy === 'review' ? $_('gtm.review.checking') : $_('gtm.review.cta')}</button>
          </form>
        </section>
      {/if}
    {/if}
  {:else if !data.proposed}
    <!-- No roadmap yet: objective + generate (both horizons at once) -->
    <section class="empty">
      <img class="empty-hero" src="/plan-hero.webp" alt="" />
      <h3>{$_('gtm.empty.title')}</h3>
      <p>{$_('gtm.empty.body')}</p>
      <form method="POST" action="?/propose" use:enhance={working('propose')} class="empty-form">
        <input class="obj-input" name="objective" bind:value={objective} placeholder={$_('gtm.empty.objectivePlaceholder')} />
        <button class="btn-primary" disabled={busy === 'propose'}>{busy === 'propose' ? $_('gtm.proposing') : $_('gtm.empty.cta')}</button>
      </form>
    </section>
  {/if}

  <!-- Accenno + consequenzialità: la direzione è definita → si passa al Piano editoriale. -->
  {#if plan}
    <div class="strat-actions">
      <a class="next-cta" href={`/app/${data.brand.slug}/plan`}>{$_('app.strategyTabs.next')}</a>
      {#if delConfirm}
        <form method="POST" action="?/deleteVersion" use:enhance={working('del')}>
          <input type="hidden" name="id" value={plan.id} />
          <button class="strat-del confirm" type="submit" disabled={busy !== ''}>{$_('history.confirmDelete')}</button>
        </form>
        <button type="button" class="strat-del cancel" onclick={() => (delConfirm = false)} aria-label={$_('history.cancel')}>×</button>
      {:else}
        <button type="button" class="strat-del" onclick={() => (delConfirm = true)} title={$_('history.delete')} aria-label={$_('history.delete')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      {/if}
    </div>
  {/if}

  <!-- Storico strategie: le roadmap precedenti (superseded), in sola lettura. -->
  <StrategyHistory versions={data.history} deleteAction="?/deleteVersion">
    {#snippet detail(v)}
      <div class="gh-phases">
        {#each v.phases as p (p.index)}
          <div class="gh-phase">
            <b>{p.index + 1}. {p.name}</b>
            {#if p.objective}<span>{p.objective}</span>{/if}
            {#if p.platform_weights?.length}
              <small>{p.platform_weights.map((w: { platform: string; percent: number }) => `${PMETA[w.platform]?.l ?? w.platform} ${w.percent}%`).join(' · ')}</small>
            {/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StrategyHistory>
</div>

<style>

  /* Forward CTA: the direction is set → move on to the dedicated Piano editoriale page. */
  .next-cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 24px; text-decoration: none;
    background: #1f8a4c; color: #fff; font-size: 14px; font-weight: 600; padding: 12px 20px; border-radius: 12px; }
  .next-cta:hover { filter: brightness(0.95); }
  /* active-strategy trash, aligned with the forward CTA */
  .strat-actions { display: flex; align-items: center; gap: 10px; margin-top: 24px; }
  .strat-actions .next-cta { margin-top: 0; }
  .strat-del { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: none;
    border: 1px solid var(--line, #e3e3e6); border-radius: 12px; padding: 11px; color: var(--ink-faint, #86868b); cursor: pointer; font: inherit; }
  .strat-del svg { width: 17px; height: 17px; }
  .strat-del:hover { color: #c0392b; border-color: #f3b6b0; background: #fdecea; }
  .strat-del:disabled { opacity: 0.5; cursor: default; }
  .strat-del.confirm { background: #c0392b; color: #fff; border-color: #c0392b; font-size: 13.5px; font-weight: 600; padding: 11px 16px; }
  .strat-del.confirm:hover { background: #a93226; color: #fff; }
  .strat-del.cancel { font-size: 18px; padding: 8px 13px; }
  /* history detail: compact phase summary of a superseded roadmap */
  .gh-phases { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; }
  .gh-phase { display: flex; flex-direction: column; gap: 2px; }
  .gh-phase b { font-size: 13.5px; }
  .gh-phase span { font-size: 13px; color: var(--ink-soft, #6e6e73); line-height: 1.4; }
  .gh-phase small { font-size: 12px; color: var(--accent, #7c5cff); font-weight: 600; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .page-head h2 { margin: 0; }
  .page-sub { margin: 6px 0 0; color: var(--ink-soft, #6e6e73); font-size: 14px; }
  .principle { color: var(--accent, #7c5cff); font-weight: 600; }
  .err { color: #c0392b; font-size: 14px; margin-top: 12px; }

  .obj-edit { background: none; border: none; padding: 0; margin-left: 4px; font-size: 13px; font-weight: 500;
    color: var(--ink-faint, #86868b); text-decoration: underline; cursor: pointer; }
  .obj-edit:hover { color: var(--accent, #7c5cff); }
  .obj-form { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .obj-form .obj-input { flex: 1 1 280px; max-width: none; }


  .banner.ok { margin-top: 14px; padding: 12px 16px; border-radius: 12px; font-size: 13.5px;
    background: #ecf8f0; border: 1px solid #bfe5cc; color: #1f8a4c; }
  .banner.refresh { margin-top: 14px; padding: 14px 18px; border-radius: 14px; font-size: 13.5px;
    background: #fff7e6; border: 1px solid #f0d9a8; color: #8a6d1a; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .banner.refresh p { margin: 0; flex: 1; line-height: 1.5; }
  .working { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 14px; color: var(--ink-soft, #6e6e73); }
  .hsp { width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent, #7c5cff);
    animation: spin 0.8s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }


  .horizon-filter {
    display: inline-flex;
    gap: 0;
    border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .hseg { padding: 9px 15px; font-size: 13px; font-weight: 600; background: var(--paper, #fff); color: var(--ink-soft, #6e6e73);
    border: none; border-right: 1px solid var(--line, #e3e3e6); cursor: pointer; display: flex; align-items: center; }
  .hseg:last-child { border-right: none; }
  .hseg.on { background: var(--invert-surface, #1d1d1f); color: #fff; }
  .hseg input { display: none; }

  .phases-timeline { margin-top: 64px; }
  .tl-bar-wrap { position: relative; }
  .tl-bar-track { position: relative; display: flex; height: 40px; border-radius: 10px; overflow: hidden; background: var(--paper-2, #f5f5f7); }
  .tl-seg { position: absolute; top: 0; height: 100%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    font: inherit; color: var(--ink-soft, #6e6e73); font-size: 12px; font-weight: 600; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: var(--paper-2, #f5f5f7); transition: filter 0.15s ease, box-shadow 0.15s ease; }
  .tl-seg:not(:last-child) { border-right: 2px solid var(--paper, #fff); }
  .tl-seg[data-s='done'] { color: var(--ink, #1d1d1f); }
  .tl-seg[data-s='now'] { color: var(--ink, #1d1d1f); }
  .tl-seg:hover { filter: brightness(0.96); }
  .tl-seg.sel { background: var(--accent, #7c5cff); color: #fff; }
  .tl-seg-name { pointer-events: none; }
  .tl-now { position: absolute; top: -4px; bottom: -18px; width: 2px; background: #c0392b; transform: translateX(-50%); z-index: 2; pointer-events: none; }
  .tl-now::before { content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 8px; height: 8px; border-radius: 50%; background: #c0392b; }
  .tl-now-label { position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 700; color: #c0392b; white-space: nowrap; }
  .tl-ticks { position: relative; height: 28px; margin-top: 4px; }
  .tl-tick { position: absolute; top: 0; transform: translateX(-50%); font-size: 10px; color: var(--ink-faint, #86868b); font-weight: 500; white-space: nowrap; }
  .tl-tick::before { content: ''; position: absolute; top: -4px; left: 50%; transform: translateX(-50%); width: 1px; height: 4px; background: var(--line-2, #d2d2d7); }

  .phase-story { padding: 8px 0; margin-top: 48px; }
  .ps-head { display: flex; gap: 32px; margin-bottom: 24px; align-items: flex-start; }
  @container workbench (max-width: 700px) { .ps-head { flex-direction: column; gap: 16px; } }
  .ps-head-left { flex: 1; min-width: 0; }
  .ps-meta { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .ps-status { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
    background: rgba(0, 0, 0, 0.06); color: var(--ink-soft, #6e6e73); text-transform: uppercase; letter-spacing: 0.04em; }
  .ps-status[data-s='now'] { background: rgba(var(--accent-rgb, 124, 92, 255), 0.12); color: var(--accent, #7c5cff); }
  .ps-status[data-s='done'] { background: #ecf8f0; color: #1f8a4c; }
  .ps-range { font-size: 13px; color: var(--ink-faint, #86868b); font-weight: 500; }
  .ps-name { margin: 0; font-size: clamp(28px, 4vw, 44px); font-weight: 600; letter-spacing: -0.03em; line-height: 1.15; }
  .ps-rationale { flex: 1; margin: 0; font-size: 15px; line-height: 1.7; color: var(--ink, #1d1d1f); min-width: 0; }
  .ps-block { margin-top: 56px; padding-top: 48px; border-top: 1px solid var(--line, #e3e3e6); }
  .ps-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint, #86868b); margin-bottom: 12px; }
  .ps-pillars { display: flex; flex-wrap: wrap; gap: 8px; }
  .ps-pillar { padding: 6px 14px; border-radius: 980px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper-2, #f5f5f7);
    font-size: 13px; font-weight: 500; color: var(--ink, #1d1d1f); }
  .ps-goals { display: flex; gap: 8px; }
  .ps-goal { flex: 1; padding: 18px 20px; border-radius: 16px; background: var(--paper-2, #f5f5f7); }
  .ps-goal-kpi { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint, #86868b); margin-bottom: 20px; }
  .ps-goal-hero { display: flex; flex-direction: column; }
  .ps-goal-num { font-size: clamp(36px, 5vw, 52px); font-weight: 200; letter-spacing: -0.04em; line-height: 1; color: var(--ink, #1d1d1f); margin-top: 20px; }
  .ps-goal-unit { font-size: 14px; font-weight: 500; color: var(--ink, #1d1d1f); line-height: 1.3; margin-top: 4px; }
  .ps-goal-unit.plain { font-size: 16px; font-weight: 600; color: var(--ink, #1d1d1f); }
  .ps-goal-why { margin: 8px 0 0; font-size: 13px; color: var(--ink-soft, #6e6e73); line-height: 1.5; }

  .review-cta { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
    border: 1px solid #f0d9a8; background: #fff7e6; border-radius: 14px; padding: 13px 16px; }
  .review-cta p { margin: 0; font-size: 13.5px; color: #8a6d1a; line-height: 1.5; }

  /* Funnel assumptions panel — a plan-level card, radius/border matching /voice's .card. */
  .funnel { margin-top: 40px; border: 1px solid var(--line, #e3e3e6); border-radius: 20px; padding: 20px 22px; background: var(--paper, #fff); }
  .fn-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .fn-title { font-size: 15.5px; font-weight: 700; letter-spacing: -0.03em; }
  /* The badge that makes it unmistakable these are hypotheses, not guarantees. */
  .fn-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 3px 10px; border-radius: 999px; background: #fff3d6; color: #8a6d12; }
  .fn-edit { margin-left: auto; border: none; background: transparent; color: var(--accent, #7c5cff);
    font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; }
  .fn-intro { margin: 8px 0 16px; font-size: 13px; color: var(--ink-soft, #6e6e73); line-height: 1.5; }
  .fn-saved { margin: 0 0 14px; font-size: 13px; color: var(--accent, #7c5cff); font-weight: 600; }

  .fn-body { display: flex; flex-direction: column; gap: 12px; }
  .fn-final { display: flex; align-items: baseline; gap: 10px; }
  .fn-final-num { font-size: clamp(32px, 4vw, 44px); font-weight: 200; letter-spacing: -0.04em; line-height: 1; color: var(--ink, #1d1d1f); }
  .fn-final-metric { font-size: 15px; font-weight: 600; color: var(--ink, #1d1d1f); }
  .fn-chain { margin: 0; font-size: 13.5px; color: var(--ink-soft, #6e6e73); line-height: 1.5; }
  .fn-rates { display: flex; flex-wrap: wrap; gap: 8px; }
  .fn-rate { font-size: 12.5px; color: var(--ink-soft, #6e6e73); padding: 6px 12px; border-radius: 980px;
    background: var(--paper-2, #f5f5f7); border: 1px solid var(--line, #e3e3e6); }
  .fn-rate b { color: var(--ink, #1d1d1f); font-weight: 600; }

  .fn-form { margin-top: 4px; }
  .fn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 18px; }
  .fn-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .fn-field.fn-wide { grid-column: 1 / -1; }
  .fn-field > span { font-size: 12px; font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .fn-final-inputs { display: flex; gap: 8px; }
  .fn-final-inputs input[type='number'] { max-width: 110px; }
  .fn-field input { font-size: 14px; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; color: var(--ink, #1d1d1f); background: var(--paper, #fff); width: 100%; box-sizing: border-box; }
  .fn-field input:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb, 124, 92, 255), 0.1); }
  .fn-pct { display: flex; align-items: center; gap: 6px; }
  .fn-pct span { font-size: 14px; color: var(--ink-soft, #6e6e73); }
  .fn-hint { margin: 12px 0 0; font-size: 12px; color: var(--ink-faint, #86868b); line-height: 1.5; }
  .fn-actions { display: flex; gap: 10px; margin-top: 14px; }
  @container workbench (max-width: 700px) { .fn-grid { grid-template-columns: 1fr; } }

  :global([data-theme='dark']) .funnel { background: var(--paper-2); border-color: var(--line); }
  :global([data-theme='dark']) .fn-badge { background: rgba(163, 112, 10, 0.15); color: #fbbf24; }

  .proposal { margin-top: 18px; border: 1.5px solid var(--accent, #7c5cff); border-radius: 18px; padding: 16px 18px;
    background: var(--paper-2, #f5f5f7); }
  .prop-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .prop-badge { font-size: 12px; font-weight: 700; padding: 4px 11px; border-radius: 999px; background: var(--accent, #7c5cff); color: #fff; }
  .prop-h { font-size: 12.5px; font-weight: 700; color: var(--ink-soft, #6e6e73); }
  .prop-horizon-toggle { display: flex; gap: 0; border: 1px solid var(--line-2, #d2d2d7); border-radius: 10px; overflow: hidden; margin-left: auto; }
  .prop-horizon-toggle .hseg { padding: 6px 12px; font-size: 12px; }
  .convo { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .convo-user { margin: 0; font-size: 13.5px; font-style: italic; color: var(--ink-soft, #6e6e73); }
  .convo-anomalia { margin: 0; font-size: 14px; line-height: 1.55; background: var(--paper, #fff); border: 1px solid var(--line, #e3e3e6);
    border-radius: 12px; padding: 10px 13px; }
  .prop-changes { margin: 10px 0 0; padding-left: 18px; font-size: 13.5px; line-height: 1.6; }
  .prop-obj { margin: 10px 0 0; font-size: 13.5px; font-weight: 600; }
  .prop-phases { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .prop-phase { border: 1px solid var(--line, #e3e3e6); border-radius: 12px; padding: 11px 13px; background: var(--paper, #fff); }
  .pp-name { font-size: 14px; font-weight: 700; }
  .pp-w { font-weight: 400; color: var(--ink-faint, #86868b); font-size: 12.5px; }
  .pp-obj { margin: 3px 0 0; font-size: 13px; line-height: 1.45; }
  .pp-mix { margin: 4px 0 0; font-size: 12.5px; color: var(--accent, #7c5cff); font-weight: 600; }
  .pp-goals { margin: 3px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); }
  .prop-actions { display: flex; gap: 10px; margin-top: 14px; }

  .empty { margin-top: 26px; text-align: center; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 18px; padding: 24px; }
  .empty h3 { margin: 0; font-size: 1.15rem; }
  .empty p { color: var(--ink-soft, #6e6e73); font-size: 14px; margin: 8px auto 18px; max-width: 50ch; line-height: 1.5; }
  .empty-hero { width: 100%; max-width: 560px; border-radius: 14px; margin: 0 auto 20px; display: block; }
  .empty-form { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .obj-input { width: 100%; max-width: 420px; font-size: 14.5px; padding: 11px 14px; border-radius: 12px;
    border: 1px solid var(--line-2, #d2d2d7); font-family: inherit; box-sizing: border-box; }
  .obj-input:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }

  .btn-primary { background: var(--invert-surface, #1d1d1f); color: #fff; border: none; border-radius: 980px;
    padding: 11px 20px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
  .btn-ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border: none; border-radius: 980px;
    padding: 9px 15px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-ghost:disabled { opacity: 0.4; cursor: default; }

</style>
