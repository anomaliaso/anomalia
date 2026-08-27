<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import AiSurfaceGlyph from '$lib/components/AiSurfaceGlyph.svelte';
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { Radar } from '@lucide/svelte';
  import { page } from '$app/stores';
  import { refreshCredits } from '$lib/stores/credits';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';
  import { brandFaviconUrl, domainFaviconUrl, getAiSurface } from '$lib/ai-surfaces';

  let { data, form } = $props();

  const brandSlug = $derived($page.params.brand ?? '');

  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (brandSlug) setTimeout(() => refreshCredits(brandSlug), 600);
    };
  };

  const isEmpty = $derived(!data.geo);

  // The offer-layer findings, worst first — a shop is graded on these instead of on the generic
  // content-schema check, so the tile has to follow what the audit decided the site is.
  const OFFER_FINDINGS = ['no-product-schema', 'no-offer-schema', 'incomplete-offer-schema', 'unactionable-offer-schema'];
  const CHECKS = $derived([
    'ai-crawlers-blocked',
    'no-org-schema',
    'no-faq-schema',
    data.geo?.tech?.commerce?.isCommerce ? 'no-product-schema' : 'no-content-schema',
    'no-llms-txt'
  ]);

  let copiedKey = $state('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => { if (copiedKey === key) copiedKey = ''; }, 1500);
    } catch { /* clipboard blocked */ }
  }

  function hideBrokenFavicon(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.display = 'none';
    const fallback = img.nextElementSibling as HTMLElement | null;
    if (fallback) fallback.hidden = false;
  }

  function brandInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issuesById = (geo: any) => new Map(((geo?.tech?.issues ?? []) as any[]).map((i) => [i.id, i]));
  const techById = $derived(issuesById(data.geo));

  const hasGaps = $derived(
    !!data.geo && ((data.geo.tech?.issues?.length ?? 0) > 0 || (data.geo.share_of_voice ?? 100) < 100)
  );

  const engineLabel = (e: string) => getAiSurface(e).label;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perEngine = $derived.by(() => {
    const acc: Record<string, { t: number; m: number }> = {};
    for (const c of (data.geo?.citations ?? []) as any[]) {
      if (!c?.engine) continue;
      (acc[c.engine] ??= { t: 0, m: 0 }).t++;
      if (c.brandMentioned) acc[c.engine].m++;
    }
    return Object.entries(acc).map(([engine, v]) => ({ engine, pct: Math.round((v.m / v.t) * 100) }));
  });

  // Landscape: aggregate what the citations already captured — every named brand and every cited
  // source across all (engine × prompt) answers. Pure derived, no new data needed.
  const brandName = $derived(data.brand?.name ?? data.brandName ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cites = $derived((data.geo?.citations ?? []) as any[]);
  // The brand's own registrable host, used to highlight it among the AI Overview sources.
  const ownDomain = $derived((data.geo?.search as any)?.domain ?? '');

  const brandsMentioned = $derived.by(() => {
    const counts = new Map<string, number>();
    const bump = (n: string) => { const k = (n ?? '').trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); };
    for (const c of cites) {
      if (c.brandMentioned && brandName) bump(brandName);
      for (const comp of (c.competitors ?? [])) bump(comp);
    }
    const brandLower = brandName.toLowerCase();
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, isBrand: name.toLowerCase() === brandLower }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  });

  const topSources = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const c of cites) for (const s of (c.sources ?? [])) { const k = String(s ?? '').trim(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count).slice(0, 20);
  });

  const maxBrandCount = $derived(brandsMentioned[0]?.count ?? 1);
  const maxSourceCount = $derived(topSources[0]?.count ?? 1);

  const summary = $derived.by(() => {
    if (!cites.length) return null;
    const prompts = new Set(cites.map((c) => c.prompt)).size;
    const engines = [...new Set(cites.map((c) => c.engine).filter(Boolean))].map(engineLabel).join(', ');
    const mentioned = cites.filter((c) => c.brandMentioned).length;
    return {
      prompts, engines, mentioned, answers: cites.length, pct: data.geo?.share_of_voice ?? 0,
      topBrand: brandsMentioned[0] ?? null,
      topSource: topSources[0]?.domain ?? null
    };
  });

  const formError = $derived.by(() => {
    const err = form?.error;
    if (!err) return null;
    if (err === 'credits_exhausted') return $_('app.citations.creditsExhausted');
    return String(err);
  });
  // "Upgrade or wait until they reset" senza un link a cui andare è un vicolo cieco.
  const formErrorExhausted = $derived(form?.error === 'credits_exhausted');
