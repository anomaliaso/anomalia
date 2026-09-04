<script lang="ts">
  import { _ } from 'svelte-i18n';
  import '$lib/styles/settings-shell.css';

  let { data, form } = $props();

  const PLAN_LABELS: Record<string, string> = { go: 'Go', starter: 'Starter', pro: 'Pro' };
  const planName = $derived(data.org.plan ? (PLAN_LABELS[data.org.plan] ?? data.org.plan) : null);
  const planLabel = $derived(
    planName
      ? $_('app.settings.billing.planActive', { values: { plan: planName } })
      : $_('app.settings.billing.noPlan')
  );

  const fmt = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.billing.title')}</div></div>

  <div class="field">
    <div class="ftxt">
      <div class="fh">{planLabel}</div>
      <div class="fs">{$_('app.account.billing.poolDesc')}</div>
    </div>
  </div>

  {#if !data.isOwner}
    <div class="field"><div class="bill-notice">{$_('app.settings.billing.membersNotice')}</div></div>
  {:else if !data.billingBrandSlug}
    <div class="field"><div class="fs">{$_('app.account.billing.noBrands')}</div></div>
  {:else}
    {#if form?.retentionApplied}
      <div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.billing.retentionApplied')}</div></div>
    {:else if form?.canceled}
      <div class="field"><div class="fs" style="color:#b25000;">{#if form.endsAt}{$_('app.settings.billing.canceledOn', { values: { date: new Date(form.endsAt).toLocaleDateString() } })}{:else}{$_('app.settings.billing.canceledNoDate')}{/if}</div></div>
    {:else if form?.billingError}
      <div class="field"><div class="fs" style="color:#c0392b;">{form.billingError}</div></div>
    {/if}

    {#if data.credits}
      <div class="field">
        <div class="ftxt">
          <div class="fh">{$_('app.account.billing.poolTitle')}</div>
          <div class="fs">
            {$_('app.settings.usage.creditsUsed')}: {data.credits.used} / {data.credits.quota}
            · {$_('app.account.billing.periodLabel', {
              values: { start: fmt(data.credits.periodStart), end: fmt(data.credits.periodEnd) }
            })}
          </div>
        </div>
      </div>
    {/if}

    {#if data.hasBilling}
      {#if data.atTopPlan}
        <div class="field">
          <div class="ftxt">
            <div class="fh">{$_('app.settings.billing.topPlanTitle')}</div>
            <div class="fs">{$_('app.settings.billing.topPlanDesc')}</div>
          </div>
          <a class="bbtn primary" href={`mailto:hi@anomalia.so?subject=${encodeURIComponent('Custom plan — ' + data.org.name)}`}>{$_('app.settings.billing.talkToUs')}</a>
        </div>
      {:else}
        <div class="field">
          <div class="ftxt">
            <div class="fh">{$_('app.settings.billing.upgradeTitle')}</div>
            <div class="fs">{$_('app.settings.billing.upgradeDesc')}</div>
          </div>
          <div class="bill-actions">
            {#each data.upgrades as p (p.key)}
              <form method="POST" action={`?/upgrade`}>
                <input type="hidden" name="plan" value={p.key} />
                <button class="bbtn primary" type="submit">{$_('app.settings.upgrade.choose', { values: { plan: p.label } })}</button>
              </form>
            {/each}
          </div>
        </div>
      {/if}
      <div class="field">
        <div class="ftxt">
          <div class="fh">{$_('app.settings.billing.manage')}</div>
          <div class="fs">{$_('app.settings.billing.manageInvoicesDesc')}</div>
        </div>
        <div class="bill-actions">
          <form method="POST" action={`?/billingPortal`}><input type="hidden" name="flow" value="invoices" /><button class="bbtn" type="submit">{$_('app.settings.billing.invoices')}</button></form>
          <form method="POST" action={`?/billingPortal`}><input type="hidden" name="flow" value="payment_method" /><button class="bbtn" type="submit">{$_('app.settings.billing.changePayment')}</button></form>
        </div>
      </div>
    {:else}
      <div class="field"><a class="bbtn primary" href={`/app/${data.billingBrandSlug}/activate`}>{$_('app.settings.billing.choosePlan')}</a></div>
    {/if}
  {/if}
</section>

{#if data.brands.length}
  <section class="panel">
    <div class="panel-head"><div class="t">{$_('app.account.billing.breakdownTitle')}</div></div>
    <table class="brand-usage">
      <thead>
        <tr><th>{$_('app.account.billing.brandCol')}</th><th>{$_('app.account.billing.creditsCol')}</th></tr>
      </thead>
      <tbody>
        {#each data.brands as b (b.id)}
          <tr>
            <td><a href={`/app/${b.slug}`}>{b.name}</a></td>
            <td class="num">{b.credits}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .brand-usage {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .brand-usage th,
  .brand-usage td {
    padding: 0.6rem 1rem;
    text-align: left;
    border-top: 1px solid var(--line, #e5e5e5);
  }
  .brand-usage th {
    font-weight: 500;
    opacity: 0.7;
  }
  .brand-usage .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
