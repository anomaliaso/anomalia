<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();

  const brandName = $derived(data.brand?.name ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = $derived(data.report as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan = $derived(data.plan as any);

  const isTextOnly = (p: { content_type?: string | null }) => p?.content_type === 'text' || p?.content_type === 'link';
</script>

<svelte:head><title>{$_('onboarding.proposal.title', { values: { brand: brandName } })}</title></svelte:head>

<div class="pp-wrap">
  {#if data.stillGenerating}
    <div class="pp-still">
      <div class="pp-spinner"></div>
      <h1>{$_('onboarding.proposal.stillTitle', { values: { brand: brandName } })}</h1>
      <p class="pp-lead">{$_('onboarding.proposal.stillLead')}</p>
    </div>
  {:else}
    <header class="pp-head">
      <div class="pp-kicker">{$_('onboarding.proposal.kicker')}</div>
      <h1>{$_('onboarding.proposal.title', { values: { brand: brandName } })}</h1>
      <p class="pp-lead">{$_('onboarding.proposal.lead')}</p>
      <a class="pp-cta" href={data.activateUrl}>{$_('onboarding.proposal.cta')}</a>
    </header>

    {#if report}
      <section class="pp-sec">
        <h2>{$_('onboarding.proposal.strategyTitle')}</h2>
        {#if report.summary}<p class="pp-summary">{report.summary}</p>{/if}
        <div class="pp-cols">
          {#if report.whiteSpace?.length}
            <div class="pp-col">
              <div class="pp-h">{$_('onboarding.proposal.whiteSpace')}</div>
              <ul>{#each report.whiteSpace as w (w)}<li>{w}</li>{/each}</ul>
            </div>
          {/if}
          {#if report.differentiators?.length}
            <div class="pp-col">
              <div class="pp-h">{$_('onboarding.proposal.edge')}</div>
              <ul>{#each report.differentiators as d (d)}<li>{d}</li>{/each}</ul>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    {#if data.competitors.length}
      <section class="pp-sec">
        <h2>{$_('onboarding.proposal.competitorsTitle')}</h2>
        <div class="pp-comps">
          {#each data.competitors as c (c.name)}
            <div class="pp-comp" title={c.rationale ?? ''}>
              <span class="pp-comp-name">{c.name}</span>
              <span class="pp-comp-kind" class:indirect={c.kind === 'indirect'}>{$_('onboarding.competitors.' + c.kind)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.posts.length}
      <section class="pp-sec">
        <h2>{$_('onboarding.proposal.postsTitle')}</h2>
        <div class="pp-posts">
          {#each data.posts as p (p.caption)}
            <article class="pp-post">
              <div class="pp-img" class:textonly={isTextOnly(p)} style={p.media_url ? `background-image:url(${p.media_url})` : ''}>
                {#if isTextOnly(p)}<span class="pp-textbadge">Aa</span>{/if}
              </div>
              <div class="pp-post-body">
                <div class="pp-plat">{(p.platform ?? '').toUpperCase()}{#if p.slot} · {p.slot}{/if}</div>
                <p class="pp-cap">{p.caption}</p>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}

    {#if plan}
      <section class="pp-sec">
        <h2>{$_('onboarding.proposal.planTitle')}</h2>
        {#if plan.strategy}<p class="pp-summary">{plan.strategy}</p>{/if}
        {#if plan.cadence}<p class="pp-cadence">{$_('editorialPlan.cadence')}: {$_('editorialPlan.freq.' + plan.cadence)}</p>{/if}
        {#if plan.weeks?.length}
          <ol class="pp-weeks">
            {#each plan.weeks as w, i (i)}
              <li><span class="pp-wn">{i + 1}</span>{w.theme}</li>
            {/each}
          </ol>
        {/if}
      </section>
    {/if}

    <div class="pp-foot">
      <a class="pp-cta" href={data.activateUrl}>{$_('onboarding.proposal.cta')}</a>
    </div>
  {/if}
</div>

<style>
  .pp-wrap {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 20px 80px;
  }
  .pp-head {
    text-align: center;
    padding: 16px 0 28px;
  }
  .pp-kicker {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
    font-weight: 600;
    color: #7c5cff;
    margin-bottom: 8px;
  }
  .pp-head h1 {
    font-size: 30px;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
  }
  .pp-lead {
    color: #6e6e73;
    line-height: 1.55;
    margin: 0 auto 18px;
    max-width: 520px;
  }
  .pp-sec {
    border-top: 1px solid #ececf0;
    padding: 22px 0;
  }
  .pp-sec h2 {
    font-size: 18px;
    margin: 0 0 12px;
    letter-spacing: -0.01em;
  }
  .pp-summary {
    color: #2b2b2f;
    line-height: 1.6;
    margin: 0 0 14px;
  }
  .pp-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .pp-h {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #86868b;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .pp-col ul {
    margin: 0;
    padding-left: 18px;
    color: #2b2b2f;
    line-height: 1.5;
  }
  .pp-col li {
    margin-bottom: 5px;
  }
  .pp-comps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pp-comp {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #f5f5f7;
    border-radius: 980px;
    padding: 7px 14px;
    font-size: 14px;
  }
  .pp-comp-kind {
    font-size: 11px;
    font-style: normal;
    color: #fff;
    background: #1d1d1f;
    border-radius: 980px;
    padding: 2px 8px;
  }
  .pp-comp-kind.indirect {
    background: #a0a0a8;
  }
  .pp-posts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }
  .pp-post {
    border: 1px solid #ececf0;
    border-radius: 14px;
    overflow: hidden;
    background: #fff;
  }
  .pp-img {
    aspect-ratio: 1 / 1;
    background-size: cover;
    background-position: center;
    background-color: #f0eefb;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pp-img.textonly {
    background: linear-gradient(135deg, #f5f3ff, #ece9ff);
  }
  .pp-textbadge {
    font-weight: 700;
    color: #7c5cff;
    font-size: 22px;
  }
  .pp-post-body {
    padding: 12px 14px 14px;
  }
  .pp-plat {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #86868b;
    margin-bottom: 6px;
  }
  .pp-cap {
    font-size: 13.5px;
    line-height: 1.45;
    margin: 0;
    color: #1d1d1f;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .pp-cadence {
    color: #6e6e73;
    margin: 0 0 12px;
    font-size: 14px;
  }
  .pp-weeks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pp-weeks li {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #1d1d1f;
  }
  .pp-wn {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    border-radius: 50%;
    background: #1d1d1f;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
  }
  .pp-foot {
    text-align: center;
    padding: 26px 0 0;
  }
  .pp-cta {
    display: inline-block;
    background: #1d1d1f;
    color: #fff;
    padding: 14px 30px;
    border-radius: 980px;
    text-decoration: none;
    font-weight: 600;
    font-size: 15px;
  }
  .pp-still {
    text-align: center;
    padding: 80px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .pp-spinner {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 3px solid #ece9ff;
    border-top-color: #7c5cff;
    animation: pp-spin 0.8s linear infinite;
    margin-bottom: 6px;
  }
  @keyframes pp-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @container workbench (max-width: 560px) {
    .pp-cols {
      grid-template-columns: 1fr;
    }
  }
</style>
