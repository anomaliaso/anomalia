<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { ScanSearch } from '@lucide/svelte';

  let { data, form } = $props();
  const brandSlug = $derived((data as { brand?: { slug?: string } }).brand?.slug ?? '');

  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };

  const isEmpty = $derived(!data.geo && !data.seoPlan);
  const m = $derived(data.seoMetrics);

  function sparkPath(values: Array<number | null | undefined>, w = 120, h = 36): string {
    const nums = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
    const present = nums.filter((v): v is number => v != null);
    if (present.length < 2) return '';
    const min = Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    const step = w / Math.max(1, nums.length - 1);
    return nums
      .map((v, i) => {
        const y = v == null ? h / 2 : h - ((v - min) / span) * (h - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const trafficSpark = $derived(sparkPath((m?.trend ?? []).map((p) => p.traffic)));
  const rankSpark = $derived(sparkPath((m?.trend ?? []).map((p) => p.domainRating)));
  const kwSpark = $derived(sparkPath((m?.trend ?? []).map((p) => p.organicKeywords)));
  const refSpark = $derived(sparkPath((m?.trend ?? []).map((p) => p.referringDomains)));

  const CHECKS = ['noindex-active', 'no-sitemap', 'weak-meta', 'images-no-alt'];

  let copiedKey = $state('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => { if (copiedKey === key) copiedKey = ''; }, 1500);
    } catch { /* clipboard blocked */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issuesById = (geo: any) => new Map(((geo?.tech?.issues ?? []) as any[]).map((i) => [i.id, i]));
  const techById = $derived(issuesById(data.geo));

  // Expert-assistance dialog: one shared <dialog>, opened for the clicked initiative.
  let expertDialog = $state<HTMLDialogElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeInit = $state<any>(null);
  let expertSent = $state(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function openExpert(init: any) { activeInit = init; expertSent = false; expertDialog?.showModal(); }
  const expertEnhance = () => {
    busy = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async ({ result, update }: { result: any; update: (o?: { reset?: boolean }) => Promise<void> }) => {
      busy = false;
      if (result?.type === 'success') expertSent = true;
      await update({ reset: false });
    };
  };

  type Status = 'good' | 'warn' | 'bad';
  const statusLabel: Record<Status, string> = $derived({
    good: $_('app.studio.geo.content.statusGood'),
    warn: $_('app.studio.geo.content.statusWarn'),
    bad: $_('app.studio.geo.content.statusBad')
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentChecks = $derived.by(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = data.geo?.tech?.content;
    if (!c) return [];
    const s = c.statuses ?? {};
    const detailFor = (key: string, status: Status): string => {
      if (status === 'good') return $_('app.studio.geo.content.statusGood');
      switch (key) {
        case 'title':
          return c.titleLength > 60 ? $_('app.studio.geo.content.titleLong') : $_('app.studio.geo.content.titleShort');
        case 'description':
          return c.descriptionLength > 160 ? $_('app.studio.geo.content.descLong') : $_('app.studio.geo.content.descShort');
        case 'h1':
          return c.h1Count === 0 ? $_('app.studio.geo.content.h1None') : $_('app.studio.geo.content.h1Multiple');
        case 'depth':
          return c.wordCount < 250 ? $_('app.studio.geo.content.depthThin') : $_('app.studio.geo.content.depthLow');
        case 'ratio':
          return $_('app.studio.geo.content.ratioLow');
        case 'openGraph': {
          const og = c.openGraph ?? {};
          const count = [og.image, og.description, og.type, og.url].filter(Boolean).length;
          return count === 0 ? $_('app.studio.geo.content.ogMissing') : $_('app.studio.geo.content.ogPartial');
        }
        case 'headings':
          return $_('app.studio.geo.content.headingsJump');
        case 'images': {
          const total = c.imagesTotal ?? 0;
          const missing = c.imagesWithoutAlt ?? 0;
          return total === 0 ? $_('app.studio.geo.content.imagesNone')
            : $_('app.studio.geo.content.imagesMissingAlt', { values: { n: missing, total } });
        }
        case 'links': {
          const n = c.internalLinks ?? 0;
          return n === 0 ? $_('app.studio.geo.content.linksNone') : $_('app.studio.geo.content.linksLow', { values: { n } });
        }
        case 'robots':
          return $_('app.studio.geo.content.robotsNoindex');
        case 'qa':
          return $_('app.studio.geo.content.qaNone');
        case 'nap':
          return $_('app.studio.geo.content.napMissing');
        case 'lang':
          return $_('app.studio.geo.content.langMissing');
        default:
          return '';
      }
    };
    const og = c.openGraph ?? {};
    const ogCount = [og.image, og.description, og.type, og.url].filter(Boolean).length;
    return [
      {
        label: $_('app.studio.geo.content.titleLabel'),
        raw: c.title ?? null,
        value: c.title ? `${c.titleLength} ${$_('app.studio.geo.content.chars')}` : $_('app.studio.geo.content.missing'),
        status: s.title as Status,
        detail: detailFor('title', s.title as Status)
      },
      {
        label: $_('app.studio.geo.content.descLabel'),
        raw: c.description ?? null,
        value: c.description ? `${c.descriptionLength} ${$_('app.studio.geo.content.chars')}` : $_('app.studio.geo.content.missing'),
        status: s.description as Status,
        detail: detailFor('description', s.description as Status)
      },
      {
        label: $_('app.studio.geo.content.h1Label'),
        raw: null,
        value: c.h1Count === 0 ? $_('app.studio.geo.content.missing') : $_('app.studio.geo.content.h1Count', { values: { n: c.h1Count } }),
        status: s.h1 as Status,
        detail: detailFor('h1', s.h1 as Status)
      },
      {
        label: $_('app.studio.geo.content.depthLabel'),
        raw: null,
        value: `${c.wordCount ?? 0} ${$_('app.studio.geo.content.words')}`,
        status: s.depth as Status,
        detail: detailFor('depth', s.depth as Status)
      },
      {
        label: $_('app.studio.geo.content.ratioLabel'),
        raw: null,
        value: `${c.textRatio ?? 0}%`,
        status: s.ratio as Status,
        detail: detailFor('ratio', s.ratio as Status)
      },
      {
        label: $_('app.studio.geo.content.ogLabel'),
        raw: null,
        value: `${ogCount}/4`,
        status: s.openGraph as Status,
        detail: detailFor('openGraph', s.openGraph as Status)
      },
      {
        label: $_('app.studio.geo.content.headingsLabel'),
        raw: null,
        value: (c.headingLevels ?? []).length > 0
          ? `${(c.headingLevels ?? []).length} headings${(c.headingJumps ?? 0) > 0 ? ` · ${c.headingJumps} ${$_('app.studio.geo.content.statusWarn')}` : ''}`
          : $_('app.studio.geo.content.missing'),
        status: s.headings as Status,
        detail: detailFor('headings', s.headings as Status)
      },
      {
        label: $_('app.studio.geo.content.imagesLabel'),
        raw: null,
        value: (c.imagesTotal ?? 0) === 0 ? $_('app.studio.geo.content.imagesNone')
          : `${c.imagesWithAlt ?? 0}/${c.imagesTotal ?? 0} ${$_('app.studio.geo.content.images')}`,
        status: s.images as Status,
        detail: detailFor('images', s.images as Status)
      },
      {
        label: $_('app.studio.geo.content.linksLabel'),
        raw: null,
        value: `${c.internalLinks ?? 0} ${$_('app.studio.geo.content.links')}`,
        status: s.links as Status,
        detail: detailFor('links', s.links as Status)
      },
      {
        label: $_('app.studio.geo.content.robotsLabel'),
        raw: null,
        value: (c.metaRobotsNoindex ?? false) ? 'noindex' : $_('app.studio.geo.content.robotsOk'),
        status: s.robots as Status,
        detail: detailFor('robots', s.robots as Status)
      },
      {
        label: $_('app.studio.geo.content.qaLabel'),
        raw: null,
        value: `${c.qaBlocks ?? 0} ${$_('app.studio.geo.content.questions')}`,
        status: s.qa as Status,
        detail: detailFor('qa', s.qa as Status)
      },
      {
        label: $_('app.studio.geo.content.napLabel'),
        raw: null,
        value: (c.hasNap ?? false) ? $_('app.studio.geo.content.napOk') : $_('app.studio.geo.content.napMissing'),
        status: s.nap as Status,
        detail: detailFor('nap', s.nap as Status)
      },
      {
        label: $_('app.studio.geo.content.langLabel'),
        raw: null,
        value: c.htmlLang ? $_('app.studio.geo.content.langOk', { values: { lang: c.htmlLang } }) : $_('app.studio.geo.content.langMissing'),
        status: s.lang as Status,
        detail: detailFor('lang', s.lang as Status)
      }
    ];
  });
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
  <PageHead title={$_('app.studio.seo.pageTitle')} subtitle={$_('app.studio.seo.pageSubtitle')}>
    {#snippet actions()}
      {#if !isEmpty}
        <form class="topbar-cta-wrap" class:is-busy={busy} method="POST" action="?/geoRunNow" use:enhance={withBusy}>
          <TopbarCta {busy} Icon={ScanSearch}>
            {busy ? $_('app.studio.seo.running') : $_('app.studio.seo.run')}
          </TopbarCta>
        </form>
      {/if}
    {/snippet}
  </PageHead>

  {#if form?.error}<div class="err">{form.error}</div>{/if}

  {#if data.gsc?.configured && !data.gscReady && data.gscGate}
    <div class="err" role="status" style="margin:0 0 12px;padding:12px;background:#fff8e6;color:#5c4a00;border-radius:8px;">
      {#if data.gsc?.connected && !data.gsc?.siteUrl}
        Google is connected — pick a Search Console property for this brand so the plan can use owned queries.
        <a href={`/app/${brandSlug}/settings/search-console`} style="margin-left:6px;font-weight:600;">Choose property →</a>
      {:else}
        Connect and sync Google Search Console before generating a serious SEO plan — otherwise priorities come from estimates only.
        <a href={`/app/${brandSlug}/settings/search-console`} style="margin-left:6px;font-weight:600;">Connect Search Console →</a>
      {/if}
    </div>
  {/if}

  <section class="card" style="margin:0 0 16px;padding:16px;display:grid;gap:12px;">
    <div>
      <h3 style="margin:0 0 4px;">Owned search (GSC)</h3>
      {#if data.gsc?.connected && data.gsc?.siteUrl}
        <p class="muted" style="margin:0;font-size:13px;">{data.gsc.clicks28d} clicks · {data.gsc.impressions28d} impressions (28d)
          <a href={`/app/${brandSlug}/settings/search-console`}>manage</a></p>
      {:else if data.gsc?.connected}
        <p class="muted" style="margin:0;font-size:13px;">Google connected — pick a Search Console property
          <a href={`/app/${brandSlug}/settings/search-console`}>in Settings</a>.</p>
      {:else if data.gsc?.configured}
        <p class="muted" style="margin:0;font-size:13px;">Not connected —
          <a href={`/app/${brandSlug}/settings/search-console`}>Connect Search Console</a>
          for real clicks/queries (estimates below stay as fallback).</p>
      {:else}
        <p class="muted" style="margin:0;font-size:13px;">Search Console OAuth is not configured on this environment.</p>
      {/if}
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;">Technical crawl</h3>
        <form method="POST" action="?/crawlNow" use:enhance={withBusy}>
          <button type="submit" style="font-size:12px;" disabled={busy}>Crawl now</button>
        </form>
      </div>
      {#if data.crawl?.run}
        <p class="muted" style="margin:4px 0 0;font-size:13px;">
          {data.crawl.run.pages_crawled ?? 0} pages · avg score {(data.crawl.run.summary as any)?.avg_seo_score ?? '—'}
          · high issues {(data.crawl.run.summary as any)?.high_issues ?? 0}
        </p>
        {#if data.crawl.pages?.length}
          <ul style="margin:8px 0 0;padding-left:18px;font-size:12px;">
            {#each data.crawl.pages.slice(0, 5) as p (p.url)}
              <li>{p.title || p.url} — score {p.seo_score ?? '—'}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="muted" style="margin:4px 0 0;font-size:13px;">No crawl yet.</p>
      {/if}
    </div>
    {#if data.sitePages?.length}
      <div>
        <h3 style="margin:0 0 4px;">Hosted SEO pages</h3>
        <ul style="margin:0;padding-left:18px;font-size:12px;">
          {#each data.sitePages.slice(0, 8) as sp (sp.id)}
            <li>/p/{sp.slug} — {sp.status} · {sp.kind}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  {#if form?.sitePagePublished}
    <div class="ok" style="margin:0 0 12px;padding:10px 12px;background:#e8f8ef;border-radius:8px;font-size:13px;">
      Published
      {#if form.url}
        — <a href={form.url} target="_blank" rel="noopener">{form.url}</a>
      {:else}
        as <code>/p/{form.slug}</code>
      {/if}
      {#if form.targetQuery} · tracking “{form.targetQuery}”{/if}
    </div>
  {/if}

  {#if isEmpty}
    <div class="empty-geo">
      <img class="empty-geo-hero" src="/seo-geo-hero.webp" alt="" />
      <h2>{$_('app.studio.seo.emptyTitle')}</h2>
      <p>{$_('app.studio.seo.emptyDesc')}</p>
      <form method="POST" action="?/geoRunNow" use:enhance={withBusy}>
        <TopbarCta {busy} Icon={ScanSearch} class="empty-geo-btn">
          {busy ? $_('app.studio.seo.running') : $_('app.studio.seo.emptyCta')}
        </TopbarCta>
      </form>
    </div>
  {:else}
    <div class="geo-layout">
    <nav class="geo-index">
      <a href="#overview" class="index-link">{$_('app.studio.geo.nav.overview')}</a>
      <a href="#technical" class="index-link">{$_('app.studio.geo.nav.technical')}</a>
      <a href="#content" class="index-link">{$_('app.studio.geo.nav.content')}</a>
      {#if data.geo?.search || m?.traffic != null}<a href="#search" class="index-link">{$_('app.studio.geo.nav.search')}</a>{/if}
      {#if data.geo?.backlinks || m?.domainRating != null}<a href="#backlinks" class="index-link">{$_('app.studio.geo.nav.backlinks')}</a>{/if}
      <a href="#seo" class="index-link">{$_('app.studio.geo.nav.seo')}</a>
    </nav>

    <div class="geo-content">
      <!-- OVERVIEW -->
      <section id="overview" class="geo-section">
        <h3 class="section-title">{$_('app.studio.geo.nav.overview')}</h3>
        {#if data.geo || m}
          <div class="card gauges">
            {#if data.geo?.tech_score != null}{@render ring(data.geo.tech_score, $_('app.studio.geo.techScore'), '')}{/if}
            {#if m?.domainRating != null}{@render ring(m.domainRating, $_('app.studio.geo.domainRating'), '')}{/if}
          </div>
          {#if m && (m.traffic != null || m.organicKeywords != null || m.keywordsNew != null || m.referringDomains != null)}
            <div class="sp-stats overview-stats">
              {#if m.traffic != null}
                <div class="card sp-stat">
                  <div class="sp-num">{m.traffic.toLocaleString()}</div>
                  <div class="sp-lbl">{$_('app.studio.geo.searchTraffic')}</div>
                  {#if trafficSpark}
                    <svg class="spark" viewBox="0 0 120 36" width="120" height="36" aria-hidden="true">
                      <path d={trafficSpark} fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
                </div>
              {/if}
              {#if m.organicKeywords != null}
                <div class="card sp-stat">
                  <div class="sp-num">{m.organicKeywords.toLocaleString()}</div>
                  <div class="sp-lbl">{$_('app.studio.geo.searchOrganic')}</div>
                  {#if kwSpark}
                    <svg class="spark" viewBox="0 0 120 36" width="120" height="36" aria-hidden="true">
                      <path d={kwSpark} fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
                </div>
              {/if}
              {#if m.keywordsNew != null}
                <div class="card sp-stat">
                  <div class="sp-num">+{m.keywordsNew.toLocaleString()}</div>
                  <div class="sp-lbl">{$_('app.studio.geo.keywordsNew')}</div>
                </div>
              {/if}
              {#if m.referringDomains != null}
                <div class="card sp-stat">
                  <div class="sp-num">{m.referringDomains.toLocaleString()}</div>
                  <div class="sp-lbl">{$_('app.studio.geo.backlinksDomains')}</div>
                  {#if refSpark}
                    <svg class="spark" viewBox="0 0 120 36" width="120" height="36" aria-hidden="true">
                      <path d={refSpark} fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="card empty-state">
            <p class="muted">{$_('app.studio.geo.never')}</p>
          </div>
        {/if}
      </section>

      <!-- TECHNICAL CHECKS -->
      {#if data.geo?.tech}
        <section id="technical" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.nav.technical')}</h3>
          <div class="card checks">
            {#each CHECKS as id (id)}
              {@const issue = techById.get(id)}
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

      <!-- CONTENT QUALITY -->
      {#if contentChecks.length}
        <section id="content" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.nav.content')}</h3>
          <div class="card content-checks">
            {#each contentChecks as row (row.label)}
              <div class="cc-row">
                <div class="cc-main">
                  <span class="cc-label">{row.label}</span>
                  <span class="cc-value">{row.value}</span>
                </div>
                <span class="cc-badge {row.status}">{statusLabel[row.status]}</span>
                <div class="cc-detail muted small">{row.detail}</div>
                {#if row.raw}<div class="cc-raw muted small">{row.raw}</div>{/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- GOOGLE SEARCH PERFORMANCE (DataForSEO) -->
      {#if data.geo?.search || m?.search}
        {@const sp = data.geo?.search ?? m?.search}
        <section id="search" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.searchTitle')}</h3>
          <p class="section-desc">{$_('app.studio.geo.searchDesc')}</p>
          <div class="sp-stats sp-stats-4">
            <div class="card sp-stat"><div class="sp-num">{(sp?.organicKeywords ?? 0).toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.searchOrganic')}</div></div>
            <div class="card sp-stat"><div class="sp-num">{(sp?.estMonthlyTraffic ?? 0).toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.searchTraffic')}</div></div>
            <div class="card sp-stat"><div class="sp-num">{(sp?.keywordsTop10 ?? 0).toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.searchTop10')}</div></div>
            {#if m?.keywordsNew != null}
              <div class="card sp-stat">
                <div class="sp-num">+{m.keywordsNew.toLocaleString()}</div>
                <div class="sp-lbl">{$_('app.studio.geo.keywordsNew')}</div>
                {#if m.keywordsLost != null}
                  <div class="sp-sub muted small">−{m.keywordsLost.toLocaleString()} {$_('app.studio.geo.keywordsLost')}</div>
                {/if}
              </div>
            {/if}
          </div>

          {#if trafficSpark || kwSpark}
            <div class="trend-row">
              {#if trafficSpark}
                <div class="card trend-card">
                  <div class="trend-label">{$_('app.studio.geo.trafficHistory')}</div>
                  <svg class="spark lg" viewBox="0 0 120 36" width="100%" height="48" preserveAspectRatio="none" aria-hidden="true">
                    <path d={trafficSpark} fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
              {/if}
              {#if kwSpark}
                <div class="card trend-card">
                  <div class="trend-label">{$_('app.studio.geo.keywordsHistory')}</div>
                  <svg class="spark lg" viewBox="0 0 120 36" width="100%" height="48" preserveAspectRatio="none" aria-hidden="true">
                    <path d={kwSpark} fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
              {/if}
            </div>
          {/if}

          {#if m?.newTopKeywords?.length}
            <div class="sp-kw-title">{$_('app.studio.geo.newTopKeywords')}</div>
            <div class="new-kw-list">
              {#each m.newTopKeywords as k (k.keyword)}
                <span class="chip2">#{k.position || '—'} {k.keyword}</span>
              {/each}
            </div>
          {/if}

          {#if sp?.topKeywords?.length}
            <div class="sp-kw-title">{$_('app.studio.geo.searchTopKeywords')}</div>
            <div class="card sp-table-wrap">
              <table class="sp-table">
                <thead>
                  <tr>
                    <th>{$_('app.studio.geo.searchKeyword')}</th>
                    <th>{$_('app.studio.geo.searchIntent')}</th>
                    <th class="num">{$_('app.studio.geo.searchPosition')}</th>
                    <th class="num">{$_('app.studio.geo.searchVolume')}</th>
                    <th class="num">{$_('app.studio.geo.searchDifficulty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each sp.topKeywords as k (k.keyword)}
                    <tr>
                      <td class="sp-kw">{k.keyword}</td>
                      <td>{k.intent || '—'}</td>
                      <td class="num">{k.position || '—'}</td>
                      <td class="num">{k.volume.toLocaleString()}</td>
                      <td class="num">{k.difficulty || '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}

      <!-- BACKLINK PROFILE (DataForSEO Backlinks) -->
      {#if data.geo?.backlinks || m?.backlinkSummary}
        {@const bl = m?.backlinkSummary ?? data.geo?.backlinks}
        <section id="backlinks" class="geo-section">
          <h3 class="section-title">{$_('app.studio.geo.backlinksTitle')}</h3>
          <p class="section-desc">{$_('app.studio.geo.backlinksDesc')}</p>
          <div class="sp-stats sp-stats-4">
            <div class="card sp-stat"><div class="sp-num">{(bl?.referringDomains ?? 0).toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.backlinksDomains')}</div></div>
            <div class="card sp-stat"><div class="sp-num">{(bl?.backlinks ?? 0).toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.backlinksTotal')}</div></div>
            <div class="card sp-stat">
              <div class="sp-num">{m?.domainRating ?? bl?.rank ?? 0}</div>
              <div class="sp-lbl">{$_('app.studio.geo.domainRating')}</div>
              {#if rankSpark}
                <svg class="spark" viewBox="0 0 120 36" width="120" height="36" aria-hidden="true">
                  <path d={rankSpark} fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              {/if}
            </div>
            <div class="card sp-stat"><div class="sp-num">{bl?.spamScore ?? 0}%</div><div class="sp-lbl">{$_('app.studio.geo.backlinksSpam')}</div></div>
          </div>

          <div class="sp-stats">
            {#if bl?.dofollow != null}
              <div class="card sp-stat"><div class="sp-num">{bl.dofollow.toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.backlinksDofollow')}</div></div>
            {/if}
            {#if bl?.nofollow != null}
              <div class="card sp-stat"><div class="sp-num">{bl.nofollow.toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.backlinksNofollow')}</div></div>
            {/if}
            {#if bl?.referringPages != null}
              <div class="card sp-stat"><div class="sp-num">{bl.referringPages.toLocaleString()}</div><div class="sp-lbl">{$_('app.studio.geo.backlinksPages')}</div></div>
            {/if}
          </div>

          {#if rankSpark || refSpark}
            <div class="trend-row">
              {#if rankSpark}
                <div class="card trend-card">
                  <div class="trend-label">{$_('app.studio.geo.domainRatingHistory')}</div>
                  <svg class="spark lg" viewBox="0 0 120 36" width="100%" height="48" preserveAspectRatio="none" aria-hidden="true">
                    <path d={rankSpark} fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
              {/if}
              {#if refSpark}
                <div class="card trend-card">
                  <div class="trend-label">{$_('app.studio.geo.referringHistory')}</div>
                  <svg class="spark lg" viewBox="0 0 120 36" width="100%" height="48" preserveAspectRatio="none" aria-hidden="true">
                    <path d={refSpark} fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
              {/if}
            </div>
          {/if}

          {#if bl?.topTlds?.length}
            <div class="sp-kw-title">{$_('app.studio.geo.backlinksTlds')}</div>
            <div class="new-kw-list">
              {#each bl.topTlds as t (t.tld)}
                <span class="chip2">.{t.tld} · {t.count.toLocaleString()}</span>
              {/each}
            </div>
          {/if}

          {#if (bl?.brokenBacklinks ?? 0) > 0}
            <p class="muted small" style="margin-top:10px;">
              {$_('app.studio.geo.backlinksBroken', { values: { count: bl?.brokenBacklinks ?? 0 } })}
            </p>
          {/if}
        </section>
      {/if}

      <!-- SEO STRATEGY -->
      <section id="seo" class="geo-section">
        <h3 class="section-title">{$_('app.studio.geo.nav.seo')}</h3>
        <p class="muted small" style="margin-bottom:12px;">{$_('app.studio.geo.seo.desc')}</p>
        <form method="POST" action="?/seoPlanRun" use:enhance={withBusy} class="gen-form">
          {#if data.gsc?.configured && !data.gscReady && data.gscGate}
            <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:0 0 8px;max-width:420px;">
              <input type="checkbox" name="confirm_estimates" value="1" />
              <span>Continue with estimated traffic/keywords (no ready GSC data). Prefer connecting and syncing Search Console first.</span>
            </label>
          {/if}
          <button class="btn primary" type="submit" disabled={busy}>{busy ? $_('app.studio.geo.seo.running') : $_('app.studio.geo.seo.run')}</button>
        </form>

        {#if data.seoPlan}
          <div class="card seo-eval">
            {#if data.seoPlan.grade}<div class="seo-grade">{data.seoPlan.grade}</div>{/if}
            <div class="seo-eval-body">
              <p>{data.seoPlan.evaluation?.summary}</p>
              <div class="sw">
                {#if data.seoPlan.evaluation?.strengths?.length}
                  <div><b class="small">{$_('app.studio.geo.seo.strengths')}</b>
                    <ul>{#each data.seoPlan.evaluation.strengths as s}<li>{s}</li>{/each}</ul></div>
                {/if}
                {#if data.seoPlan.evaluation?.weaknesses?.length}
                  <div><b class="small">{$_('app.studio.geo.seo.weaknesses')}</b>
                    <ul>{#each data.seoPlan.evaluation.weaknesses as w}<li>{w}</li>{/each}</ul></div>
                {/if}
              </div>
              <!-- What the report could not determine. A stated gap is credible; the same report
                   without it reads as complete when it is not. -->
              {#if data.seoPlan.evaluation?.gaps?.length}
                <div class="seo-gaps">
                  <b class="small">{$_('app.studio.geo.seo.gaps')}</b>
                  <ul>{#each data.seoPlan.evaluation.gaps as g}<li>{g}</li>{/each}</ul>
                </div>
              {/if}
            </div>
          </div>

          <div class="seo-title">{$_('app.studio.geo.seo.initiatives')}</div>
          <div class="artifacts">
            {#each data.seoPlan.initiatives as init (init.id)}
              {@const asset = data.seoAssets?.[init.id]}
              <div class="card artifact">
                <div class="init-head">
                  <span class="chip2">{$_('app.studio.geo.seo.types.' + init.type)}</span>
                  <b>{init.title}</b>
                  <span class="badges">
                    <span class="badge">{$_('app.studio.geo.seo.impact')}: {$_('app.studio.geo.seo.levels.' + init.impact)}</span>
                    <span class="badge">{$_('app.studio.geo.seo.effort')}: {$_('app.studio.geo.seo.levels.' + init.effort)}</span>
                  </span>
                </div>
                <div class="muted small">{$_('app.studio.geo.seo.targetQuery')}: <b>{init.targetQuery}</b></div>
                <p class="small init-rationale">{init.rationale}</p>
                {#if init.examples?.length}
                  <ul class="ex">{#each init.examples as ex}<li>{ex}</li>{/each}</ul>
                {/if}

                <div class="init-cta">
                  {#if init.type === 'blog'}
                    <form method="POST" action="?/articleGenerate" use:enhance={withBusy} style="display:inline;">
                      <input type="hidden" name="initiativeId" value={init.id} />
                      <button class="btn ghost" type="submit" disabled={busy}>📝 {$_('app.studio.geo.seo.fullArticle')}</button>
                    </form>
                  {/if}
                  <button type="button" class="btn expert-btn" onclick={() => openExpert(init)}>🧑‍💻 {$_('app.studio.geo.seo.expert')}</button>
                </div>

                {#if asset}
                  {#if asset.target_path}<div class="block-label">{$_('app.studio.geo.pasteInto')} <code>{asset.target_path}</code></div>{/if}
                  {#each (asset.blocks ?? [{ labelKey: '', content: asset.body }]) as b, bi}
                    <div class="block">
                      {#if b.labelKey}<div class="block-label">{$_('app.studio.geo.blocks.' + b.labelKey)}</div>{/if}
                      <div class="ta-wrap">
                        <button class="copy-btn" type="button" onclick={() => copy(b.content, asset.id + '-' + bi)}>
                          {copiedKey === asset.id + '-' + bi ? $_('app.studio.geo.copied') : $_('app.studio.geo.copy')}
                        </button>
                        <textarea readonly rows="8">{b.content}</textarea>
                      </div>
                    </div>
                  {/each}
                  {#if ['landing_page', 'comparison', 'glossary', 'programmatic'].includes(init.type)}
                    <form method="POST" action="?/publishSitePage" use:enhance={withBusy} style="margin-top:8px;">
                      <input type="hidden" name="initiativeId" value={init.id} />
                      <input type="hidden" name="kind" value={init.type} />
                      <input type="hidden" name="targetQuery" value={init.targetQuery ?? ''} />
                      <button class="btn primary" type="submit" disabled={busy}>
                        Publish on Anomalia → /p/…
                      </button>
                    </form>
                  {/if}
                {:else}
                  <form method="POST" action="?/seoGenerateAsset" use:enhance={withBusy} style="margin-top:8px;">
                    <input type="hidden" name="initiativeId" value={init.id} />
                    <button class="btn ghost" type="submit" disabled={busy}>{$_('app.studio.geo.seo.generate')}</button>
                  </form>
                {/if}
              </div>
            {/each}
          </div>

          <form method="POST" action="?/seoMoreInitiatives" use:enhance={withBusy} class="more-form">
            <input type="text" name="guidance" placeholder={$_('app.studio.geo.seo.guidancePlaceholder')} disabled={busy} />
            <button class="btn ghost" type="submit" disabled={busy}>{$_('app.studio.geo.seo.more')}</button>
          </form>

          {#if data.articles?.length}
            <div class="seo-title">{$_('app.studio.geo.seo.articlesTitle')}</div>
            <div class="artifacts">
              {#each data.articles as a (a.id)}
                <div class="card artifact">
                  <div class="init-head"><b>{a.title}</b></div>
                  <!-- 'planned' placeholders carry their target keyword in meta_title (internal plumbing) — don't render it as a meta title. -->
                  {#if a.meta_title && a.status !== 'planned'}<div class="muted small">{a.meta_title}</div>{/if}
                  {#if a.meta_description}<p class="small init-rationale">{a.meta_description}</p>{/if}
                  <div class="init-cta">
                    <form method="POST" action="?/articleSetStatus" use:enhance={withBusy} style="display:inline;">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="publish" value={a.status === 'published' ? 'false' : 'true'} />
                      <button class="btn {a.status === 'published' ? 'ghost' : 'primary'}" type="submit" disabled={busy}>
                        {a.status === 'published' ? '🌐 ' + $_('app.studio.geo.seo.unpublish') : '🌐 ' + $_('app.studio.geo.seo.publish')}
                      </button>
                    </form>
                    <a class="btn ghost" href={`/app/${brandSlug}/site/edit/${a.id}`}>{$_('app.studio.geo.seo.download')}</a>
                    <form method="POST" action="?/articleDelete" use:enhance={withBusy} style="display:inline;">
                      <input type="hidden" name="id" value={a.id} />
                      <button class="btn ghost" type="submit" disabled={busy}>🗑 {$_('app.studio.geo.seo.deleteArticle')}</button>
                    </form>
                  </div>
                  {#if a.status === 'published'}<div class="muted small" style="margin-top:6px;">✓ {$_('app.studio.geo.seo.publishedOnSite')}</div>{/if}
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="card empty-state"><p class="muted">{$_('app.studio.geo.seo.never')}</p></div>
        {/if}

        <dialog bind:this={expertDialog} class="expert-dialog">
          {#if expertSent}
            <div class="expert-done">
              <p>✅ {$_('app.studio.geo.seo.sent')}</p>
              <button type="button" class="btn primary" onclick={() => expertDialog?.close()}>OK</button>
            </div>
          {:else}
            <form method="POST" action="?/requestExpert" use:enhance={expertEnhance}>
              <h3>{$_('app.studio.geo.seo.expertTitle')}</h3>
              <p class="muted small">{$_('app.studio.geo.seo.expertDesc')}</p>
              {#if activeInit}<p class="expert-init"><b>{activeInit.title}</b></p>{/if}
              <input type="hidden" name="initiativeId" value={activeInit?.id ?? ''} />
              <input type="hidden" name="initiativeTitle" value={activeInit?.title ?? ''} />
              <input type="hidden" name="initiativeType" value={activeInit?.type ?? ''} />
              <label>{$_('app.studio.geo.seo.fullName')}<input name="full_name" required autocomplete="name" /></label>
              <label>{$_('app.studio.geo.seo.emailLabel')}<input name="email" type="email" required autocomplete="email" /></label>
              <label>{$_('app.studio.geo.seo.phone')}<input name="phone" type="tel" required autocomplete="tel" /></label>
              {#if form?.error === 'invalid'}<p class="err-inline">{$_('app.studio.geo.seo.invalid')}</p>{/if}
              <div class="expert-actions">
                <button type="button" class="btn ghost" onclick={() => expertDialog?.close()}>{$_('app.studio.geo.seo.cancel')}</button>
                <button type="submit" class="btn primary" disabled={busy}>{$_('app.studio.geo.seo.send')}</button>
              </div>
            </form>
          {/if}
        </dialog>
      </section>
    </div>
  </div>
  {/if}
</div>

<style>
  .content { max-width: var(--content-max, 960px); margin: 0 auto; padding: 0; }
  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
  .page-head h2 { margin: 0 0 4px; }
  .muted { color: var(--ink-faint); font-size: 13px; margin: 0; }
  .small { font-size: 12px; }
  .err { background: #fde; color: #a00; border-radius: 12px; padding: 10px 14px; font-size: 13px; margin-bottom: 4px; }

  /* empty state when no audit exists */
  .empty-geo {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 24px; max-width: 480px; margin: 40px auto 0;
  }
  .empty-geo-hero { width: 100%; max-width: 560px; border-radius: 14px; margin: 0 auto 20px; display: block; }
  .empty-geo-icon {
    width: 80px; height: 80px; border-radius: 50%; background: var(--paper-2);
    display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
    color: var(--accent, #7c5cff);
  }
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

  .card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px; }

  .btn { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer; border: 1px solid transparent; line-height: 1; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }
  .btn.link { background: transparent; border: none; color: var(--ink-faint); padding: 4px 6px; font-weight: 500; }

  /* rings */
  .gauges { display: flex; gap: 48px; flex-wrap: wrap; justify-content: center; }
  /* NB: not ".ring" — that collides with Tailwind's .ring utility, which forces a 1px
     box-shadow ring (!important) and drew a stray rectangle around each gauge. */
  .gauge { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .gauge-label { font-size: 12px; color: var(--ink-faint); font-weight: 600; }

  /* checks */
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 24px; }
  .check { display: flex; gap: 12px; align-items: flex-start; }
  .check .tick { width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; display: grid; place-items: center;
    font-size: 13px; font-weight: 700; background: #dff5e1; color: #137a2b; }
  .check.bad .tick { background: #fde; color: #c0392b; }
  .check-label { font-size: 13.5px; font-weight: 600; color: var(--ink); }

  /* content quality rows */
  .content-checks { display: flex; flex-direction: column; }
  .cc-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center;
    padding: 14px 0; border-top: 1px solid var(--line); }
  .cc-row:first-child { border-top: none; padding-top: 0; }
  .cc-main { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .cc-label { font-size: 13.5px; font-weight: 600; color: var(--ink); flex: 0 0 auto; }
  .cc-value { font-size: 13px; color: var(--ink-soft); }
  .cc-badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .cc-badge.good { background: #dff5e1; color: #137a2b; }
  .cc-badge.warn { background: #fef3d0; color: #96690a; }
  .cc-badge.bad { background: #fde; color: #c0392b; }
  .cc-detail { grid-column: 1 / -1; margin-top: 2px; }
  .cc-raw { grid-column: 1 / -1; margin-top: 4px; font-style: italic; max-width: 100%; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }

  .chip2 { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; padding: 2px 9px;
    border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); align-self: flex-start; }

  /* search performance (DataForSEO) */
  .sp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
  .sp-stats-4 { grid-template-columns: repeat(4, 1fr); }
  .overview-stats { margin-top: 20px; grid-template-columns: repeat(4, 1fr); }
  .sp-stat { text-align: center; padding: 20px 16px; display: flex; flex-direction: column; align-items: center; }
  .sp-num { font-size: 30px; font-weight: 800; color: var(--ink); line-height: 1.1; letter-spacing: -0.02em; }
  .sp-lbl { font-size: 12px; color: var(--ink-faint); font-weight: 600; margin-top: 6px; }
  .sp-sub { margin-top: 4px; }
  .sp-kw-title { font-weight: 700; font-size: 13px; margin: 4px 0 12px; color: var(--ink); }
  .sp-table-wrap { padding: 0; overflow-x: auto; }
  .sp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .sp-table th, .sp-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .sp-table th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); }
  .sp-table tbody tr:last-child td { border-bottom: none; }
  .sp-table .num { text-align: right; }
  .sp-kw { color: var(--ink); font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  td.num { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
  .spark { margin-top: 10px; opacity: 0.85; }
  .spark.lg { margin-top: 8px; height: 48px; }
  .trend-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .trend-card { padding: 16px 18px; }
  .trend-label { font-size: 12px; font-weight: 700; color: var(--ink-faint); margin-bottom: 4px; }
  .new-kw-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }

  /* SEO initiative / article cards */
  .gen-form { margin-bottom: 8px; }
  .artifacts { display: flex; flex-direction: column; gap: 16px; }
  .artifact { border-color: var(--line); }

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

  /* SEO strategy */
  .seo-eval { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
  .seo-grade { flex: 0 0 auto; font-size: 34px; font-weight: 800; line-height: 1; color: var(--accent, #7c5cff); border: 3px solid var(--accent, #7c5cff); border-radius: 14px; padding: 12px 16px; }
  .seo-gaps { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--line); }
  .seo-gaps ul { margin: 4px 0 0; padding-left: 18px; }
  .seo-gaps li { color: var(--ink-faint); }
  .seo-eval-body { flex: 1; }
  .seo-eval-body p { margin: 0 0 10px; font-size: 14px; color: var(--ink); }
  .sw { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .sw ul { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--ink-soft); display: flex; flex-direction: column; gap: 2px; }
  .seo-title { font-weight: 700; font-size: 13px; margin: 4px 0 12px; color: var(--ink); }
  .init-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .init-head b { font-size: 14px; color: var(--ink); }
  .badges { margin-left: auto; display: flex; gap: 6px; }
  .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); white-space: nowrap; }
  .init-rationale { color: var(--ink-soft); margin: 4px 0; }
  .ex { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--ink-faint); }
  .more-form { display: flex; gap: 8px; margin-top: 14px; }
  .more-form input { flex: 1; font-size: 13px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); }

  .init-cta { margin-top: 10px; }
  .expert-btn { background: transparent; border: 1px solid var(--accent, #7c5cff); color: var(--accent, #7c5cff); }
  .expert-btn:hover { background: color-mix(in srgb, var(--accent, #7c5cff) 10%, transparent); }

  .expert-dialog { border: none; border-radius: 16px; padding: 24px; width: min(420px, 92vw); background: var(--paper); color: var(--ink); box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .expert-dialog::backdrop { background: rgba(0,0,0,0.45); }
  .expert-dialog h3 { margin: 0 0 4px; font-size: 18px; }
  .expert-dialog form { display: flex; flex-direction: column; gap: 10px; }
  .expert-init { margin: 4px 0; font-size: 13px; color: var(--ink-soft); }
  .expert-dialog label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink-faint); }
  .expert-dialog input { font-size: 14px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); }
  .expert-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .expert-done { text-align: center; display: flex; flex-direction: column; gap: 14px; align-items: center; }
  .err-inline { color: #c0392b; font-size: 12px; margin: 0; }

  @container workbench (max-width: 760px) {
    .geo-layout { flex-direction: column; gap: 24px; }
    .geo-index { position: static; flex: none; flex-direction: row; flex-wrap: wrap; gap: 8px; }
    .index-link { font-size: 13px; padding: 6px 10px; }
    .checks { grid-template-columns: 1fr; padding: 18px; }
    .sp-stats, .sp-stats-4, .overview-stats, .trend-row { grid-template-columns: 1fr; }
  }
</style>
