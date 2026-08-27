<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ } from 'svelte-i18n';
  import {
    PLANS,
    CURRENCY_SYMBOL,
    monthlyPrice,
    annualPrice,
    videosFromCredits,
    type Currency,
    type Cycle,
    type Plan
  } from '$lib/plans';
  import { BOOKING_URL } from '$lib/links';

  let {
    cycle,
    currency,
    selectedPlan = null,
    showCustom = false,
    plans = PLANS,
    cta,
    customCta
  }: {
    cycle: Cycle;
    currency: Currency;
    /** Highlight a pre-selected tier (e.g. ?plan= from /pricing → /activate). */
    selectedPlan?: string | null;
    /** Full-width “Custom” row below the paid tiers — used on the public pricing page. */
    showCustom?: boolean;
    /** Visible tiers (Go is filtered out when FEATURE_PLAN_GO is off). */
    plans?: Plan[];
    /** Per-plan CTA (link, form button, …). Parent owns the action. */
    cta: Snippet<[Plan]>;
    customCta?: Snippet;
  } = $props();

  const sym = $derived(CURRENCY_SYMBOL[currency]);
  // Paid tiers only — Custom sits in its own row under the grid.
  const gridMod = $derived(plans.length <= 2 ? 'two' : 'three');

  /** Absolute numbers on the entry tier; higher tiers show N× previous plan (2× Go, 3× Starter). */
  function prevPlan(p: Plan): Plan | null {
    const idx = plans.findIndex((x) => x.key === p.key);
    return idx > 0 ? plans[idx - 1]! : null;
  }

  /** Whole-number marketing multiplier vs the previous visible tier. */
  function tierMult(p: Plan, prev: Plan): number {
    const r = p.postsPerMonth / prev.postsPerMonth;
    return Math.max(1, Math.round(r));
  }

  /** Capacity lines for the check list. */
  function capacityChecks(p: Plan): string[] {
    const postsL = $_('pricing.card.statPosts');
    const videosL = $_('pricing.card.statVideos');
    const articlesL = $_('pricing.card.statArticles');
    const leadsL = $_('pricing.card.statLeads');
    const perMo = $_('pricing.card.perMonth');
    const perDay = $_('pricing.card.perDay');
    const videos = videosFromCredits(p.credits);
    const prev = prevPlan(p);

    if (!prev) {
      return [
        `~${p.postsPerMonth} ${postsL} ${perMo}`,
        `~${videos} ${videosL}`,
        `~${p.articlesPerMonth} ${articlesL} ${perMo}`,
        `~${p.leadsPerDay.min}–${p.leadsPerDay.max} ${leadsL} ${perDay}`
      ];
    }

    const n = tierMult(p, prev);
    const prevVideos = videosFromCredits(prev.credits);
    const videoR = prevVideos > 0 ? videos / prevVideos : 1;
    const videoHalf = Math.round(videoR * 2) / 2;
    const videoLabel = Number.isInteger(videoHalf) ? String(videoHalf) : videoHalf.toFixed(1);

    return [
      `${n}× ${prev.name}`,
      `~${videoLabel}× ${videosL}`
    ];
  }

  /** Localized marketing bullets — copy lives in `pricing.plans.*`, not in `$lib/plans`. */
  function planTagline(p: Plan): string {
    return $_(`pricing.plans.${p.key}.tagline`);
  }
  function planHighlights(p: Plan): string[] {
    return $_(`pricing.plans.${p.key}.highlights`).split('|').map((s) => s.trim()).filter(Boolean);
  }
</script>