</script>

{#snippet ring(value: number, label: string, suffix: string)}
  {@const v = Math.max(0, Math.min(100, value ?? 0))}
  {@const color = v >= 80 ? '#16a34a' : v >= 50 ? '#d97706' : '#dc2626'}
  {@const circ = 2 * Math.PI * 40}
  <div class="gauge">
    <svg viewBox="0 0 96 96" width="96" height="96">
      <circle cx="48" cy="48" r="40" fill="none" stroke="var(--line)" stroke-width="7" />
      <circle cx="48" cy="48" r="40" fill="none" stroke={color} stroke-width="7" stroke-linecap="round"
        stroke-dasharray={circ} stroke-dashoffset={circ * (1 - v / 100)} transform="rotate(-90 48 48)" />
      <text x="48" y="54" text-anchor="middle" font-size="24" font-weight="700" fill="var(--ink)">{v}{suffix}</text>
    </svg>
    <div class="gauge-label">{label}</div>
  </div>
{/snippet}

<div class="content">
  <PageHead title={$_('app.studio.geo.pageTitle')} subtitle={$_('app.studio.geo.pageSubtitle')}>
    {#snippet actions()}
      {#if !isEmpty}
        <form class="topbar-cta-wrap" class:is-busy={busy} method="POST" action="?/geoRunNow" use:enhance={withBusy}>
          <TopbarCta {busy} Icon={Radar}>
            {busy ? $_('app.studio.geo.running') : $_('app.studio.geo.run')}
          </TopbarCta>
        </form>
      {/if}
    {/snippet}
  </PageHead>

  {#if data.opportunities?.length}
    <section class="card opp-panel" style="margin: 0 0 16px; padding: 16px;">
      <h3 style="margin:0 0 8px;">Citation opportunities
        {#if data.winRate != null}<span class="muted" style="font-weight:400;font-size:13px;"> · citation wins {data.winRate}% (target cited)</span>{/if}
      </h3>
      <p class="muted" style="font-size:12px;margin:0 0 10px;">
        Measured engines: {(data.measuredEngines ?? []).join(', ') || 'gemini'}
        · Robots-only (not probed): perplexity/copilot unless API keys are set
        · Win = published URL (or brand host) appears in AI sources on a gap engine
      </p>
      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">
        {#each data.opportunities.slice(0, 8) as o (o.id)}
          {@const lastLog = Array.isArray(o.reprobe_log) && o.reprobe_log.length ? o.reprobe_log[o.reprobe_log.length - 1] : null}
          {@const anyTargetCited = Array.isArray(o.reprobe_log) && o.reprobe_log.some((e) => e?.targetCited)}
          <li style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--line,#eee);padding-bottom:8px;">
            <div style="min-width:0;flex:1;">
              <div style="font-size:13px;font-weight:600;">{o.prompt}</div>
              <div class="muted" style="font-size:12px;">
                {o.status}{#if o.engine} · gap: {o.engine}{/if}
                {#if o.reprobe_attempts != null && (o.status === 'applied' || o.status === 'won' || o.status === 'lost')}
                  · attempt {o.reprobe_attempts}/3
                {/if}
                {#if o.status === 'won'} · target cited{/if}
                {#if o.status === 'lost'} · no citation{/if}
              </div>
              {#if o.target_url}
                <div style="font-size:12px;margin-top:2px;">
                  <span class="muted">Live URL: </span>
                  <a style="font-size:12px;word-break:break-all;" href={o.target_url} target="_blank" rel="noopener">{o.target_url}</a>
                </div>
              {/if}
              {#if lastLog}
                <div class="muted" style="font-size:11px;margin-top:4px;">
                  Last reprobe: {lastLog.engine}
                  {#if lastLog.error} · probe error ({lastLog.error})
                  {:else}
                    · {lastLog.mentioned ? 'mentioned' : 'not mentioned'}
                    · {lastLog.targetCited || anyTargetCited ? 'target/brand in sources' : 'no target in sources'}
                  {/if}
                </div>
              {/if}
            </div>
            {#if o.status === 'open'}
              <div style="display:flex;gap:6px;flex-shrink:0;">
                <form method="POST" action="?/applyOpportunity" use:enhance={withBusy}>
                  <input type="hidden" name="id" value={o.id} />
                  <button type="submit" style="font-size:12px;">Apply & publish</button>
                </form>
                <form method="POST" action="?/dismissOpportunity" use:enhance={withBusy}>
                  <input type="hidden" name="id" value={o.id} />
                  <button type="submit" style="font-size:12px;">Dismiss</button>
                </form>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if formError}<div class="err" role="alert">{formError}{#if formErrorExhausted}{' '}<UpgradeLink />{/if}</div>{/if}

  {#if isEmpty}
    <div class="empty-geo">
      <img class="empty-geo-hero" src="/seo-geo-hero.webp" alt="" />
      <h2>{$_('app.studio.geo.emptyTitle')}</h2>
      <p>{$_('app.studio.geo.emptyDesc')}</p>
      <form method="POST" action="?/geoRunNow" use:enhance={withBusy}>
        <TopbarCta {busy} Icon={Radar} class="empty-geo-btn">
          {busy ? $_('app.studio.geo.running') : $_('app.studio.geo.emptyCta')}
        </TopbarCta>
      </form>
    </div>
  {:else}
    <div class="geo-layout">
    <nav class="geo-index">
      <a href="#overview" class="index-link">{$_('app.studio.geo.nav.overview')}</a>
      <a href="#technical" class="index-link">{$_('app.studio.geo.nav.technical')}</a>
      <a href="#citations" class="index-link">{$_('app.studio.geo.nav.citations')}</a>
      <a href="#insights" class="index-link">{$_('app.studio.geo.nav.insights')}</a>
      <a href="#artifacts" class="index-link">{$_('app.studio.geo.nav.artifacts')}</a>
    </nav>

    <div class="geo-content">
      <!-- OVERVIEW -->
      <section id="overview" class="geo-section">
        <h3 class="section-title">{$_('app.studio.geo.nav.overview')}</h3>
        {#if data.geo}
          <div class="card gauges">
            {@render ring(data.geo.share_of_voice ?? 0, $_('app.studio.geo.shareOfVoice'), '%')}
          </div>
        {:else}
          <div class="card empty-state">
            <p class="muted">{$_('app.studio.geo.never')}</p>
          </div>
        {/if}
      </section>

      <!-- TECHNICAL CHECKS (GEO-only) -->
      {#if data.geo?.tech}
        <section id="technical" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.nav.technical')}</h3>
          <div class="card checks">
            {#each CHECKS as id (id)}
              {@const issue = id === 'no-product-schema'
                ? OFFER_FINDINGS.map((f) => techById.get(f)).find(Boolean)
                : techById.get(id)}
              <div class="check" class:bad={!!issue}>
                <span class="tick">{issue ? '✕' : '✓'}</span>
                <div>
                  <div class="check-label">{$_('app.studio.geo.checks.' + id)}</div>
                  {#if issue}<div class="muted small">{issue.fix}</div>{/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {:else if data.geo}
        <section id="technical" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.nav.technical')}</h3>
          <div class="card empty-state"><p class="muted">{$_('app.studio.geo.techUnavailable')}</p></div>
        </section>
      {/if}

      <!-- CITATIONS -->
      {#if data.geo?.citations?.length}
        <section id="citations" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.nav.citations')}</h3>
          <p class="section-desc">{$_('app.studio.geo.citationsDesc')}</p>
          {#if perEngine.length}
            <div class="engine-sov">
              {#each perEngine as pe (pe.engine)}
                <span class="engine-pill">
                  <AiSurfaceGlyph engine={pe.engine} size="md" />
                  <span class="engine-pill-label">{engineLabel(pe.engine)}</span>
                  <b>{pe.pct}%</b>
                </span>
              {/each}
            </div>
          {/if}
          <div class="card">
            <ul class="citations">
              {#each data.geo.citations as c (`${c.engine ?? ''}-${c.prompt}`)}
                <li>
                  <div class="ct-meta">
                    <span class="chip2" class:good={c.brandMentioned} class:bad={!c.brandMentioned}>
                      {c.brandMentioned ? `${$_('app.studio.geo.mentioned')}${c.rank ? ` · #${c.rank}` : ''}` : $_('app.studio.geo.absent')}
                    </span>
                    {#if c.engine}
                      <span class="engine-tag">
                        <AiSurfaceGlyph engine={c.engine} />
                        {engineLabel(c.engine)}
                      </span>
                    {/if}
                  </div>
                  <span class="ct-q">{c.prompt}</span>
                  {#if !c.brandMentioned && c.competitors?.length}
                    <div class="comp-row">
                      <span class="muted small">{$_('app.studio.geo.competitorsNamed')}:</span>
                      <div class="comp-chips">
                        {#each c.competitors.slice(0, 5) as comp (comp)}
                          <span class="comp-chip">
                            <span class="fav">
                              <img src={brandFaviconUrl(comp)} alt="" width="14" height="14" loading="lazy" onerror={hideBrokenFavicon} />
                              <span class="fav-fallback" hidden>{brandInitials(comp)}</span>
                            </span>
                            {comp}
                          </span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        </section>
      {/if}

      <!-- GOOGLE AI OVERVIEW: ranking is one thing, being inside the answer box is another -->
      {#if data.aiOverview}
        {@const ao = data.aiOverview}
        <section id="ai-overview" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.aiOverviewTitle')}</h3>
          <p class="section-desc">{$_('app.studio.geo.aiOverviewDesc')}</p>

          <div class="ao-rows">
            {#each ao.rows as row (row.keyword)}
              <div class="card ao-row">
                <div class="ao-head">
                  <strong>{row.keyword}</strong>
                  {#if !row.hasAiOverview}
                    <span class="ao-badge none">{$_('app.studio.geo.aiOverviewNone')}</span>
                  {:else if row.cited}
                    <span class="ao-badge yes">{$_('app.studio.geo.aiOverviewCited')}</span>
                  {:else}
                    <span class="ao-badge no">{$_('app.studio.geo.aiOverviewNotCited')}</span>
                  {/if}
                  {#if row.position}
                    <span class="muted small">#{row.position}</span>
                  {/if}
                </div>
                {#if row.hasAiOverview && row.sources.length}
                  <div class="ao-sources">
                    {#each row.sources as s}<span class="ao-src" class:mine={s === ownDomain}>{s}</span>{/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- LANDSCAPE: brands named + top sources, aggregated from the citations -->
      {#if cites.length}
        <section id="insights" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.insightsTitle')}</h3>
          <p class="section-desc">{$_('app.studio.geo.insightsDesc')}</p>

          {#if summary}
            <p class="summary">
              {$_('app.studio.geo.summary', { values: { prompts: summary.prompts, engines: summary.engines, mentioned: summary.mentioned, answers: summary.answers, pct: summary.pct } })}
              {#if summary.topBrand}{' '}{$_('app.studio.geo.summaryTopBrand', { values: { brand: summary.topBrand.name, count: summary.topBrand.count } })}{/if}
              {#if summary.topSource}{' '}{$_('app.studio.geo.summaryTopSource', { values: { source: summary.topSource } })}{/if}
            </p>
          {/if}

          <div class="landscape">
            {#if brandsMentioned.length}
              <div class="card lb">
                <div class="lb-title">{$_('app.studio.geo.brandsMentionedTitle')}</div>
                {#each brandsMentioned as b (b.name)}
                  <div class="lb-row" class:me={b.isBrand}>
                    <span class="lb-name">
                      <span class="fav">
                        <img src={brandFaviconUrl(b.name)} alt="" width="16" height="16" loading="lazy" onerror={hideBrokenFavicon} />
                        <span class="fav-fallback" hidden>{brandInitials(b.name)}</span>
                      </span>
                      <span class="lb-name-text">{b.name}</span>
                      {#if b.isBrand}<span class="lb-tag">{$_('app.studio.geo.yourBrand')}</span>{/if}
                    </span>
                    <span class="lb-bar"><span class="lb-fill" style="width:{Math.round((b.count / maxBrandCount) * 100)}%"></span></span>
                    <span class="lb-count">{b.count}</span>
                  </div>
                {/each}
              </div>
            {/if}
            {#if topSources.length}
              <div class="card lb">
                <div class="lb-title">{$_('app.studio.geo.topSourcesTitle')}</div>
                {#each topSources as s (s.domain)}
                  <div class="lb-row">
                    <a class="lb-name" href={'https://' + s.domain} target="_blank" rel="noopener">
                      <span class="fav">
                        <img src={domainFaviconUrl(s.domain)} alt="" width="16" height="16" loading="lazy" onerror={hideBrokenFavicon} />
                        <span class="fav-fallback" hidden>{brandInitials(s.domain)}</span>
                      </span>
                      <span class="lb-name-text">{s.domain}</span>
                    </a>
                    <span class="lb-bar"><span class="lb-fill" style="width:{Math.round((s.count / maxSourceCount) * 100)}%"></span></span>
                    <span class="lb-count">{s.count}×</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <!-- ARTIFACTS -->
      <section id="artifacts" class="geo-section">
        <h3 class="section-title">{$_('app.studio.geo.nav.artifacts')}</h3>
        {#if hasGaps}
          <form method="POST" action="?/geoGenerateArtifacts" use:enhance={withBusy} class="gen-form">
            <button class="btn ghost" type="submit" disabled={busy}>{$_('app.studio.geo.generateArtifacts')}</button>
          </form>
        {/if}

        {#if data.geoArtifacts?.length}
          <p class="muted small artifact-desc">{$_('app.studio.geo.artifactsDesc')}</p>
          <div class="artifacts">
            {#each data.geoArtifacts as a (a.id)}
              <div class="card artifact">
                <div class="artifact-head">
                  <span class="chip2">{a.kind}</span>
                  <b>{a.title}</b>
                  <form method="POST" action="?/geoDismissArtifact" use:enhance={withBusy} style="margin-left:auto;">
                    <input type="hidden" name="id" value={a.id} />
                    <button class="btn link" type="submit" disabled={busy}>{$_('app.studio.geo.dismiss')}</button>
                  </form>
                </div>

                <div class="steps">
                  <div class="steps-title">{$_('app.studio.geo.publish.title')}</div>
                  <ol>
                    {#if a.kind === 'faq'}
                      <li>{$_('app.studio.geo.publish.faq.s1', { values: { path: a.target_path } })}</li>
                      <li>{$_('app.studio.geo.publish.faq.s2')}</li>
                      <li>{$_('app.studio.geo.publish.faq.s3', { values: { path: a.target_path } })}</li>
                    {:else if a.kind === 'org_schema'}
                      <li>{$_('app.studio.geo.publish.org_schema.s1')}</li>
                    {:else if a.kind === 'llms_txt'}
                      <li>{$_('app.studio.geo.publish.llms_txt.s1', { values: { path: a.target_path } })}</li>
                    {:else if a.kind === 'product_schema'}
                      <li>{$_('app.studio.geo.publish.product_schema.s1')}</li>
                      <li>{$_('app.studio.geo.publish.product_schema.s2')}</li>
                    {/if}
                  </ol>
                </div>

                {#each (a.blocks ?? [{ labelKey: '', content: a.body }]) as b, bi}
                  <div class="block">
                    {#if b.labelKey}<div class="block-label">{$_('app.studio.geo.blocks.' + b.labelKey)}</div>{/if}
                    <div class="ta-wrap">
                      <button class="copy-btn" type="button" onclick={() => copy(b.content, a.id + '-' + bi)}>
                        {copiedKey === a.id + '-' + bi ? $_('app.studio.geo.copied') : $_('app.studio.geo.copy')}
                      </button>
                      <textarea readonly rows="8">{b.content}</textarea>
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {:else if !hasGaps && data.geo}
          <div class="card empty-state"><p class="muted">{$_('app.studio.geo.artifactsDesc')}</p></div>
        {/if}
      </section>
    </div>
  </div>
  {/if}
</div>

<style>
  .content { max-width: var(--content-max, 960px); margin: 0 auto; padding: 0; }
  .muted { color: var(--ink-faint); font-size: 13px; margin: 0; }
  .small { font-size: 12px; }
  .err { background: #fde; color: #a00; border-radius: 12px; padding: 10px 14px; font-size: 13px; margin-bottom: 4px; }

  /* empty state when no audit exists */
  .empty-geo {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 24px; max-width: 480px; margin: 40px auto 0;
  }
  .empty-geo-hero { width: 100%; max-width: 560px; border-radius: 14px; margin: 0 auto 20px; display: block; }
  .empty-geo h2 { font-size: 22px; font-weight: 700; margin: 0 0 10px; color: var(--ink); }
  .empty-geo p { font-size: 14px; color: var(--ink-soft); margin: 0 0 28px; line-height: 1.55; }
  :global(.empty-geo-btn.topbar-cta) { font-size: 15px; padding: 12px 28px; }

  /* layout: sticky index left + scrollable content right */
  .geo-layout { display: flex; gap: 48px; margin-top: 32px; }
  .geo-index {
    position: sticky; top: 24px; align-self: flex-start; flex: 0 0 180px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .index-link {
    font-size: 14px; font-weight: 500; color: var(--ink-soft); text-decoration: none;
    padding: 8px 12px; border-radius: 10px; transition: background 0.15s, color 0.15s;
  }
  .index-link:hover { background: var(--paper-2); color: var(--ink); }
  .geo-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 44px; }
  .geo-section { scroll-margin-top: 24px; }
  .section-title {
    font-size: clamp(24px, 3vw, 30px); font-weight: 600; letter-spacing: -0.03em;
    margin: 0 0 20px; color: var(--ink);
  }
  .section-desc { font-size: 13.5px; color: var(--ink-faint); line-height: 1.5; margin: -12px 0 20px; max-width: 580px; }

  /* AI Overview panel */
  .ao-rows { display: flex; flex-direction: column; gap: 10px; }
  .ao-row { padding: 14px 16px; }
  .ao-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ao-head strong { font-size: 14px; }
  .ao-badge {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    padding: 3px 9px; border-radius: 999px;
  }
  .ao-badge.yes { background: #dcfce7; color: #166534; }
  .ao-badge.no { background: #fee2e2; color: #b91c1c; }
  .ao-badge.none { background: var(--wash, #f1f5f9); color: var(--ink-faint); }
  .ao-sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .ao-src {
    font-size: 11.5px; padding: 3px 9px; border-radius: 999px;
    background: var(--wash, #f1f5f9); color: var(--ink-faint);
  }
  .ao-src.mine { background: #dcfce7; color: #166534; font-weight: 600; }

  .card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px; }

  .btn { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer; border: 1px solid transparent; line-height: 1; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }
  .btn.link { background: transparent; border: none; color: var(--ink-faint); padding: 4px 6px; font-weight: 500; }

  /* rings */
  .gauges { display: flex; gap: 48px; flex-wrap: wrap; justify-content: center; }
  .gauge { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .gauge-label { font-size: 12px; color: var(--ink-faint); font-weight: 600; }

  /* checks */
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px; }
  .check { display: flex; gap: 12px; align-items: flex-start; }
  .check .tick { width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; display: grid; place-items: center;
    font-size: 13px; font-weight: 700; background: #dff5e1; color: #137a2b; }
  .check.bad .tick { background: #fde; color: #c0392b; }
  .check-label { font-size: 13.5px; font-weight: 600; color: var(--ink); }

  /* citations */
  .citations { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .citations li { font-size: 13.5px; display: flex; flex-direction: column; gap: 6px;
    padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .citations li:last-child { border-bottom: none; padding-bottom: 0; }
  .ct-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .ct-q { color: var(--ink); }
  .engine-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 600; padding: 2px 8px 2px 4px; border-radius: 999px; background: var(--paper-2); color: var(--ink-faint); border: 1px solid var(--line); }
  .engine-sov { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; }
  .engine-pill { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px 5px 6px; }
  .engine-pill-label { color: var(--ink-soft); }
  .engine-pill b { color: var(--ink); }
  .chip2 { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; padding: 2px 9px;
    border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); align-self: flex-start; }
  .chip2.good { background: #dff5e1; color: #137a2b; }
  .chip2.bad { background: #fde; color: #c0392b; }
  .comp-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .comp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .comp-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px 2px 4px; }

  .fav {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; flex: 0 0 auto; border-radius: 4px; overflow: hidden;
    background: var(--paper-2); border: 1px solid var(--line);
  }
  .fav img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .fav-fallback {
    font-size: 7px; font-weight: 700; line-height: 1; color: var(--ink-faint);
    letter-spacing: -0.02em;
  }
  .comp-chip .fav { width: 14px; height: 14px; }

  /* landscape: brands named + top sources */
  .summary { font-size: 14px; line-height: 1.55; color: var(--ink); margin: 0 0 18px; max-width: 640px; }
  .landscape { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .lb { padding: 20px 22px; }
  .lb-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 14px; }
  .lb-row { display: grid; grid-template-columns: minmax(0, 1fr) 72px auto; gap: 10px; align-items: center; padding: 5px 0; }
  .lb-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--ink); text-decoration: none; }
  .lb-name-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  a.lb-name:hover .lb-name-text { text-decoration: underline; }
  .lb-row.me .lb-name { font-weight: 700; }
  .lb-tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: #dff5e1; color: #137a2b; flex: 0 0 auto; }
  .lb-bar { height: 6px; border-radius: 999px; background: var(--paper-2); overflow: hidden; }
  .lb-fill { display: block; height: 100%; border-radius: 999px; background: var(--accent, #7c5cff); }
  .lb-row.me .lb-fill { background: #16a34a; }
  .lb-count { font-size: 12px; font-weight: 600; color: var(--ink-soft); text-align: right; min-width: 28px; }

  /* artifacts */
  .gen-form { margin-bottom: 8px; }
  .artifact-desc { margin-bottom: 14px; }
  .artifacts { display: flex; flex-direction: column; gap: 16px; }
  .artifact { border-color: var(--line); }
  .artifact-head { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  .artifact-head b { font-size: 14px; color: var(--ink); }
  .steps { background: var(--paper-2); border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; }
  .steps-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 6px; }
  .steps ol { margin: 0; padding-left: 18px; font-size: 13px; color: var(--ink-soft); display: flex; flex-direction: column; gap: 3px; }

  .block { margin-top: 12px; }
  .block:first-of-type { margin-top: 0; }
  .block-label { font-size: 12px; font-weight: 600; color: var(--ink-faint); margin-bottom: 6px; }
  .ta-wrap { position: relative; }
  .copy-btn { position: absolute; top: 8px; right: 8px; z-index: 1; font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper);
    color: var(--ink-soft); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .copy-btn:hover { background: var(--paper-2); }
  textarea { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5;
    white-space: pre; overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 12px; padding-top: 14px;
    background: var(--paper); color: var(--ink); resize: vertical; box-sizing: border-box; }

  .empty-state { text-align: center; }
  .empty-state .muted { font-size: 14px; }

  @container workbench (max-width: 760px) {
    .geo-layout { flex-direction: column; gap: 24px; }
    .geo-index { position: static; flex: none; flex-direction: row; flex-wrap: wrap; gap: 8px; }
    .index-link { font-size: 13px; padding: 6px 10px; }
    .checks { grid-template-columns: 1fr; padding: 18px; }
    .landscape { grid-template-columns: 1fr; }
  }
</style>
