<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { feeBreakdown } from '$lib/ads-fee';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);

  let budget = $state('');
  $effect(() => {
    budget = String(data.recommended.amount);
  });

  const liveFee = $derived(feeBreakdown(Number(budget) || 0));
  const feePct = $derived(Math.round(data.feeRate * 100));

  const currency = $derived(data.recommended.currency ?? 'EUR');
</script>

<section class="stack">
  <div class="panel">
    <div class="panel-head">
      <div class="t">{$_('app.post.boost.title')}</div>
      <div class="s">{$_('app.post.boost.subtitle')}</div>
    </div>

    {#if form?.error}
      <div class="banner err">{form.error}</div>
    {/if}
    {#if form?.proposed}
      <div class="banner ok">{$_('app.post.boost.proposedOk')}</div>
    {/if}
    {#if form?.approved}
      <div class="banner ok">{$_('app.post.boost.approvedOk')}</div>
    {/if}

    {#if !data.adsEnabled}
      <p class="empty">{$_('app.settings.ads.proOnly')}</p>
      <a class="cta" href={`/app/${brand.slug}/settings/ads`}>{$_('app.settings.ads.upgrade')}</a>
    {:else if !data.canBoost}
      <p class="empty">{$_('app.post.boost.needPublished')}</p>
    {:else if !data.hasAdAccount}
      <p class="empty">{$_('app.post.boost.needAccount')}</p>
      <a class="cta ghost" href={`/app/${brand.slug}/settings/ads`}>{$_('app.ads.settings')}</a>
    {:else}
      <div class="reco">
        <div class="reco-label">{$_('app.post.boost.aiSuggest')}</div>
        <p class="reco-reason">{data.recommended.reason}</p>
        {#if data.dailyCap}
          <p class="reco-cap">{$_('app.post.boost.capHint', { values: { cap: data.dailyCap, currency } })}</p>
        {/if}
      </div>

      <form method="POST" action="?/propose" use:enhance class="propose">
        <label>
          <span>{$_('app.post.boost.dailyBudget')}</span>
          <div class="budget-row">
            <input name="budgetAmount" type="number" min="1" step="1" bind:value={budget} />
            <span class="cur">{currency}/day</span>
          </div>
        </label>

        <div class="fee-box">
          <div class="fee-row">
            <span>{$_('app.post.boost.platformSpend')}</span>
            <strong>{liveFee.platformBudget} {currency}</strong>
          </div>
          <div class="fee-row">
            <span>{$_('app.post.boost.mgmtFee', { values: { pct: feePct } })}</span>
            <strong>{liveFee.fee} {currency}</strong>
          </div>
          <div class="fee-row total">
            <span>{$_('app.post.boost.totalDaily')}</span>
            <strong>{liveFee.total} {currency}</strong>
          </div>
          <p class="fee-note">{$_('app.post.boost.feeNote')}</p>
        </div>

        <button class="cta" type="submit">{$_('app.post.boost.propose')}</button>
      </form>
    {/if}
  </div>

  {#if data.campaigns.length}
    <div class="panel">
      <div class="panel-head"><div class="t">{$_('app.post.boost.campaigns')}</div></div>
      <ul class="camps">
        {#each data.campaigns as c (c.id)}
          <li>
            <div class="camp-head">
              <span class="camp-name">{c.name}</span>
              <span class="camp-st">{c.status}</span>
            </div>
            <div class="camp-meta">
              {c.budget} {c.currency}/{c.budgetType}
              · fee {c.fee.fee} {c.currency}
              {#if c.reason}<span class="camp-reason"> — {c.reason}</span>{/if}
            </div>
            {#if c.error}<div class="camp-err">{c.error}</div>{/if}
            <div class="camp-actions">
              {#if c.status === 'proposed' || c.status === 'failed'}
                <form method="POST" action="?/approve" use:enhance class="inline">
                  <input type="hidden" name="campaignId" value={c.id} />
                  <input type="hidden" name="budgetAmount" value={c.budget} />
                  <button class="mini fill" type="submit">{$_('app.ads.approve')}</button>
                </form>
                <form method="POST" action="?/reject" use:enhance class="inline">
                  <input type="hidden" name="campaignId" value={c.id} />
                  <button class="mini" type="submit">{$_('app.ads.reject')}</button>
                </form>
              {:else if c.status === 'active' || c.status === 'pending_review'}
                <form method="POST" action="?/pause" use:enhance class="inline">
                  <input type="hidden" name="campaignId" value={c.id} />
                  <button class="mini" type="submit">{$_('app.ads.pause')}</button>
                </form>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      <a class="link" href={`/app/${brand.slug}/ads`}>{$_('app.post.boost.openAds')}</a>
    </div>
  {/if}
</section>

<style>
  .stack { display: flex; flex-direction: column; gap: 16px; }
  .panel {
    padding: 18px 20px 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper);
  }
  .panel-head { margin-bottom: 14px; }
  .t { font-size: 15px; font-weight: 700; }
  .s { font-size: 13px; color: var(--ink-soft); margin-top: 4px; line-height: 1.45; max-width: 36rem; }
  .empty { margin: 0 0 12px; font-size: 14px; color: var(--ink-soft); line-height: 1.5; }
  .banner {
    padding: 10px 12px; border-radius: 10px; font-size: 13px; font-weight: 600; margin-bottom: 14px;
  }
  .banner.err { background: #fde2e0; color: #c0392b; }
  .banner.ok { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--ink); }

  .reco {
    padding: 12px 14px; border-radius: 12px; background: var(--paper-2); border: 1px solid var(--line);
    margin-bottom: 16px;
  }
  .reco-label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-faint); }
  .reco-reason { margin: 6px 0 0; font-size: 13.5px; line-height: 1.45; }
  .reco-cap { margin: 6px 0 0; font-size: 12px; color: var(--ink-faint); }

  .propose { display: flex; flex-direction: column; gap: 14px; max-width: 420px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 650; color: var(--ink-soft); }
  .budget-row { display: flex; align-items: center; gap: 8px; }
  input[type='number'] {
    height: 40px; width: 120px; font: inherit; font-size: 14px; padding: 0 12px;
    border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper); color: var(--ink);
  }
  .cur { font-size: 13px; color: var(--ink-faint); }

  .fee-box {
    padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--paper);
  }
  .fee-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 4px 0; color: var(--ink-soft); }
  .fee-row.total { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--ink); font-size: 14px; }
  .fee-note { margin: 8px 0 0; font-size: 11.5px; color: var(--ink-faint); line-height: 1.4; }

  .cta {
    display: inline-flex; align-items: center; justify-content: center; font: inherit;
    font-size: 13.5px; font-weight: 650; padding: 10px 16px; border-radius: 11px; cursor: pointer;
    border: none; background: var(--invert-surface, #1d1d1f); color: #fff; text-decoration: none;
    align-self: flex-start;
  }
  .cta.ghost {
    background: var(--paper); color: var(--ink); border: 1px solid var(--line);
  }

  .camps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
  .camps li { padding: 14px 0; border-top: 1px solid var(--line); }
  .camps li:first-child { border-top: none; padding-top: 0; }
  .camp-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .camp-name { font-weight: 650; font-size: 13.5px; }
  .camp-st {
    font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px;
    background: var(--paper-2); border: 1px solid var(--line); color: var(--ink-soft);
  }
  .camp-meta { margin-top: 6px; font-size: 12.5px; color: var(--ink-soft); }
  .camp-reason { color: var(--ink-faint); }
  .camp-err { margin-top: 6px; font-size: 12px; color: #c0392b; }
  .camp-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .inline { margin: 0; }
  .mini {
    font: inherit; font-size: 12px; font-weight: 650; padding: 7px 12px; border-radius: 8px;
    cursor: pointer; border: 1px solid var(--line-2); background: var(--paper); color: var(--ink-soft);
  }
  .mini.fill { background: var(--accent); color: #fff; border-color: var(--accent); }
  .link {
    display: inline-block; margin-top: 12px; font-size: 13px; font-weight: 650;
    color: var(--accent); text-decoration: none;
  }
</style>
