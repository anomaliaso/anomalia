<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import EditorialPlanCards from '$lib/components/EditorialPlanCards.svelte';
  import StrategyHistory from '$lib/components/StrategyHistory.svelte';
  import PageHead from '$lib/components/PageHead.svelte';

  let { data, form } = $props();

  // Local editable copy of the active plan; re-synced whenever an action reloads the page data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plan = $state<any>(null);
  $effect(() => {
    plan = data.plan ? JSON.parse(JSON.stringify(data.plan)) : null;
  });

  // Which action is in flight (drives per-button spinners/disabled states).
  let busy = $state('');
  const working = (name: string) => () => {
    busy = name;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = '';
    };
  };

  let feedback = $state('');
  // Quick intents that pre-fill the revision field (brief §5.3).
  const INTENT_KEYS = ['moreBts', 'lessPromo', 'moreFounder', 'cautiousGoals'];
</script>

<svelte:head><title>Anomalia — {$_('strategy.title')}</title></svelte:head>

{#snippet weekExtra(w: { brief?: string | null }, i: number)}
  {#if plan && (data.currentWeek == null || i >= data.currentWeek)}
    <form method="POST" class="wk-form" use:enhance={working(`week${i}`)}>
      <input type="hidden" name="plan_id" value={plan.id} />
      <input type="hidden" name="week" value={i} />
      <textarea name="brief" rows="2" class="wk-brief" placeholder={$_('strategy.week.briefPlaceholder')}>{w.brief ?? ''}</textarea>
      <div class="wk-actions">
        <button formaction="?/saveBrief" class="btn-ghost" disabled={busy === `week${i}`}>{$_('strategy.week.saveBrief')}</button>
        <button formaction="?/replanWeek" class="btn-mini" disabled={busy === `week${i}`}>
          {busy === `week${i}` ? $_('strategy.week.replanning') : $_('strategy.week.replan')}
        </button>
      </div>
    </form>
  {/if}
{/snippet}

<div class="content">
  <PageHead title={$_('strategy.title')} subtitle={$_('strategy.subtitle')} />

  {#if data.quota.remaining <= 0}
    <div class="banner warn">{$_('strategy.quotaBanner')}</div>
  {/if}

  {#if form?.error}<p class="err">{$_('strategy.actionFailed')}</p>{/if}

  <!-- A pending proposal (revision or first plan) to review -->
  {#if data.proposed}
    <section class="proposal">
      <div class="prop-head">
        <span class="prop-badge">{$_('strategy.proposal.title')}</span>
        {#if data.proposedFeedback}<span class="prop-fb">“{data.proposedFeedback}”</span>{/if}
      </div>
      {#if data.proposed.changes_summary?.length}
        <div class="prop-changes">
          <div class="prop-h">{$_('strategy.proposal.changes')}</div>
          <ul>{#each data.proposed.changes_summary as c (c)}<li>{c}</li>{/each}</ul>
        </div>
      {/if}
      <EditorialPlanCards plan={data.proposed} editable={false} allowedCadences={data.allowedCadences} />
      <div class="prop-actions">
        <form method="POST" action="?/approveRevision" use:enhance={working('approve')}>
          <input type="hidden" name="plan_id" value={data.proposed.id} />
          <button class="btn-primary" disabled={busy === 'approve'}>{$_('strategy.proposal.approve')}</button>
        </form>
        <form method="POST" action="?/discardRevision" use:enhance={working('discard')}>
          <input type="hidden" name="plan_id" value={data.proposed.id} />
          <button class="btn-ghost" disabled={busy === 'discard'}>{$_('strategy.proposal.discard')}</button>
        </form>
      </div>
    </section>
  {/if}

  {#if plan}
    <!-- Two columns: the plan on the left, the revision box pinned on the right where it stays
         at hand while reading the weeks. -->
    <div class="plan-cols">
      <div class="plan-main">
        <EditorialPlanCards bind:plan editable allowedCadences={data.allowedCadences} {weekExtra} />

        <form method="POST" action="?/updateSection" use:enhance={working('save')} class="save-row">
          <input type="hidden" name="plan_id" value={plan.id} />
          <input type="hidden" name="plan" value={JSON.stringify(plan)} />
          <button class="btn-primary" disabled={busy === 'save'}>{busy === 'save' ? $_('strategy.saving') : $_('strategy.save')}</button>
          {#if form?.saved}<span class="saved-note">{$_('strategy.saved')}</span>{/if}
        </form>
      </div>

      <aside class="plan-side">
        <!-- Conversational feedback → a full revision proposal -->
        <section class="fb-card">
          <div class="fb-h">{$_('strategy.feedback.title')}</div>
          <div class="fb-chips">
            {#each INTENT_KEYS as k (k)}
              <button type="button" class="fb-chip" onclick={() => (feedback = $_('strategy.intents.' + k))}>{$_('strategy.intents.' + k)}</button>
            {/each}
          </div>
          <form method="POST" action="?/revise" use:enhance={working('revise')}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <textarea name="feedback" rows="4" class="fb-area" bind:value={feedback} placeholder={$_('strategy.feedback.placeholder')}></textarea>
            <button class="btn-primary" disabled={!feedback.trim() || busy === 'revise'}>
              {busy === 'revise' ? $_('strategy.revising') : $_('strategy.feedback.cta')}
            </button>
          </form>
        </section>
      </aside>
    </div>

  {:else if !data.proposed}
    <!-- Brands created before the editorial-plan era: propose their first plan on demand -->
    <section class="empty">
      <img class="empty-hero" src="/plan-hero.webp" alt="" />
      <h3>{$_('strategy.empty.title')}</h3>
      <p>{$_('strategy.empty.body')}</p>
      <form method="POST" action="?/propose" use:enhance={working('propose')}>
        <button class="btn-primary" disabled={busy === 'propose'}>
          {busy === 'propose' ? $_('strategy.proposing') : $_('strategy.empty.cta')}
        </button>
      </form>
    </section>
  {/if}

  <!-- Storico piani editoriali: le versioni precedenti (superseded), in sola lettura. -->
  <StrategyHistory versions={data.history} deleteAction="?/deleteVersion">
    {#snippet detail(v)}
      <EditorialPlanCards plan={v} editable={false} allowedCadences={data.allowedCadences} />
    {/snippet}
  </StrategyHistory>
</div>

<style>

  /* plan on the left, the revision box sticky on the right */
  .plan-cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; align-items: start; }
  .plan-side { position: sticky; top: 78px; }
  @container workbench (max-width: 980px) { .plan-cols { grid-template-columns: 1fr; } .plan-side { position: static; } }
  .page-head h2 { margin: 0; }
  .page-sub { margin: 6px 0 0; color: var(--ink-soft, #6e6e73); font-size: 14px; }
  .banner.warn { margin-top: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13.5px;
    background: #fff7e6; border: 1px solid #f0d9a8; color: #8a6d1a; }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }

  .btn-primary { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 980px;
    padding: 11px 20px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
  .btn-ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border: none; border-radius: 980px;
    padding: 8px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .btn-ghost:disabled { opacity: 0.4; cursor: default; }
  .btn-mini { background: var(--accent, #7c5cff); color: #fff; border: none; border-radius: 980px;
    padding: 8px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .btn-mini:disabled { opacity: 0.4; cursor: default; }

  .save-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
  .saved-note { font-size: 13px; color: var(--accent, #7c5cff); font-weight: 600; }

  /* per-week brief + replan controls (rendered inside each week card) */
  .wk-form { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; border-top: 1px dashed var(--line, #e3e3e6); padding-top: 8px; }
  .wk-brief { width: 100%; font-size: 13px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; line-height: 1.45; resize: vertical; box-sizing: border-box; color: var(--ink, #1d1d1f); }
  .wk-brief:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .wk-actions { display: flex; gap: 8px; }

  /* revision proposal review */
  .proposal { margin-top: 18px; border: 1.5px solid var(--accent, #7c5cff); border-radius: 18px; padding: 16px 18px;
    background: var(--paper-2, #f5f5f7); }
  .prop-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .prop-badge { font-size: 12px; font-weight: 700; padding: 4px 11px; border-radius: 999px;
    background: var(--accent, #7c5cff); color: #fff; }
  .prop-fb { font-size: 13px; color: var(--ink-soft, #6e6e73); font-style: italic; }
  .prop-changes { margin-top: 12px; }
  .prop-h { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft, #6e6e73); }
  .prop-changes ul { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; line-height: 1.6; }
  .prop-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; }

  /* feedback box */
  /* Box metrics identical to the Analytics .panel/.panel-head (radius 20, 18px 22px paddings). */
  .fb-card { border: 1px solid var(--line, #e3e3e6); border-radius: 20px; padding: 18px 22px; background: var(--paper, #fff); }
  .fb-h { font-size: 15.5px; font-weight: 700; letter-spacing: -0.03em; color: var(--ink, #1d1d1f);
    margin: -18px -22px 18px; padding: 18px 22px; border-bottom: 1px solid var(--line, #e3e3e6); }
  .fb-area { width: 100%; font-size: 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line-2, #d2d2d7);
    font-family: inherit; line-height: 1.5; resize: vertical; box-sizing: border-box; margin-bottom: 10px; color: var(--ink, #1d1d1f); }
  .fb-area:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .fb-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .fb-chip { padding: 7px 13px; border-radius: 980px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73); font-size: 12.5px; font-weight: 500; cursor: pointer; }
  .fb-chip:hover { border-color: var(--accent, #7c5cff); color: var(--accent, #7c5cff); }

  .empty { margin-top: 26px; text-align: center; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 18px; padding: 24px; }
  .empty h3 { margin: 0; font-size: 1.15rem; }
  .empty p { color: var(--ink-soft, #6e6e73); font-size: 14px; margin: 8px auto 18px; max-width: 46ch; line-height: 1.5; }
  .empty-hero { width: 100%; max-width: 560px; border-radius: 14px; margin: 0 auto 20px; display: block; }
</style>
