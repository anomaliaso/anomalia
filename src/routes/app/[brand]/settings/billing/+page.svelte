<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}`);

  const PLAN_LABELS: Record<string, string> = { go: 'Go', starter: 'Starter', pro: 'Pro' };
  const planName = $derived(brand.plan ? (PLAN_LABELS[brand.plan] ?? brand.plan) : null);
  const billingLabel = $derived(
    brand.status === 'active'
      ? planName
        ? $_('app.settings.billing.planActive', { values: { plan: planName } })
        : $_('app.settings.billing.active')
      : brand.status === 'trial'
        ? $_('app.settings.billing.trial')
        : brand.status === 'paused'
          ? $_('app.settings.billing.paused')
          : brand.status === 'canceled'
            ? $_('app.settings.billing.canceled')
            : planName
              ? $_('app.settings.billing.planOnly', { values: { plan: planName } })
              : $_('app.settings.billing.noPlan')
  );

  const REASONS = $derived([
    { v: 'too_expensive', l: $_('app.settings.cancel.reasons.too_expensive') },
    { v: 'unused', l: $_('app.settings.cancel.reasons.unused') },
    { v: 'missing_features', l: $_('app.settings.cancel.reasons.missing_features') },
    { v: 'switched_service', l: $_('app.settings.cancel.reasons.switched_service') },
    { v: 'other', l: $_('app.settings.cancel.reasons.other') }
  ]);

  let cancelOpen = $state(false);
  let cancelStep = $state(1);
  let reason = $state('');
  let explanation = $state('');
  let working = $state(false);
  let showErrors = $state(false);
  let upgradeOpen = $state(false);

  function openCancel() {
    cancelOpen = true;
    cancelStep = 1;
    reason = '';
    explanation = '';
    showErrors = false;
  }
  function continueToOffer() {
    if (!reason || !explanation.trim()) {
      showErrors = true;
      return;
    }
    showErrors = false;
    cancelStep = 3;
  }
  function closeCancel() {
    if (!working) cancelOpen = false;
  }
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.billing.title')}</div></div>
  <div class="field">
    <div class="ftxt">
      <div class="fh">{billingLabel}</div>
      <div class="fs">{$_('app.settings.billing.manageDesc')}</div>
    </div>
  </div>

  {#if !data.isOwner}
    <div class="field"><div class="bill-notice">{$_('app.settings.billing.membersNotice')}</div></div>
  {:else}
    {#if form?.retentionApplied}
      <div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.billing.retentionApplied')}</div></div>
    {:else if form?.canceled}
      <div class="field"><div class="fs" style="color:#b25000;">{#if form.endsAt}{$_('app.settings.billing.canceledOn', { values: { date: new Date(form.endsAt).toLocaleDateString() } })}{:else}{$_('app.settings.billing.canceledNoDate')}{/if}</div></div>
    {:else if form?.billingError}
      <div class="field"><div class="fs" style="color:#c0392b;">{form.billingError}</div></div>
    {/if}

    {#if data.hasBilling}
      {#if data.atTopPlan}
        <div class="field">
          <div class="ftxt"><div class="fh">{$_('app.settings.billing.topPlanTitle')}</div><div class="fs">{$_('app.settings.billing.topPlanDesc')}</div></div>
          <a class="bbtn primary" href={`mailto:hi@anomalia.so?subject=${encodeURIComponent('Custom plan — ' + brand.name)}`}>{$_('app.settings.billing.talkToUs')}</a>
        </div>
      {:else}
        <div class="field">
          <div class="ftxt"><div class="fh">{$_('app.settings.billing.upgradeTitle')}</div><div class="fs">{$_('app.settings.billing.upgradeDesc')}</div></div>
          <button class="bbtn primary" type="button" onclick={() => (upgradeOpen = true)}>{$_('app.settings.billing.upgradeCta')}</button>
        </div>
      {/if}
      <div class="field">
        <div class="ftxt"><div class="fh">{$_('app.settings.billing.manage')}</div><div class="fs">{$_('app.settings.billing.manageInvoicesDesc')}</div></div>
        <div class="bill-actions">
          <form method="POST" action="?/billingPortal"><input type="hidden" name="flow" value="invoices" /><button class="bbtn" type="submit">{$_('app.settings.billing.invoices')}</button></form>
          <form method="POST" action="?/billingPortal"><input type="hidden" name="flow" value="payment_method" /><button class="bbtn" type="submit">{$_('app.settings.billing.changePayment')}</button></form>
        </div>
      </div>
      {#if brand.plan === 'go' || brand.plan === 'starter' || brand.plan === 'pro'}
        <div class="bill-cancel">
          <button type="button" class="cancel-link" onclick={openCancel}>{$_('app.settings.billing.cancelPlan')}</button>
        </div>
      {/if}
    {:else}
      <div class="field"><a class="bbtn primary" href={`${base}/activate`}>{$_('app.settings.billing.choosePlan')}</a></div>
    {/if}
  {/if}
</section>

{#if upgradeOpen}
  <div
    class="cx-overlay"
    role="button"
    tabindex="-1"
    aria-label={$_('app.settings.close')}
    onclick={(e) => e.target === e.currentTarget && (upgradeOpen = false)}
    onkeydown={(e) => e.key === 'Escape' && (upgradeOpen = false)}
  >
    <div class="cx-card" role="dialog" aria-modal="true">
      <h3>{$_('app.settings.upgrade.title')}</h3>
      <p class="cx-sub">{$_('app.settings.upgrade.sub')}</p>
      <div class="up-list">
        {#each data.upgrades as p (p.key)}
          <div class="up-plan">
            <div class="up-info">
              <div class="up-name">{p.label}</div>
              <div class="up-meta">{$_('app.settings.upgrade.planMeta', { values: { posts: p.posts, accounts: p.accounts, radarSources: p.radarSources } })}</div>
            </div>
            <form method="POST" action="?/upgrade">
              <input type="hidden" name="plan" value={p.key} />
              <button class="bbtn primary" type="submit">{$_('app.settings.upgrade.choose', { values: { plan: p.label } })}</button>
            </form>
          </div>
        {/each}
      </div>
      <div class="cx-actions">
        <button class="bbtn" type="button" onclick={() => (upgradeOpen = false)}>{$_('app.settings.close')}</button>
      </div>
    </div>
  </div>
{/if}

{#if cancelOpen}
  <div
    class="cx-overlay"
    role="button"
    tabindex="-1"
    aria-label={$_('app.settings.close')}
    onclick={(e) => e.target === e.currentTarget && closeCancel()}
    onkeydown={(e) => e.key === 'Escape' && closeCancel()}
  >
    <div class="cx-card" role="dialog" aria-modal="true">
      {#if cancelStep === 1}
        <h3>{$_('app.settings.cancel.confirmTitle')}</h3>
        <p class="cx-sub">{@html $_('app.settings.cancel.confirmBody', { values: { brand: brand.name } })}</p>
        <div class="cx-actions split">
          <button class="cx-link" type="button" onclick={() => (cancelStep = 2)}>{$_('app.settings.billing.cancelPlan')}</button>
          <button class="bbtn primary" type="button" onclick={closeCancel}>{$_('app.settings.cancel.continue')}</button>
        </div>
      {:else if cancelStep === 2}
        <h3>{$_('app.settings.cancel.reasonTitle')}</h3>
        <div class="cx-reasons">
          {#each REASONS as r (r.v)}
            <label class="cx-reason" class:sel={reason === r.v}>
              <input type="radio" name="cx-reason" value={r.v} bind:group={reason} />
              {r.l}
            </label>
          {/each}
        </div>
        <textarea class="cx-text" class:err={showErrors && !explanation.trim()} rows="3" placeholder={$_('app.settings.cancel.explanationPlaceholder')} bind:value={explanation} required></textarea>
        {#if showErrors && (!reason || !explanation.trim())}
          <div class="cx-err">{$_('app.settings.cancel.fillBoth')}</div>
        {/if}
        <div class="cx-actions">
          <button class="bbtn" type="button" onclick={() => (cancelStep = 1)}>{$_('app.settings.cancel.back')}</button>
          <button class="bbtn danger" type="button" onclick={continueToOffer}>{$_('app.settings.cancel.continue')}</button>
        </div>
      {:else}
        <div class="cx-offer">
          <div class="cx-badge">{$_('app.settings.cancel.offerBadge')}</div>
          <h3>{$_('app.settings.cancel.offerTitle')}</h3>
          <p class="cx-sub">{@html $_('app.settings.cancel.offerBody', { values: { brand: brand.name } })}</p>
        </div>
        <div class="cx-actions col">
          <form
            method="POST"
            action="?/applyRetention"
            use:enhance={() => {
              working = true;
              return async ({ update }) => {
                await update();
                working = false;
                cancelOpen = false;
              };
            }}
          >
            <button class="bbtn primary big" type="submit" disabled={working}>{working ? $_('app.settings.cancel.applying') : $_('app.settings.cancel.claimOffer')}</button>
          </form>
          <form
            method="POST"
            action="?/cancelPlan"
            use:enhance={() => {
              working = true;
              return async ({ update }) => {
                await update();
                working = false;
                cancelOpen = false;
              };
            }}
          >
            <input type="hidden" name="reason" value={reason} />
            <input type="hidden" name="explanation" value={explanation} />
            <button class="cx-link" type="submit" disabled={working}>{$_('app.settings.cancel.noThanks')}</button>
          </form>
        </div>
      {/if}
    </div>
  </div>
{/if}
