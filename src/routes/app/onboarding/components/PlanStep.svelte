<script lang="ts">
  import { _ } from 'svelte-i18n';
  import PlatformMixBars from '$lib/components/PlatformMixBars.svelte';
  import EditorialPlanCards from '$lib/components/EditorialPlanCards.svelte';
  import { LANGUAGES } from './languages';

  let {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    report = null,
    language = $bindable(''),
    allowedCadences = [],
    profileLanguage = '',
    isContinueMode = false,
    onapprove,
    onskip
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan?: any | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    report?: any | null;
    language?: string;
    allowedCadences?: string[];
    profileLanguage?: string;
    isContinueMode?: boolean;
    onapprove: () => void;
    onskip: () => void;
  } = $props();

  let planDetails = $state(false);
</script>

{#if plan}
  <div class="manifesto">
    <div class="report-top">
      <span class="report-badge">{$_('onboarding.manifesto.badge')}</span>
      {#if plan.gtm?.stage === 'zero_to_one'}<span class="mf-gtm">{$_('editorialPlan.stage.zero_to_one')}</span>{/if}
    </div>
    {#if report?.summary}<p class="mf-summary">{report.summary}</p>{/if}
    {#if plan.strategy}<p class="mf-strategy">{plan.strategy}</p>{/if}
    <div class="mf-facts">
      <span class="mf-fact"><b>{$_('editorialPlan.cadence')}</b>{$_('editorialPlan.freq.' + plan.cadence)}</span>
    </div>
    {#if plan.platform_mix?.length}
      <div class="mf-mix">
        <div class="mf-mix-lbl">{$_('editorialPlan.platformMix')}</div>
        <PlatformMixBars mix={plan.platform_mix} />
      </div>
    {/if}
    {#if plan.weeks?.length}
      <div class="mf-weeks-sec">
        <div class="mf-mix-lbl">{$_('editorialPlan.weeks')}</div>
        <ol class="mf-weeks">
          {#each plan.weeks as w, i (i)}
            <li><span class="mf-wn">{i + 1}</span>{w.theme || w.focus || '—'}</li>
          {/each}
        </ol>
      </div>
    {/if}
    <div class="mf-lang">
      <span class="mf-lang-lbl">{$_('onboarding.plan.languageLabel')}</span>
      <select class="lang-select" bind:value={language}>
        <option value="">{$_('onboarding.plan.autoDetect')}{profileLanguage ? ` (${profileLanguage})` : ''}</option>
        {#each LANGUAGES as l (l)}<option value={l}>{$_('onboarding.language.' + l)}</option>{/each}
      </select>
    </div>
    <div class="mf-actions">
      <button type="button" class="mf-details" onclick={() => (planDetails = !planDetails)}>
        {planDetails ? $_('onboarding.manifesto.hideDetails') : $_('onboarding.manifesto.showDetails')}
      </button>
    </div>
    <p class="mf-note">{$_('onboarding.manifesto.note')}</p>
  </div>

  {#if planDetails}
    <EditorialPlanCards plan={plan} editable={false} {allowedCadences} />
  {/if}

  <!-- Sticky: il manifesto è più alto di un viewport — Approva
       stays reachable without scrolling back to the card. -->
  <div class="cta-row cta-row-setup">
    {#if isContinueMode}
      <button type="button" class="ghost" onclick={onskip}>{$_('onboarding.finishLater')}</button>
    {/if}
    <button type="button" class="primary cta-press" onclick={onapprove}>{$_('onboarding.plan.approve')}</button>
  </div>
{:else}
  <div class="preview-head"><span class="hsp"></span>{$_('onboarding.status.buildingPlan')}</div>
{/if}

<style>
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }

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

  .manifesto { margin-top: 22px; border: 1.5px solid var(--accent, #7c5cff); border-radius: 20px; padding: 24px 26px 22px;
    background: color-mix(in srgb, var(--accent, #7c5cff) 3%, var(--paper, #fff)); }
  .manifesto { animation: rise 0.55s var(--ease, ease) both; }
  @media (prefers-reduced-motion: reduce) {
    .manifesto { animation: none; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .report-top { display: flex; align-items: center; gap: 10px; }
  .report-badge { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #fff;
    background: var(--accent, #7c5cff); border-radius: 980px; padding: 3px 10px; }
  .mf-gtm { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
    background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .mf-summary { margin: 18px 0 0; font-size: 14.5px; line-height: 1.65; color: var(--ink, #1d1d1f); }
  .mf-strategy { margin: 14px 0 0; font-size: 15.5px; font-weight: 600; line-height: 1.55; letter-spacing: -0.01em; color: var(--ink, #1d1d1f); }
  .mf-facts, .mf-weeks-sec, .mf-lang { margin-top: 26px; padding-top: 20px; border-top: 1px solid rgba(var(--accent-rgb), 0.16); }
  .mf-facts { display: flex; gap: 28px; flex-wrap: wrap; }
  .mf-fact { font-size: 13.5px; color: var(--ink-soft, #6e6e73); }
  .mf-fact b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint, #86868b); margin-bottom: 4px; }
  .mf-mix { margin-top: 18px; }
  .mf-mix-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: var(--ink-faint, #86868b); margin-bottom: 10px; }
  .mf-weeks { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
  .mf-weeks li { display: flex; align-items: baseline; gap: 11px; font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--ink, #1d1d1f); }
  .mf-wn { width: 20px; height: 20px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); align-self: center; }
  .mf-lang { display: flex; align-items: center; gap: 12px; }
  .mf-lang-lbl { font-size: 12.5px; font-weight: 600; color: var(--ink-soft, #6e6e73); white-space: nowrap; }
  .mf-lang .lang-select { max-width: 240px; }
  .lang-select { width: 100%; font-size: 15px; padding: 12px 14px; border-radius: 12px;
    border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff); outline: none; font-family: inherit;
    color: var(--ink, #1d1d1f); cursor: pointer; }
  .lang-select:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }
  .mf-actions { display: flex; align-items: center; gap: 16px; margin-top: 22px; }
  .mf-details { background: none; border: none; padding: 0; margin-top: 24px; font-size: 13px; font-weight: 600; color: var(--ink-soft, #6e6e73); cursor: pointer; }
  .mf-details:hover { color: var(--ink, #1d1d1f); }
  .mf-note { margin: 16px 0 0; font-size: 12px; color: var(--ink-faint, #86868b); line-height: 1.5; }

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
