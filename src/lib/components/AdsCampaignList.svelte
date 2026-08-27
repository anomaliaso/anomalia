<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { creditsForSpend } from '$lib/ads-fee';
  import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let {
    campaigns,
    fmt,
    newHref,
    emptyCta
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    campaigns: any[];
    fmt: (n: number) => string;
    newHref: string;
    emptyCta: string;
  } = $props();

  // Proposals first: they are the only rows that need a decision.
  const pending = $derived(campaigns.filter((c) => c.status === 'proposed' || c.status === 'failed'));
  const running = $derived(campaigns.filter((c) => !['proposed', 'failed'].includes(c.status)));

  type CampaignAd = { id: string; name?: string; status?: string };
  /**
   * The ads a campaign owns. A function, not a `{@const}`: Svelte only allows those as the
   * immediate child of a block, and this one is needed inside a plain <div>.
   */
  const adsOf = (c: Record<string, unknown>): CampaignAd[] =>
    ((c.external_ids as { ads?: CampaignAd[] } | null)?.ads ?? []);

  /** Budget typed into a row's approve box, before it is submitted. */
  let edited = $state<Record<string, number>>({});
  const budgetOf = (c: Record<string, unknown>) => {
    const typed = edited[String(c.id)];
    return Number.isFinite(typed) && typed > 0 ? typed : Number(c.budget_amount);
  };

  /** Zernio ads platform key → the organic platform glyph. */
  function glyph(platform: string): string {
    return String(platform ?? '').replace(/ads$/, '') || 'meta';
  }
</script>

