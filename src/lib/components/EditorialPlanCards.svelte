<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { Snippet } from 'svelte';
  import PlatformMixBars from '$lib/components/PlatformMixBars.svelte';

  // The editorial-plan document, rendered as editable cards. Shared by onboarding (plan approval
  // step) and the in-app Strategy page, so the user sees the SAME document in both places.
  // `plan` mirrors the EditorialPlan shape from $lib/server/editorial-plan (kept loose here —
  // this is a client component and must not import server code).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyPlan = any;
  let {
    plan = $bindable(),
    editable = false,
    allowedCadences = ['3/week', '5/week'],
    // Optional per-week extra UI (e.g. the Strategy page's brief + replan controls).
    weekExtra
  }: {
    plan: AnyPlan;
    editable?: boolean;
    allowedCadences?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    weekExtra?: Snippet<[any, number]>;
  } = $props();

  const GOALS = ['awareness', 'sales', 'community'];

  // "Mon 8 Jun" style label for a stamped week, in the user's UI locale; '' for proposals.
  function weekLabel(start: string | null): string {
    if (!start) return '';
    try {
      return new Date(`${start}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch {
      return start;
    }
  }
</script>

{#if plan}
  <div class="eplan">
    <!-- Strategy statement -->
    <section class="ep-card">
      <div class="ep-h">{$_('editorialPlan.strategy')}</div>
      {#if editable}
        <textarea class="ep-area" rows="3" bind:value={plan.strategy}></textarea>
      {:else}
        <p class="ep-text">{plan.strategy}</p>
      {/if}
    </section>

    <!-- Voice (the answers Anomalia used to ask for — now proposed, still editable) -->
    <section class="ep-card">
      <div class="ep-h">{$_('editorialPlan.voice')}</div>
      <div class="ep-voice-grid">
        <label class="ep-field">
          <span class="ep-lbl">{$_('editorialPlan.mood')}</span>
          {#if editable}<input class="ep-input" bind:value={plan.voice.mood} />{:else}<span class="ep-val">{plan.voice?.mood}</span>{/if}
        </label>
        <label class="ep-field">
          <span class="ep-lbl">{$_('editorialPlan.tone')}</span>
          {#if editable}<input class="ep-input" bind:value={plan.voice.tone} />{:else}<span class="ep-val">{plan.voice?.tone}</span>{/if}
        </label>
      </div>
      <div class="ep-field">
        <span class="ep-lbl">{$_('editorialPlan.goal')}</span>
        <div class="ep-chips">
          {#each GOALS as g (g)}
            <button
              type="button"
              class="ep-chip"
              class:on={plan.voice?.goal === g}
              disabled={!editable}
              onclick={() => (plan.voice.goal = g)}
            >{$_('editorialPlan.goals.' + g)}</button>
          {/each}
        </div>
      </div>
      <div class="ep-field">
        <span class="ep-lbl">{$_('editorialPlan.personality')}</span>
        {#if editable}
          <textarea class="ep-area" rows="2" bind:value={plan.voice.personality}></textarea>
        {:else}
          <p class="ep-text">{plan.voice?.personality}</p>
        {/if}
      </div>
    </section>

    <!-- Cadence (bounded to the subscription tier) -->
    <section class="ep-card">
      <div class="ep-h">{$_('editorialPlan.cadence')}</div>
      <div class="ep-chips">
        {#each allowedCadences as f (f)}
          <button type="button" class="ep-chip" class:on={plan.cadence === f} disabled={!editable} onclick={() => (plan.cadence = f)}>
            {$_('editorialPlan.freq.' + f)}
          </button>
        {/each}
      </div>
    </section>

    <!-- Platform mix: logo + name on the left, %-bar beside (shared chart) -->
    {#if plan.platform_mix?.length}
      <section class="ep-card">
        <div class="ep-h">{$_('editorialPlan.platformMix')}</div>
        <PlatformMixBars mix={plan.platform_mix} />
      </section>
    {/if}

    <!-- Organic go-to-market (0→1 brands get the full section) -->
    {#if plan.gtm}
      <section class="ep-card ep-gtm">
        <div class="ep-h">
          {$_('editorialPlan.gtm')}
          <span class="ep-stage">{$_('editorialPlan.stage.' + plan.gtm.stage)}</span>
        </div>
        {#if plan.gtm.summary}<p class="ep-text">{plan.gtm.summary}</p>{/if}
        {#if plan.gtm.platform_recs?.length}
          <ul class="ep-recs">
            {#each plan.gtm.platform_recs as r (r.platform)}
              <li>
                <div class="ep-rec-top">
                  <b class="ep-plat">{r.platform}</b>
                  <span class="ep-prio" data-p={r.priority}>{$_('editorialPlan.priority.' + r.priority)}</span>
                </div>
                <p class="ep-rec-why">{r.why}</p>
                {#if r.organic_potential}<p class="ep-rec-pot">{r.organic_potential}</p>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if plan.gtm.plays?.length}
          <div class="ep-lbl" style="margin-top:10px;">{$_('editorialPlan.plays')}</div>
          <ul class="ep-plays">{#each plan.gtm.plays as p (p)}<li>{p}</li>{/each}</ul>
        {/if}
      </section>
    {/if}

    <!-- The 4 weeks — stacked vertically, full texts always visible (no truncation, no grid) -->
    <div class="ep-h ep-weeks-h">{$_('editorialPlan.weeks')}</div>
    <div class="ep-weeks">
      {#each plan.weeks as w, i (i)}
        <section class="ep-week" class:done={w.status === 'done'}>
          <div class="ep-week-top">
            <span class="ep-week-n">{$_('editorialPlan.week', { values: { n: i + 1 } })}</span>
            {#if w.week_start}<span class="ep-week-date">{weekLabel(w.week_start)}</span>{/if}
            {#if w.content_mix?.length}
              <span class="ep-week-count">{$_('editorialPlan.postCount', { values: { count: w.content_mix.reduce((a: number, m: { count: number }) => a + (m.count || 0), 0) } })}</span>
            {/if}
            {#if w.status !== 'upcoming'}<span class="ep-status" data-s={w.status}>{$_('editorialPlan.status.' + w.status)}</span>{/if}
          </div>
          {#if editable}
            <input class="ep-input ep-theme" bind:value={w.theme} placeholder={$_('editorialPlan.themePlaceholder')} />
            <textarea class="ep-area" rows="2" bind:value={w.focus} placeholder={$_('editorialPlan.focusPlaceholder')}></textarea>
          {:else}
            <div class="ep-theme-ro">{w.theme}</div>
            {#if w.focus}<p class="ep-text">{w.focus}</p>{/if}
          {/if}
          {#if w.content_mix?.length}
            <div class="ep-mixchips">
              {#each w.content_mix as m (m.type)}<span class="ep-mixchip">{m.count}× {m.type}</span>{/each}
            </div>
          {/if}
          {#if w.rationale}
            <div class="ep-week-why">
              <span class="ep-lbl">{$_('editorialPlan.why')}</span>
              <p class="ep-text">{w.rationale}</p>
            </div>
          {/if}
          {#if w.brief}
            <p class="ep-brief"><b>{$_('editorialPlan.briefLabel')}:</b> {w.brief}</p>
          {/if}
          {#if weekExtra}{@render weekExtra(w, i)}{/if}
        </section>
      {/each}
    </div>
  </div>
{/if}

<style>
  .eplan { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
  /* Box metrics IDENTICAL to the Analytics .panel/.panel-head: radius 20, head 18px 22px with an
     edge-to-edge divider, content padded 18px 22px after it. */
  .ep-card { border: 1px solid var(--line, #e3e3e6); border-radius: 20px; padding: 18px 22px; background: var(--paper, #fff); }
  .ep-h { font-size: 15.5px; font-weight: 700; letter-spacing: -0.03em; color: var(--ink, #1d1d1f);
    display: flex; align-items: center; gap: 10px;
    margin: -18px -22px 18px; padding: 18px 22px; border-bottom: 1px solid var(--line, #e3e3e6); }
  /* The weeks heading sits OUTSIDE a card — title typography, no divider, no bleed. */
  .ep-weeks-h { border-bottom: none; margin: 0; padding: 0; }
  .ep-text { margin: 0; font-size: 14.5px; line-height: 1.55; color: var(--ink, #1d1d1f); }
  .ep-area { width: 100%; font-size: 14.5px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; line-height: 1.5; resize: vertical; box-sizing: border-box; color: var(--ink, #1d1d1f); }
  .ep-area:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .ep-input { width: 100%; font-size: 14.5px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; box-sizing: border-box; color: var(--ink, #1d1d1f); }
  .ep-input:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .ep-voice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ep-field { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .ep-voice-grid .ep-field { margin-top: 0; }
  .ep-lbl { font-size: 12.5px; font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .ep-val { font-size: 14.5px; font-weight: 600; }
  .ep-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .ep-chip { padding: 8px 14px; border-radius: 980px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73); font-size: 13.5px; font-weight: 500; cursor: pointer; }
  .ep-chip.on { border-color: var(--accent, #7c5cff); background: rgba(var(--accent-rgb), 0.07); color: var(--ink, #1d1d1f); font-weight: 600; }
  .ep-chip:disabled { cursor: default; opacity: 1; }
  .ep-chip:disabled:not(.on) { opacity: 0.55; }
  .ep-plat { text-transform: capitalize; }
  .ep-gtm { border-color: rgba(var(--accent-rgb), 0.35); }
  .ep-stage { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; letter-spacing: 0.04em;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent, #7c5cff); text-transform: none; }
  .ep-recs { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .ep-rec-top { display: flex; align-items: center; gap: 8px; }
  .ep-prio { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); color: var(--ink-soft, #6e6e73); }
  .ep-prio[data-p='primary'] { background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .ep-rec-why { margin: 4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--ink, #1d1d1f); }
  .ep-rec-pot { margin: 2px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); }
  .ep-plays { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; line-height: 1.6; color: var(--ink, #1d1d1f); }
  .ep-weeks-h { margin: 4px 0 -4px; }
  /* Weeks stack vertically (one under another), full width — every text fully visible. */
  .ep-weeks { display: flex; flex-direction: column; gap: 12px; }
  .ep-week { border: 1px solid var(--line, #e3e3e6); border-radius: 16px; padding: 16px 18px; background: var(--paper, #fff);
    display: flex; flex-direction: column; gap: 10px; }
  .ep-week.done { opacity: 0.7; }
  .ep-week-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ep-week-n { font-size: 12.5px; font-weight: 700; color: var(--accent, #7c5cff); text-transform: uppercase; letter-spacing: 0.05em; }
  .ep-week-date { font-size: 12.5px; color: var(--ink-faint, #86868b); }
  .ep-week-count { font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px;
    background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); }
  .ep-status { margin-left: auto; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
    background: rgba(0, 0, 0, 0.06); color: var(--ink-soft, #6e6e73); }
  .ep-status[data-s='planned'] { background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .ep-theme { font-weight: 600; font-size: 15.5px; }
  .ep-theme-ro { font-size: 16.5px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em; }
  .ep-mixchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ep-mixchip { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--ink-soft, #6e6e73); }
  .ep-week-why { display: flex; flex-direction: column; gap: 4px; }
  .ep-brief { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ink, #1d1d1f); background: rgba(var(--accent-rgb), 0.06);
    border-radius: 10px; padding: 9px 12px; }

  @container workbench (max-width: 560px) {
    .ep-voice-grid { grid-template-columns: 1fr; }
  }
</style>