<div class="price-plans" class:two={gridMod === 'two'} class:three={gridMod === 'three'}>
  <div class="price-grid" class:two={gridMod === 'two'} class:three={gridMod === 'three'}>
    {#each plans as p (p.key)}
      <div class="price-card" class:popular={p.popular} class:sel={selectedPlan === p.key}>
        {#if p.popular}<div class="pop-tag">{$_('pricing.card.mostPopular')}</div>{/if}
        <div class="tier">{p.name}</div>
        <div class="tagline">{planTagline(p)}</div>
        <div class="price-amt">
          <span class="cur">{sym}</span><span class="num"
            >{cycle === 'year' ? annualPrice(p, currency) : monthlyPrice(p, currency)}</span
          ><span class="per">{$_('pricing.card.perMo')}</span>
        </div>
        <div class="perbrand">
          {#if cycle === 'year'}
            {$_('pricing.card.yearNote', {
              values: { sym, save: (monthlyPrice(p, currency) - annualPrice(p, currency)) * 12 }
            })}
          {:else}
            {$_('pricing.card.monthNote')}
          {/if}
        </div>
        <div class="plan-cta">
          {@render cta(p)}
        </div>
        <ul class="price-feats">
          {#each [...capacityChecks(p), ...planHighlights(p)] as h (h)}
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"
                ><path d="M20 6L9 17l-5-5" /></svg
              >{h}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>

  {#if showCustom}
    <div class="price-card custom">
      <div class="custom-info">
        <div class="tier">{$_('pricing.card.customName')}</div>
        <div class="tagline">{$_('pricing.card.customTagline')}</div>
        <div class="price-amt custom-amt">
          <span class="num">{$_('pricing.card.customPrice')}</span>
        </div>
        <div class="perbrand">{$_('pricing.card.customSub')}</div>
        <div class="plan-cta">
          {#if customCta}
            {@render customCta()}
          {:else}
            <a class="pcta is-ghost" href={BOOKING_URL} target="_blank" rel="noopener">
              {$_('pricing.card.customCta')}
            </a>
          {/if}
        </div>
      </div>
      <ul class="price-feats custom-feats">
        {#each $_('pricing.card.customFeats').split('|') as f (f)}
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"
              ><path d="M20 6L9 17l-5-5" /></svg
            >{f}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .price-plans {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    margin-inline: auto;
  }
  .price-plans.two {
    max-width: 860px;
  }
  .price-plans.three {
    max-width: 1040px;
  }

  .price-grid {
    display: grid;
    gap: 10px;
    width: 100%;
  }
  .price-grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .price-grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @media (max-width: 900px) {
    /* Same full width as the Custom row — do not shrink the paid cards to 420px. */
    .price-plans.two,
    .price-plans.three {
      max-width: none;
    }
    .price-grid.two,
    .price-grid.three {
      grid-template-columns: 1fr;
    }
  }

  .plan-cta {
    margin-bottom: 22px;
  }
  .plan-cta :global(a.pcta),
  .plan-cta :global(button.pcta) {
    display: block;
    width: 100%;
    text-align: center;
    padding: 12px 18px;
    border-radius: 980px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.25s var(--ease),
      background 0.2s var(--ease),
      opacity 0.2s var(--ease);
    box-sizing: border-box;
    text-decoration: none;
    font-family: inherit;
  }
  .plan-cta :global(a.pcta:hover),
  .plan-cta :global(button.pcta:hover) {
    transform: scale(1.02);
  }
  .plan-cta :global(.pcta.is-primary) {
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    color: #fff;
    border: 1px solid transparent;
  }
  .plan-cta :global(.pcta.is-ghost) {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
  }
  .plan-cta :global(.pcta.is-ghost:hover) {
    background: var(--paper-2);
  }
  .plan-cta :global(form) {
    margin: 0;
  }

  .price-card.custom {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: 28px 48px;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
  }
  .custom-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .price-card.custom .tagline {
    min-height: 0;
  }
  .price-card.custom .perbrand {
    margin-bottom: 18px;
  }
  .price-card.custom .plan-cta {
    margin-bottom: 0;
    max-width: 280px;
  }
  .custom-feats {
    margin: 0;
  }
  @media (max-width: 900px) {
    .price-card.custom {
      grid-template-columns: 1fr;
      gap: 22px;
    }
    .price-card.custom .plan-cta {
      max-width: none;
    }
  }

  .price-card.custom .custom-amt .num {
    font-size: clamp(2rem, 4vw, 2.6rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
  }
</style>
