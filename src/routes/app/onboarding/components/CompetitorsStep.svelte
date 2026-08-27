<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { cancelPoll, runStepJob, type JobPoll } from './step-jobs';

  type Competitor = { name: string; website: string; kind: 'direct' | 'indirect'; rationale: string; source: 'ai' | 'user' };

  let {
    competitors = $bindable([]),
    citations = $bindable([]),
    competitorJobId = $bindable(null),
    additionalContext = $bindable(''),
    discovering = $bindable(false),
    pollRef = $bindable(),
    brandId = null,
    draftId = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile = null,
    platforms = [],
    handles = [],
    isContinueMode = false,
    oncontinue,
    onskip,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror
  }: {
    competitors?: Competitor[];
    citations?: { uri: string; title: string }[];
    competitorJobId?: string | null;
    additionalContext?: string;
    discovering?: boolean;
    pollRef?: JobPoll | undefined;
    brandId?: string | null;
    draftId?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: any;
    platforms?: string[];
    handles?: { platform: string; username: string | null; profileUrl: string | null }[];
    isContinueMode?: boolean;
    oncontinue: () => void;
    onskip: () => void;
    onerror?: (step: string, message: unknown, context?: Record<string, unknown>) => void;
  } = $props();

  let compProgress = $state('');
  let compError = $state('');

  const namedCompetitors = $derived(competitors.filter((c) => c.name.trim()));

  function addCompetitor() {
    competitors = [...competitors, { name: '', website: '', kind: 'direct', rationale: '', source: 'user' }];
  }
  function updateName(i: number, v: string) {
    competitors = competitors.map((c, idx) => (idx === i ? { ...c, name: v } : c));
  }
  function toggleKind(i: number) {
    competitors = competitors.map((c, idx) =>
      idx === i ? { ...c, kind: c.kind === 'direct' ? 'indirect' : 'direct' } : c
    );
  }
  function remove(i: number) {
    competitors = competitors.filter((_c, idx) => idx !== i);
  }

  function applyResult(data: {
    competitors?: Competitor[];
    citations?: { uri: string; title: string }[];
  }) {
    const mine = competitors.filter((c) => c.source === 'user' && c.name.trim());
    competitors = [...mine, ...(data.competitors ?? []).map((c) => ({ ...c, source: 'ai' as const }))];
    citations = data.citations ?? [];
  }

  export async function discover(force = false) {
    if (discovering) return;
    if (!force && competitors.length) return;
    discovering = true;
    compError = '';
    compProgress = $_('onboarding.status.scanningMarket');
    cancelPoll(pollRef);
    const poll: JobPoll = { cancelled: false };
    pollRef = poll;
    try {
      const outcome = await runStepJob({
        path: '/app/onboarding/competitors',
        jobId: competitorJobId,
        force,
        poll,
        body: {
          brandId,
          draftId,
          profile,
          platforms,
          handles
        },
        onProgress: (m) => {
          if (m) compProgress = m;
        },
        onResult: (result) => applyResult(result ?? {})
      });
      if (outcome.jobId) competitorJobId = outcome.jobId;
      if (outcome.status === 'failed') {
        onerror?.('competitors', outcome.error || 'discovery failed');
        compError = $_('onboarding.status.competitorsFailed');
      }
    } catch (e) {
      onerror?.('competitors', e instanceof Error ? e.message : 'enqueue failed');
      compError = $_('onboarding.status.competitorsFailed');
    } finally {
      discovering = false;
    }
  }
</script>

{#if discovering}
  <div class="preview-head"><span class="hsp"></span>{compProgress}</div>
{/if}

{#if competitors.length}
  <ul class="comp-list">
    {#each competitors as c, i (i)}
      <li class="comp-row">
        <input
          class="comp-name"
          value={c.name}
          placeholder={$_('onboarding.competitors.namePlaceholder')}
          oninput={(e) => updateName(i, e.currentTarget.value)}
        />
        <button type="button" class="chip-kind" class:indirect={c.kind === 'indirect'} onclick={() => toggleKind(i)}>
          {$_('onboarding.competitors.' + c.kind)}
        </button>
        <button type="button" class="comp-x" onclick={() => remove(i)} aria-label={$_('onboarding.remove')}>×</button>
      </li>
    {/each}
  </ul>
{:else if !discovering}
  <p class="hint">{$_('onboarding.competitors.empty')}</p>
{/if}

<button type="button" class="disclosure comp-add" onclick={addCompetitor}>{$_('onboarding.competitors.add')}</button>
{#if citations.length}
  <p class="hint">{$_('onboarding.competitors.sources', { values: { count: citations.length } })}</p>
{/if}
{#if compError}<p class="err">{compError}</p>{/if}

<div class="block">
  <div class="lbl">{$_('onboarding.competitors.contextLabel')} <small>{$_('onboarding.optional')}</small></div>
  <textarea class="ctx-area" rows="3" bind:value={additionalContext} placeholder={$_('onboarding.competitors.contextPlaceholder')}></textarea>
</div>

<div class="cta-row cta-row-setup">
  {#if isContinueMode}
    <button type="button" class="ghost" onclick={onskip} disabled={discovering}>{$_('onboarding.finishLater')}</button>
  {/if}
  {#if compError}
    <button type="button" class="ghost" onclick={() => discover(true)} disabled={discovering}>
      {$_('onboarding.competitors.retry')}
    </button>
  {/if}
  <button class="primary cta-press" onclick={oncontinue} disabled={discovering}>
    {namedCompetitors.length ? $_('onboarding.competitors.runAnalysis') : $_('onboarding.competitors.continueWithout')}
  </button>
</div>

<style>
  input { flex: 1; font-size: 16px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line-2, #d2d2d7); outline: none; width: 100%; height: 44px; }
  input:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12); }
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }
  .cta-press { transition: transform 0.12s var(--ease, ease); }
  .cta-press:active:not(:disabled) { transform: scale(0.97); }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }

  .block { margin-top: 18px; }
  .block .lbl { font-size: 16px; font-weight: 650; margin-bottom: 10px; letter-spacing: -0.01em; }
  .block small { color: var(--ink-faint, #86868b); font-weight: 400; }
  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }
  .ctx-area { width: 100%; font-size: 15px; padding: 12px 14px; border-radius: 12px;
    border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff); outline: none; font-family: inherit;
    color: var(--ink, #1d1d1f); line-height: 1.5; resize: vertical; box-sizing: border-box; }
  .ctx-area:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .disclosure { background: none; border: none; padding: 0; font-size: 13.5px; font-weight: 600; color: var(--accent, #7c5cff); cursor: pointer; }
  .disclosure:hover { text-decoration: underline; }

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

  .comp-list { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .comp-row { display: flex; align-items: center; gap: 9px; }
  .comp-name { flex: 1; font-size: 14.5px; font-weight: 600; height: 40px; padding: 9px 12px; border-radius: 10px; }
  .chip-kind { font-style: normal; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 4px 9px; border-radius: 999px; background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff);
    border: none; cursor: pointer; flex: none; }
  .chip-kind.indirect { background: rgba(0, 0, 0, 0.07); color: var(--ink-soft, #6e6e73); }
  .comp-x { width: 26px; height: 26px; padding: 0; border-radius: 50%; background: var(--paper-2, #f1f1f3);
    color: var(--ink-soft, #6e6e73); font-size: 15px; line-height: 1; flex: none; }
  .comp-x:hover { background: #fde8e6; color: #c0392b; }
  .comp-add { margin-top: 14px; display: inline-block; }

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