{#snippet toggle(campaignId: string, adId: string | null, on: boolean, label: string)}
  <!-- A form, not a checkbox bound to state: the switch IS the request, so it cannot show a
       position the platform never accepted. -->
  <form method="POST" action="?/toggle" use:enhance class="sw-form">
    <input type="hidden" name="campaignId" value={campaignId} />
    {#if adId}<input type="hidden" name="adId" value={adId} />{/if}
    <input type="hidden" name="next" value={on ? 'paused' : 'active'} />
    <button class="sw" class:on type="submit" role="switch" aria-checked={on} aria-label={label}>
      <span class="knob"></span>
    </button>
  </form>
{/snippet}

{#snippet row(c: Record<string, unknown>)}
  <li class="camp" data-status={c.status}>
    <span class="ic"><PlatformGlyph platform={glyph(String(c.platform))} /></span>

    <div class="body">
      <div class="line">
        <span class="nm">{c.name}</span>
        <span class="badge s-{c.status}">{$_(`app.ads.status.${c.status}`, { default: String(c.status) })}</span>
        {#if c.review_status}<span class="badge muted">{c.review_status}</span>{/if}
      </div>
      <div class="meta">
        <span>{c.ad_type === 'boost' ? $_('app.ads.typeBoost') : $_('app.ads.typeStandalone')}</span>
        <span class="dot">·</span>
        <span>{c.goal}</span>
        <span class="dot">·</span>
        <span>{c.budget_amount} {c.currency ?? ''}/{c.budget_type}</span>
      </div>
      <!-- A multi-creative campaign is N ads in one ad set: each gets its own switch, so a loser
           can be cut without stopping the test. One ad = the campaign switch already covers it. -->
      {#if adsOf(c).length > 1 && c.status !== 'proposed' && c.status !== 'failed'}
        <ul class="creatives">
          {#each adsOf(c) as a, i (a.id)}
            <li class:off={a.status === 'paused'}>
              <span class="cnum">{i + 1}</span>
              <span class="cnm">{a.name ?? `${c.name} — ${i + 1}`}</span>
              {@render toggle(String(c.id), a.id, a.status !== 'paused', String(a.name ?? a.id))}
            </li>
          {/each}
        </ul>
      {/if}
      {#if c.proposal_reason}<p class="why">{c.proposal_reason}</p>{/if}
      {#if c.error}<p class="err">{$_(`app.ads.err.${c.error}`, { default: String(c.error) })}</p>{/if}
      {#if c.metrics}
        {@const m = c.metrics as Record<string, unknown>}
        <div class="metrics">
          <span><b>{fmt(Number(m.spend))}</b> {$_('app.ads.spend')}</span>
          <span><b>{fmt(Number(m.impressions))}</b> {$_('app.ads.impressions')}</span>
          <span><b>{fmt(Number(m.clicks))}</b> {$_('app.ads.clicks')}</span>
          {#if m.cpc != null}<span><b>{fmt(Number(m.cpc))}</b> CPC</span>{/if}
          {#if m.roas != null}<span><b>{fmt(Number(m.roas))}</b> ROAS</span>{/if}
        </div>
      {/if}
    </div>

    <div class="acts">
      {#if c.status === 'proposed' || c.status === 'failed'}
        <form method="POST" action="?/approve" use:enhance class="approve">
          <input type="hidden" name="campaignId" value={c.id} />
          <input
            name="budgetAmount"
            type="number"
            min="1"
            step="1"
            value={budgetOf(c)}
            oninput={(e) => (edited[String(c.id)] = Number(e.currentTarget.value))}
            aria-label={$_('app.ads.dailyBudget')}
          />
          <button class="mini connect" type="submit">{$_('app.ads.approve')}</button>
        </form>
        <!-- Priced off the number in the box, not the stored one: the field is editable, so a
             cost pinned to the saved budget quoted a price the user was not about to pay. -->
        <div class="cost">{$_('app.ads.launchCost', { values: { credits: creditsForSpend(budgetOf(c)) } })}</div>
        <form method="POST" action="?/reject" use:enhance>
          <input type="hidden" name="campaignId" value={c.id} />
          <button class="mini edit" type="submit">{$_('app.ads.reject')}</button>
        </form>
      {:else if c.status === 'active' || c.status === 'pending_review' || c.status === 'paused'}
        {@render toggle(String(c.id), null, c.status !== 'paused', $_('app.ads.campaignLive'))}
      {/if}
    </div>
  </li>
{/snippet}

{#if pending.length}
  <section class="panel block">
    <div class="panel-head">
      <div class="t">{$_('app.ads.pendingTitle')} <span>{$_('app.ads.pendingSub')}</span></div>
    </div>
    <ul class="list">{#each pending as c (c.id)}{@render row(c)}{/each}</ul>
  </section>
{/if}

<section class="panel block">
  <div class="panel-head"><div class="t">{$_('app.ads.campaigns')}</div></div>
  {#if !running.length}
    <div class="empty">
      <p>{$_('app.ads.empty')}</p>
      <a class="mini connect" href={newHref}>{emptyCta}</a>
    </div>
  {:else}
    <ul class="list">{#each running as c (c.id)}{@render row(c)}{/each}</ul>
  {/if}
</section>

<style>
  .sw-form { display: inline-flex; }
  .sw {
    width: 40px; height: 24px; padding: 0; flex: 0 0 auto;
    border: 1px solid var(--line-2); border-radius: 980px; background: var(--paper-2);
    cursor: pointer; transition: background .18s var(--ease), border-color .18s var(--ease);
  }
  .sw .knob {
    display: block; width: 16px; height: 16px; margin-left: 3px; border-radius: 50%;
    background: var(--ink-faint); transition: transform .18s var(--ease), background .18s var(--ease);
  }
  .sw.on { background: var(--accent); border-color: transparent; }
  .sw.on .knob { background: #fff; transform: translateX(16px); }
  .sw:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .creatives { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .creatives li {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px;
    font-size: 12.5px;
  }
  .creatives li.off { opacity: .55; }
  .creatives .cnum {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%; flex: 0 0 auto;
    background: var(--paper-2); font-size: 11px; font-weight: 700;
  }
  .creatives .cnm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .block { margin-top: 16px; }
  .list { list-style: none; margin: 0; padding: 0; }
  .camp {
    display: flex; gap: 14px; align-items: flex-start;
    padding: 16px 22px; border-bottom: 1px solid var(--line);
  }
  .camp:last-child { border-bottom: none; }
  .ic {
    width: 38px; height: 38px; border-radius: 12px; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--paper-2); border: 1px solid var(--line);
  }
  .body { flex: 1; min-width: 0; }
  .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .nm { font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; }
  .badge {
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 980px; background: var(--paper-2); color: var(--ink-faint);
  }
  .badge.s-proposed { background: rgba(var(--accent-rgb), 0.12); color: var(--accent); }
  .badge.s-active { background: #e8f6ee; color: #1c7a45; }
  .badge.s-pending_review { background: color-mix(in oklab, #f39c12 16%, transparent); color: #a4630a; }
  .badge.s-failed { background: #fdecea; color: #c0392b; }
  .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px;
          font-size: 12.5px; color: var(--ink-faint); }
  .dot { opacity: 0.5; }
  .why { font-size: 13px; color: var(--ink-soft); line-height: 1.45; margin: 6px 0 0; max-width: 70ch; }
  .err { font-size: 12.5px; color: #c0392b; margin: 6px 0 0; }
  .metrics { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12.5px; color: var(--ink-faint); }
  .metrics b { color: var(--ink); font-weight: 650; }

  .acts { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: 0 0 auto; }
  .approve { display: flex; align-items: center; gap: 8px; }
  .approve input {
    width: 84px; height: 36px; box-sizing: border-box; padding: 0 10px;
    border: 1px solid var(--line-2); border-radius: 10px;
    background: var(--paper); color: var(--ink); font: inherit; font-size: 13.5px; text-align: right;
  }
  .approve input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.1); }
  .acts .mini { height: 36px; display: inline-flex; align-items: center; }
  .cost { font-size: 11.5px; color: var(--ink-faint); }

  .empty { padding: 34px 22px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
  .empty p { margin: 0; font-size: 13.5px; color: var(--ink-faint); max-width: 46ch; line-height: 1.5; }
  .empty a { text-decoration: none; }

  @media (max-width: 720px) {
    .camp { flex-wrap: wrap; }
    .acts { width: 100%; align-items: stretch; flex-direction: row; flex-wrap: wrap; }
    .approve { flex: 1; }
  }
</style>
