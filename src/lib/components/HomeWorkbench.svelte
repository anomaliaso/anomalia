<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { HomeOverview } from '$lib/server/hub-overview';
  import { openChatComposer } from '$lib/stores/chat';
  import { closePageModal } from '$lib/components/PageModal.svelte';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';
  import GrowthReadiness from '$lib/components/GrowthReadiness.svelte';
  import MediaReviewStatsPanel from '$lib/components/MediaReviewStatsPanel.svelte';
  import { fmtCompactNum } from '$lib/fmt-num';

  type Extras = {
    pendingCount?: number;
    leadsPendingCount?: number;
    radarReviewCount?: number;
    socialAccountCount?: number;
    studioPct?: number;
    strategySetup?: { gtm?: boolean; plan?: boolean };
    radarEnabled?: boolean;
    hasGeoAudit?: boolean;
    gscConnected?: boolean;
  };

  let {
    brandSlug,
    extras = null,
    overview,
    launchedAt = null,
    onboardingCompleted = true
  }: {
    brandSlug: string;
    extras?: Extras | null;
    overview: HomeOverview;
    launchedAt?: string | null;
    onboardingCompleted?: boolean;
  } = $props();

  const showContinueBanner = $derived(!onboardingCompleted);
  const base = $derived(`/app/${brandSlug}`);

  /** Setup continues in chat — the assistant owns the remaining onboarding steps. */
  function continueSetupInChat() {
    openChatComposer({
      brandSlug,
      prefill: $_('app.home.continueOnboarding.chatPrefill')
    });
    // Il workbench vive nella modal: il composer sta sotto il backdrop, quindi prima si
    // chiude, poi si scorre. Fuori dalla modal `closePageModal` è un no-op.
    closePageModal();
    if (typeof document === 'undefined') return;
    document
      .querySelector('.overview-composer')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Merge deferred extras into setup flags when they arrive.
  const setup = $derived({
    studioPct: extras?.studioPct ?? overview.setup.studioPct,
    hasStrategy: extras?.strategySetup?.gtm ?? overview.setup.hasStrategy,
    hasEditorialPlan: extras?.strategySetup?.plan ?? overview.setup.hasEditorialPlan,
    blogEnabled: overview.setup.blogEnabled,
    radarEnabled: extras?.radarEnabled ?? overview.setup.radarEnabled,
    hasGeoAudit: extras?.hasGeoAudit ?? overview.setup.hasGeoAudit,
    gscConnected: extras?.gscConnected ?? overview.setup.gscConnected ?? true,
    socialAccounts: extras?.socialAccountCount ?? overview.setup.socialAccounts
  });

  const setupSteps = $derived([
    { key: 'studio', done: setup.studioPct >= 80, href: `${base}/settings/brand` },
    { key: 'strategy', done: setup.hasStrategy, href: `${base}/gtm` },
    { key: 'plan', done: setup.hasEditorialPlan, href: `${base}/plan` },
    { key: 'social', done: setup.socialAccounts > 0, href: `${base}/settings/connected-accounts` },
    { key: 'blog', done: setup.blogEnabled, href: `${base}/site` },
    { key: 'radar', done: setup.radarEnabled, href: `${base}/radar` },
    { key: 'seo', done: setup.hasGeoAudit, href: `${base}/seo` },
    { key: 'gsc', done: setup.gscConnected, href: `${base}/settings/search-console` }
  ]);

  const doneCount = $derived(setupSteps.filter((s) => s.done).length);
  const setupPct = $derived(setupSteps.length ? (doneCount / setupSteps.length) * 100 : 0);
  const allSetupDone = $derived(doneCount === setupSteps.length);

  const dismissKey = $derived(`home-setup-dismissed-${brandSlug}`);
  let setupDismissed = $state(false);
  let setupOpen = $state(true);

  // Re-read prefs when brandSlug changes (component may be reused across project switches).
  // Only sync FROM localStorage — writing setupDismissed/setupOpen while also reading them
  // in the same effect is a classic effect_update_depth_exceeded footgun.
  $effect(() => {
    const dismissed = `home-setup-dismissed-${brandSlug}`;
    const collapsedKey = `home-setup-collapsed-${brandSlug}`;
    if (typeof localStorage === 'undefined') {
      setupDismissed = false;
      setupOpen = true;
      return;
    }
    try {
      setupDismissed = localStorage.getItem(dismissed) === '1';
      const collapsed = localStorage.getItem(collapsedKey);
      setupOpen = collapsed !== '1';
    } catch {
      setupDismissed = false;
      setupOpen = true;
    }
  });

  function toggleSetup() {
    setupOpen = !setupOpen;
    try {
      localStorage.setItem(`home-setup-collapsed-${brandSlug}`, setupOpen ? '0' : '1');
    } catch {
      /* ignore */
    }
  }

  function dismissSetup() {
    setupDismissed = true;
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      /* ignore */
    }
  }

  const showSetup = $derived(!allSetupDone && !setupDismissed);

  function captionPreview(text: string | null, n = 80) {
    if (!text) return '';
    const t = text.trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }

  const pendingPosts = $derived(overview.queue.posts);
  const pendingPostCount = $derived(
    Math.max(overview.queue.pending, extras?.pendingCount ?? 0, pendingPosts.length)
  );
  const pendingBlogs = $derived(overview.blog.articles);
  const pendingBlogCount = $derived(Math.max(overview.blog.pending, pendingBlogs.length));
  const scheduledPostCount = $derived(overview.queue.scheduled);
  const scheduledBlogCount = $derived(overview.blog.scheduled);
  const upcomingPosts = $derived(overview.queue.upcoming ?? []);
  const upcomingBlogs = $derived(overview.blog.upcoming ?? []);
  const auto = $derived(
    overview.automations ?? {
      radarEnabled: false,
      radarReview: 0,
      radarRecent: 0,
      leadsPending: 0,
      leadsTotal: 0
    }
  );

  const reviewTotal = $derived(pendingPostCount + pendingBlogCount);
  const controlOk = $derived(reviewTotal === 0);

  type ReviewItem = {
    key: string;
    kind: 'social' | 'blog';
    id: string;
    href: string;
    title: string;
    meta: string;
    media: string | null;
    placeholder: string;
  };

  const REVIEW_PREVIEW = 5;
  const REVIEW_PAGE_SIZE = 5;

  const reviewItems = $derived.by((): ReviewItem[] => {
    const social: ReviewItem[] = pendingPosts.map((post) => ({
      key: `social-${post.id}`,
      kind: 'social',
      id: post.id,
      href: `${base}/calendar?status=pending_user`,
      title: captionPreview(post.caption, 90) || '—',
      meta: post.platform ?? 'social',
      media: post.media_url,
      placeholder: (post.platform ?? '?').slice(0, 2).toUpperCase()
    }));
    const blogs: ReviewItem[] = pendingBlogs.map((art) => ({
      key: `blog-${art.id}`,
      kind: 'blog',
      id: art.id,
      href: `${base}/site/edit/${art.id}`,
      title: captionPreview(art.title, 90) || '—',
      meta: art.status,
      media: art.cover_url,
      placeholder: 'B'
    }));
    return [...social, ...blogs];
  });

  const loadedReviewCount = $derived(reviewItems.length);
  const reviewTruncated = $derived(reviewTotal > loadedReviewCount);

  let reviewExpanded = $state(false);
  let reviewPage = $state(0);

  const reviewPageCount = $derived(
    Math.max(1, Math.ceil(loadedReviewCount / REVIEW_PAGE_SIZE))
  );
  const visibleReviewItems = $derived.by(() => {
    if (!reviewExpanded) return reviewItems.slice(0, REVIEW_PREVIEW);
    const start = reviewPage * REVIEW_PAGE_SIZE;
    return reviewItems.slice(start, start + REVIEW_PAGE_SIZE);
  });
  const canExpandReview = $derived(loadedReviewCount > REVIEW_PREVIEW || reviewTruncated);

  $effect(() => {
    if (reviewPage > reviewPageCount - 1) reviewPage = Math.max(0, reviewPageCount - 1);
  });

  function expandReview() {
    reviewExpanded = true;
    reviewPage = 0;
  }
  function collapseReview() {
    reviewExpanded = false;
    reviewPage = 0;
  }

  function gradeToScore(grade: string | null): number | null {
    if (!grade) return null;
    const g = grade.trim().toUpperCase();
    const map: Record<string, number> = {
      'A+': 97,
      A: 92,
      'A-': 88,
      'B+': 84,
      B: 78,
      'B-': 72,
      'C+': 68,
      C: 62,
      'C-': 55,
      D: 45,
      F: 25
    };
    return map[g] ?? null;
  }

  const seoGauge = $derived(
    overview.web.techScore != null
      ? Math.max(0, Math.min(100, overview.web.techScore))
      : (gradeToScore(overview.web.seoGrade) ?? 0)
  );
  const seoGaugeLabel = $derived(
    overview.web.techScore != null
      ? String(Math.round(overview.web.techScore))
      : (overview.web.seoGrade ?? '—')
  );
  const geoGauge = $derived(
    overview.web.citationsTotal > 0
      ? Math.round((overview.web.citationsMentioned / overview.web.citationsTotal) * 100)
      : (overview.web.shareOfVoice ?? 0)
  );
  const geoGaugeLabel = $derived(
    overview.web.citationsTotal > 0
      ? `${overview.web.citationsMentioned}/${overview.web.citationsTotal}`
      : overview.web.shareOfVoice != null
        ? `${overview.web.shareOfVoice}%`
        : '—'
  );

  const socialPipeMax = $derived(
    Math.max(1, pendingPostCount, scheduledPostCount, overview.analysis.published)
  );
  const blogPipeMax = $derived(
    Math.max(1, pendingBlogCount, scheduledBlogCount, overview.blog.published)
  );

  const viewsByDay = $derived(
    overview.analysis.viewsByDay?.length === 7
      ? overview.analysis.viewsByDay
      : [0, 0, 0, 0, 0, 0, 0]
  );
  const likesByDay = $derived(
    overview.analysis.likesByDay?.length === 7
      ? overview.analysis.likesByDay
      : [0, 0, 0, 0, 0, 0, 0]
  );
  const maxLikesDay = $derived(Math.max(1, ...likesByDay));
  const maxViewsDay = $derived(Math.max(1, ...viewsByDay));

  const sparkPath = $derived.by(() => {
    const w = 280;
    const h = 64;
    const pad = 4;
    const vals = viewsByDay;
    const max = Math.max(1, ...vals);
    const step = (w - pad * 2) / Math.max(1, vals.length - 1);
    return vals
      .map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - (v / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const sparkArea = $derived.by(() => {
    const w = 280;
    const h = 64;
    const pad = 4;
    const vals = viewsByDay;
    const max = Math.max(1, ...vals);
    const step = (w - pad * 2) / Math.max(1, vals.length - 1);
    const line = vals
      .map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - (v / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return `${line} L${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} L${pad},${(h - pad).toFixed(1)} Z`;
  });

  const kwBarPct = $derived(
    overview.web.keywordsTotal > 0
      ? Math.round((overview.web.keywordsHigh / overview.web.keywordsTotal) * 100)
      : 0
  );

  function askAiAboutBlogs() {
    openChatComposer({
      brandSlug,
      agent: 'web',
      prefill: $_('app.home.overview.blogsAiPrompt', { values: { n: pendingBlogCount } })
    });
  }
  function askAiAboutPosts() {
    openChatComposer({
      brandSlug,
      agent: 'publish',
      prefill: $_('app.home.overview.postsAiPrompt', { values: { n: pendingPostCount } })
    });
  }

  function formatWhen(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }
</script>

<div class="home-wb">
  {#if showContinueBanner}
    <button type="button" class="ob-banner" onclick={continueSetupInChat}>
      <div class="ob-banner-copy">
        <span class="ob-banner-kicker">{$_('app.home.continueOnboarding.kicker')}</span>
        <strong class="ob-banner-title">{$_('app.home.continueOnboarding.title')}</strong>
        <span class="ob-banner-msg">{$_('app.home.continueOnboarding.msg')}</span>
      </div>
      <span class="ob-banner-cta">{$_('app.home.continueOnboarding.cta')}</span>
    </button>
  {/if}

  {#if showSetup}
    <section class="setup-box">
      <button type="button" class="setup-head" onclick={toggleSetup} aria-expanded={setupOpen}>
        <div class="setup-head-text">
          <span class="setup-title">{$_('app.home.setup.title')}</span>
          <span class="setup-progress"
            >{$_('app.home.setup.progress', { values: { done: doneCount, tot: setupSteps.length } })}</span
          >
        </div>
        <div class="setup-bar" aria-hidden="true"><span style={`width:${setupPct}%`}></span></div>
        <span class="setup-chevron" class:open={setupOpen} aria-hidden="true">▾</span>
      </button>

      {#if setupOpen}
        <ul class="setup-list">
          {#each setupSteps as step (step.key)}
            <li class:done={step.done}>
              <span class="setup-check">
                {#if step.done}
                  <svg viewBox="0 0 20 20" fill="currentColor"
                    ><path
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    /></svg
                  >
                {/if}
              </span>
              {#if step.done}
                <span class="setup-label done">{$_(`app.home.setup.items.${step.key}`)}</span>
              {:else}
                <a class="setup-label" href={step.href}>{$_(`app.home.setup.items.${step.key}`)}</a>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="setup-footer">
          <button type="button" class="setup-dismiss" onclick={dismissSetup}
            >{$_('app.home.setup.dismiss')}</button
          >
        </div>
      {/if}
    </section>
  {/if}

  {#if !overview.paid}
    <div class="upgrade-banner">
      <p>{$_('app.home.upgrade.banner')}</p>
      <a href={`${base}/activate?plan=starter`}>{$_('app.home.upgrade.cta')}</a>
    </div>
  {/if}

  {#if overview.growth?.checks?.length}
    <GrowthReadiness checks={overview.growth.checks} compact={overview.growth.ready} />
  {/if}

  <!-- Command center: status + gauges -->
  <section class="control-hero" class:ok={controlOk}>
    <div class="control-copy">
      <span class="ov-kicker">{$_('app.home.overview.sectionAttention')}</span>
      <h2 class="control-title">
        {#if controlOk}
          {$_('app.home.overview.controlOk')}
        {:else}
          {$_('app.home.overview.controlNeedsReview', { values: { n: reviewTotal } })}
        {/if}
      </h2>
      <p class="control-desc">
        {#if controlOk}
          {$_('app.home.overview.controlOkDesc')}
        {:else}
          {$_('app.home.overview.controlNeedsDesc')}
        {/if}
      </p>
    </div>
    <div class="gauge-row">
      <div class="gauge">
        <div class="gauge-ring" style={`--v:${Math.round(setupPct)}`} aria-hidden="true">
          <span><AnimatedNum value={Math.round(setupPct)} format={(n) => String(Math.round(n))} /></span>
        </div>
        <span class="gauge-label">{$_('app.home.overview.setupGauge')}</span>
      </div>
      <a class="gauge" href={`${base}/seo`}>
        <div class="gauge-ring" style={`--v:${Math.round(seoGauge)}`} aria-hidden="true">
          <span>
            {#if overview.web.techScore != null}
              <AnimatedNum value={Math.round(overview.web.techScore)} format={(n) => String(Math.round(n))} />
            {:else}
              {seoGaugeLabel}
            {/if}
          </span>
        </div>
        <span class="gauge-label">{$_('app.home.overview.seoGauge')}</span>
      </a>
      <a class="gauge" href={`${base}/geo`}>
        <div class="gauge-ring" style={`--v:${Math.round(geoGauge)}`} aria-hidden="true">
          <span>
            {#if overview.web.citationsTotal > 0}
              <AnimatedNum value={overview.web.citationsMentioned} format={(n) => String(Math.round(n))} />/{overview.web.citationsTotal}
            {:else if overview.web.shareOfVoice != null}
              <AnimatedNum value={overview.web.shareOfVoice} format={(n) => String(Math.round(n))} suffix="%" />
            {:else}
              {geoGaugeLabel}
            {/if}
          </span>
        </div>
        <span class="gauge-label">{$_('app.home.overview.geoGauge')}</span>
      </a>
    </div>

    {#if reviewTotal > 0}
      <div class="review-queue">
        <div class="review-queue-head">
          <div class="review-queue-copy">
            <span class="review-queue-title">{$_('app.home.overview.toReview')}</span>
            <span class="review-queue-meta">
              {#if pendingPostCount > 0}
                {$_('app.home.overview.postsToAccept', { values: { n: pendingPostCount } })}
              {/if}
              {#if pendingPostCount > 0 && pendingBlogCount > 0}
                <span aria-hidden="true"> · </span>
              {/if}
              {#if pendingBlogCount > 0}
                {$_('app.home.overview.blogsToAccept', { values: { n: pendingBlogCount } })}
              {/if}
            </span>
          </div>
          <div class="ov-panel-actions">
            {#if pendingPostCount > 0}
              <button type="button" class="ov-ai" onclick={askAiAboutPosts}
                >{$_('app.home.overview.postsAiCta')}</button
              >
            {/if}
            {#if pendingBlogCount > 0}
              <button type="button" class="ov-ai ov-ai-strong" onclick={askAiAboutBlogs}
                >{$_('app.home.overview.blogsAiCta')}</button
              >
            {/if}
          </div>
        </div>

        <ul class="review-list">
          {#each visibleReviewItems as item (item.key)}
            <li>
              <a href={item.href}>
                <span class="up-thumb">
                  {#if item.media}
                    <img src={item.media} alt="" loading="lazy" />
                  {:else}
                    <span class="up-ph">{item.placeholder}</span>
                  {/if}
                </span>
                <span class="up-body">
                  <span class="up-meta">
                    <span class="ov-kind"
                      >{item.kind === 'social'
                        ? $_('app.home.overview.kindSocial')
                        : $_('app.home.overview.kindBlog')}</span
                    >
                    {item.meta}
                  </span>
                  <span class="up-title">{item.title}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>

        <div class="review-queue-foot">
          {#if !reviewExpanded && canExpandReview}
            <button type="button" class="ov-link review-toggle" onclick={expandReview}>
              {$_('app.home.overview.showAllReview', { values: { n: reviewTotal } })} →
            </button>
          {:else if reviewExpanded}
            <div class="review-pager">
              <button
                type="button"
                class="ov-ai"
                disabled={reviewPage <= 0}
                onclick={() => (reviewPage = Math.max(0, reviewPage - 1))}
              >
                {$_('app.home.overview.prev')}
              </button>
              <span class="review-page-label"
                >{$_('app.home.overview.pageOf', {
                  values: { page: reviewPage + 1, pages: reviewPageCount }
                })}</span
              >
              <button
                type="button"
                class="ov-ai"
                disabled={reviewPage >= reviewPageCount - 1}
                onclick={() => (reviewPage = Math.min(reviewPageCount - 1, reviewPage + 1))}
              >
                {$_('app.home.overview.next')}
              </button>
            </div>
            <button type="button" class="ov-link review-toggle" onclick={collapseReview}>
              {$_('app.home.overview.showLessReview')}
            </button>
            {#if reviewTruncated}
              <a class="ov-link" href={`${base}/calendar?status=pending_user`}
                >{$_('app.home.overview.seeAll')} →</a
              >
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <!-- Pipeline -->
  <section class="ov-section">
    <div class="ov-section-head">
      <div class="ov-section-copy">
        <span class="ov-kicker">{$_('app.home.overview.sectionSchedule')}</span>
        <h3>{$_('app.home.overview.pipelineTitle')}</h3>
        <p class="ov-section-desc">{$_('app.home.overview.pipelineDesc')}</p>
      </div>
    </div>
    <div class="pipe-grid">
      <a class="pipe-card" href={`${base}/calendar`}>
        <span class="pipe-kind">{$_('app.home.overview.kindSocial')}</span>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelinePending')}</span>
          <span class="pipe-n"><AnimatedNum value={pendingPostCount} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill warn" style={`width:${(pendingPostCount / socialPipeMax) * 100}%`}></span></div>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelineScheduled')}</span>
          <span class="pipe-n"><AnimatedNum value={scheduledPostCount} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill" style={`width:${(scheduledPostCount / socialPipeMax) * 100}%`}></span></div>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelinePublished')}</span>
          <span class="pipe-n"><AnimatedNum value={overview.analysis.published} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill ok" style={`width:${(overview.analysis.published / socialPipeMax) * 100}%`}></span></div>
      </a>
      <a class="pipe-card" href={`${base}/site`}>
        <span class="pipe-kind">{$_('app.home.overview.kindBlog')}</span>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelinePending')}</span>
          <span class="pipe-n"><AnimatedNum value={pendingBlogCount} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill warn" style={`width:${(pendingBlogCount / blogPipeMax) * 100}%`}></span></div>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelineScheduled')}</span>
          <span class="pipe-n"><AnimatedNum value={scheduledBlogCount} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill" style={`width:${(scheduledBlogCount / blogPipeMax) * 100}%`}></span></div>
        <div class="pipe-row">
          <span class="pipe-l">{$_('app.home.overview.pipelinePublished')}</span>
          <span class="pipe-n"><AnimatedNum value={overview.blog.published} /></span>
        </div>
        <div class="pipe-track"><span class="pipe-fill ok" style={`width:${(overview.blog.published / blogPipeMax) * 100}%`}></span></div>
      </a>
    </div>
  </section>

  <!-- Coming up -->
  <section class="ov-section">
    <div class="ov-section-head">
      <div class="ov-section-copy">
        <span class="ov-kicker">{$_('app.home.overview.sectionSchedule')}</span>
        <h3>{$_('app.home.overview.comingUp')}</h3>
        <p class="ov-section-desc">{$_('app.home.overview.comingUpDesc')}</p>
      </div>
      <a class="ov-link" href={`${base}/calendar`}>{$_('app.home.overview.openCalendar')} →</a>
    </div>

    {#if upcomingPosts.length === 0 && upcomingBlogs.length === 0}
      <p class="ov-empty quiet">{$_('app.home.overview.nothingScheduled')}</p>
    {:else}
      {#if upcomingPosts.length > 0}
        <div class="ov-panel compact">
          <div class="ov-panel-head">
            <div class="ov-panel-title-wrap">
              <span class="ov-kind">{$_('app.home.overview.kindSocial')}</span>
              <span class="ov-panel-title">{$_('app.home.overview.nextSocial')}</span>
            </div>
            <a class="ov-link" href={`${base}/calendar`}>{$_('app.home.overview.seeAll')} →</a>
          </div>
          <ul class="upcoming-list">
            {#each upcomingPosts as post (post.id)}
              <li>
                <a href={`${base}/calendar?status=scheduled`}>
                  <span class="up-thumb">
                    {#if post.media_url}
                      <img src={post.media_url} alt="" loading="lazy" />
                    {:else}
                      <span class="up-ph">{(post.platform ?? '?').slice(0, 2).toUpperCase()}</span>
                    {/if}
                  </span>
                  <span class="up-body">
                    <span class="up-meta"
                      >{post.platform ?? 'social'} · {formatWhen(post.scheduled_for)}</span
                    >
                    <span class="up-title">{captionPreview(post.caption, 90) || '—'}</span>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if upcomingBlogs.length > 0}
        <div class="ov-panel compact">
          <div class="ov-panel-head">
            <div class="ov-panel-title-wrap">
              <span class="ov-kind">{$_('app.home.overview.kindBlog')}</span>
              <span class="ov-panel-title">{$_('app.home.overview.nextBlogs')}</span>
            </div>
            <a class="ov-link" href={`${base}/site`}>{$_('app.home.overview.seeAll')} →</a>
          </div>
          <ul class="upcoming-list">
            {#each upcomingBlogs as art (art.id)}
              <li>
                <a href={`${base}/site/edit/${art.id}`}>
                  <span class="up-thumb">
                    {#if art.cover_url}
                      <img src={art.cover_url} alt="" loading="lazy" />
                    {:else}
                      <span class="up-ph">B</span>
                    {/if}
                  </span>
                  <span class="up-body">
                    <span class="up-meta">{formatWhen(art.scheduled_for)}</span>
                    <span class="up-title">{art.title || '—'}</span>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Web / SEO -->
  <section class="ov-section">
    <div class="ov-section-head">
      <div class="ov-section-copy">
        <span class="ov-kicker">{$_('app.home.overview.sectionWeb')}</span>
        <h3>{$_('app.home.overview.webTitle')}</h3>
        <p class="ov-section-desc">{$_('app.home.overview.webDesc')}</p>
      </div>
      <a class="ov-link" href={`${base}/web`}>{$_('app.home.overview.openWeb')} →</a>
    </div>
    <div class="metric-grid metric-grid-wide">
      <a class="metric-card has-viz" href={`${base}/seo`}>
        <div class="metric-top">
          <div class="mini-ring" style={`--v:${Math.round(seoGauge)}`} aria-hidden="true">
            <span>{seoGaugeLabel}</span>
          </div>
          <div class="metric-text">
            <span class="metric-l">{$_('app.home.overview.seo')}</span>
            {#if overview.web.seoGrade && overview.web.techScore != null}
              <span class="metric-sub">{$_('app.home.overview.grade')}: {overview.web.seoGrade}</span>
            {/if}
          </div>
        </div>
      </a>
      <a
        class="metric-card has-viz"
        class:accent={overview.web.keywordsHigh > 0}
        href={`${base}/keywords`}
      >
        <span class="metric-n">
          {#if overview.web.keywordsTotal > 0}
            <AnimatedNum value={overview.web.keywordsTotal} />
          {:else}
            —
          {/if}
        </span>
        <span class="metric-l">{$_('app.home.overview.keywords')}</span>
        <div class="mini-bar" aria-hidden="true">
          <span style={`width:${kwBarPct}%`}></span>
        </div>
        {#if overview.web.keywordsHigh > 0}
          <span class="metric-sub"
            >{$_('app.home.overview.keywordsHigh', { values: { n: overview.web.keywordsHigh } })}</span
          >
        {:else if overview.web.keywordsTotal > 0}
          <span class="metric-sub">{$_('app.home.overview.keywordsTracked')}</span>
        {/if}
      </a>
      <a
        class="metric-card has-viz"
        class:accent={overview.web.citationGaps > 0}
        href={`${base}/geo`}
      >
        <div class="metric-top">
          <div class="mini-ring" style={`--v:${Math.round(geoGauge)}`} aria-hidden="true">
            <span>{geoGaugeLabel}</span>
          </div>
          <div class="metric-text">
            <span class="metric-l">{$_('app.home.overview.geo')}</span>
            {#if overview.web.citationsTotal > 0}
              <span class="metric-sub"
                >{$_('app.home.overview.geoMentioned', {
                  values: { n: overview.web.citationsMentioned, tot: overview.web.citationsTotal }
                })}</span
              >
            {:else if overview.web.shareOfVoice != null}
              <span class="metric-sub"
                >{$_('app.home.overview.shareOfVoice', {
                  values: { n: overview.web.shareOfVoice }
                })}</span
              >
            {/if}
          </div>
        </div>
      </a>
      <a
        class="metric-card"
        class:accent={auto.radarReview > 0}
        href={`${base}/radar`}
      >
        <span class="metric-n">
          {#if auto.radarEnabled}
            <AnimatedNum value={auto.radarReview || auto.radarRecent || 0} />
          {:else}
            —
          {/if}
        </span>
        <span class="metric-l">{$_('app.home.overview.radar')}</span>
        {#if !auto.radarEnabled}
          <span class="metric-sub">{$_('app.home.overview.radarOff')}</span>
        {:else if auto.radarReview > 0}
          <span class="metric-sub"
            >{$_('app.home.overview.radarReview', { values: { n: auto.radarReview } })}</span
          >
        {:else}
          <span class="metric-sub"
            >{$_('app.home.overview.radarRecent', { values: { n: auto.radarRecent } })}</span
          >
        {/if}
      </a>
      <a
        class="metric-card"
        class:accent={auto.leadsPending > 0}
        href={`${base}/leads`}
      >
        <span class="metric-n">
          {#if auto.leadsPending > 0 || auto.leadsTotal > 0}
            <AnimatedNum value={auto.leadsPending || auto.leadsTotal} />
          {:else}
            —
          {/if}
        </span>
        <span class="metric-l">{$_('app.home.overview.leads')}</span>
        {#if auto.leadsPending > 0}
          <span class="metric-sub"
            >{$_('app.home.overview.leadsPending', { values: { n: auto.leadsPending } })}</span
          >
        {:else if auto.leadsTotal > 0}
          <span class="metric-sub"
            >{$_('app.home.overview.leadsTotal', { values: { n: auto.leadsTotal } })}</span
          >
        {/if}
      </a>
      <a class="metric-card" href={`${base}/site`}>
        <span class="metric-n"><AnimatedNum value={overview.blog.published} /></span>
        <span class="metric-l">{$_('app.home.overview.blogPublished')}</span>
        {#if pendingBlogCount > 0}
          <span class="metric-sub"
            >{$_('app.home.overview.blogPending', { values: { n: pendingBlogCount } })}</span
          >
        {/if}
      </a>
    </div>
  </section>

  <!-- Performance -->
  <section class="ov-section">
    <div class="ov-section-head">
      <div class="ov-section-copy">
        <span class="ov-kicker">{$_('app.home.overview.sectionPerformance')}</span>
        <h3>{$_('app.home.overview.analysisTitle')}</h3>
        <p class="ov-section-desc">{$_('app.home.overview.analysisDesc')}</p>
        {#if overview.analysis.statsUpdatedAt}
          <p class="ov-stats-updated">
            {$_('app.home.overview.statsUpdated', {
              values: { date: formatWhen(overview.analysis.statsUpdatedAt) }
            })}
          </p>
        {/if}
      </div>
      <a class="ov-link" href={`${base}/analytics`}>{$_('app.home.overview.openAnalytics')} →</a>
    </div>

    <div class="perf-layout">
      <a class="perf-spark" href={`${base}/analytics`}>
        <div class="perf-spark-head">
          <span class="metric-l">{$_('app.home.overview.viewsSpark')}</span>
          <span class="metric-n"
            ><AnimatedNum value={overview.analysis.views7d} format={fmtCompactNum} /></span
          >
        </div>
        <svg class="spark-svg" viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true">
          <path class="spark-area" d={sparkArea} />
          <path class="spark-line" d={sparkPath} />
        </svg>
        <div class="spark-days" aria-hidden="true">
          {#each viewsByDay as v, i (i)}
            <span class:hot={v === maxViewsDay && v > 0}></span>
          {/each}
        </div>
      </a>

      <a class="perf-bars" href={`${base}/analytics`}>
        <div class="perf-spark-head">
          <span class="metric-l">{$_('app.home.overview.likesBars')}</span>
          <span class="metric-n"
            ><AnimatedNum value={overview.analysis.likes7d} format={fmtCompactNum} /></span
          >
        </div>
        <div class="likes-bars" aria-hidden="true">
          {#each likesByDay as v, i (i)}
            <span style={`height:${Math.max(6, (v / maxLikesDay) * 100)}%`} class:hot={v === maxLikesDay && v > 0}></span>
          {/each}
        </div>
      </a>

      <div class="perf-kpis">
        <a class="metric-card" href={`${base}/analytics`}>
          <span class="metric-n"><AnimatedNum value={overview.analysis.published} /></span>
          <span class="metric-l">{$_('app.home.overview.published')}</span>
        </a>
        <a class="metric-card" href={`${base}/calendar`}>
          <span class="metric-n"><AnimatedNum value={scheduledPostCount} /></span>
          <span class="metric-l">{$_('app.home.overview.scheduled')}</span>
        </a>
      </div>
    </div>

    <MediaReviewStatsPanel stats={overview.mediaReviews} brandSlug={brandSlug} compact />
  </section>
</div>

<style>
  /* Registering the angle is what makes the rotating border possible at all: an unregistered
     custom property has no type, so CSS jumps it 0deg→360deg instead of interpolating and the
     gradient never moves. Where @property is unsupported the border simply sits still — the
     accent colour and the glow still read, so nothing is lost. */
  @property --ob-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }
  @property --cta-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  .home-wb {
    padding: 0;
    max-width: var(--content-max, 960px);
    min-width: 0;
    width: 100%;
    overflow-x: clip;
  }

  .ob-banner {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0 0 20px;
    padding: 16px 18px;
    width: 100%;
    text-align: left;
    font: inherit;
    cursor: pointer;
    border-radius: 16px;
    /* Border is drawn by the rotating conic gradient below, not by a static border, so the
       element keeps the same box size whether the animation runs or not. */
    border: 1px solid transparent;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--accent) 12%, var(--paper)) 0%,
        var(--paper) 55%
      )
      padding-box,
      conic-gradient(
        from var(--ob-angle),
        color-mix(in srgb, var(--accent) 70%, transparent),
        color-mix(in srgb, var(--accent) 10%, var(--line)) 25%,
        color-mix(in srgb, var(--accent) 70%, transparent) 50%,
        color-mix(in srgb, var(--accent) 10%, var(--line)) 75%,
        color-mix(in srgb, var(--accent) 70%, transparent)
      )
      border-box;
    color: var(--ink);
    position: relative;
    animation:
      ob-spin 4s linear infinite,
      ob-glow 2.6s ease-in-out infinite;
  }
  /* Glow as a pulsing box-shadow rather than a blurred pseudo-element behind the card: a
     `z-index:-1` layer would sit behind the PAGE background too (the banner creates no stacking
     context of its own), so on some themes it would simply be invisible. */
  @keyframes ob-spin {
    to {
      --ob-angle: 360deg;
    }
  }
  @keyframes ob-glow {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 18px 2px color-mix(in srgb, var(--accent) 35%, transparent);
    }
  }
  /* An animated border on a permanently visible banner is exactly the motion that triggers
     vestibular discomfort — freeze it, but keep the accent border so it still reads as urgent. */
  @media (prefers-reduced-motion: reduce) {
    .ob-banner {
      animation: none;
      border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
      box-shadow: 0 0 14px 1px color-mix(in srgb, var(--accent) 22%, transparent);
    }
  }
  .ob-banner-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .ob-banner-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ob-banner-title {
    font-size: 15px;
    font-weight: 650;
  }
  .ob-banner-msg {
    font-size: 13px;
    color: var(--ink-soft);
  }
  /* Material-style state layers: the button keeps ONE background (the accent) and the interaction
     is expressed by a translucent white overlay on top of it — 8% hovered, 12% pressed — plus an
     elevation change. Tinting the accent itself would drift the brand colour; a layer does not.
     The overlay lives in a pseudo-element so it can't affect the label's contrast. */
  .ob-banner-cta {
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    padding: 10px 14px;
    border-radius: 999px;
    /* Same rotating-border trick as the banner, at pill scale: the accent fill is the padding-box
       layer, the travelling highlight is the border-box layer. */
    border: 1px solid transparent;
    background:
      linear-gradient(var(--accent), var(--accent)) padding-box,
      conic-gradient(
          from var(--cta-angle),
          rgba(255, 255, 255, 0.45),
          rgba(255, 255, 255, 0.06) 25%,
          rgba(255, 255, 255, 0.45) 50%,
          rgba(255, 255, 255, 0.06) 75%,
          rgba(255, 255, 255, 0.45)
        )
        border-box;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    /* Glow rides on filter, NOT box-shadow — box-shadow is already carrying the Material
       elevation states, and one property cannot animate on two schedules. */
    filter: drop-shadow(0 0 0 transparent);
    animation:
      cta-spin 3s linear infinite,
      cta-glow 2.6s ease-in-out infinite;
    transition:
      box-shadow 140ms cubic-bezier(0.2, 0, 0, 1),
      transform 90ms cubic-bezier(0.2, 0, 0, 1);
  }
  @keyframes cta-spin {
    to {
      --cta-angle: 360deg;
    }
  }
  @keyframes cta-glow {
    0%,
    100% {
      filter: drop-shadow(0 0 1px color-mix(in srgb, var(--accent) 14%, transparent));
    }
    50% {
      filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 32%, transparent));
    }
  }
  .ob-banner-cta::after {
    content: '';
    position: absolute;
    inset: 0;
    background: #fff;
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.2, 0, 0, 1);
    pointer-events: none;
  }
  /* Hover lives on the banner, not the span: the whole banner is the control, so the pointer is
     rarely exactly over the pill — reacting only to the pill would feel broken. */
  .ob-banner:hover .ob-banner-cta {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.24);
  }
  .ob-banner:hover .ob-banner-cta::after {
    opacity: 0.08;
  }
  .ob-banner:active .ob-banner-cta {
    /* Pressed sits LOWER than resting — Material drops elevation on press, it does not raise it. */
    box-shadow: 0 0 0 rgba(0, 0, 0, 0.2);
    transform: scale(0.97);
  }
  .ob-banner:active .ob-banner-cta::after {
    opacity: 0.12;
  }
  .ob-banner:focus-visible .ob-banner-cta::after {
    opacity: 0.1;
  }
  @media (prefers-reduced-motion: reduce) {
    .ob-banner-cta {
      transition: none;
      animation: none;
      /* Keep a static glow so the button still stands out without moving. */
      filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 20%, transparent));
    }
    .ob-banner:active .ob-banner-cta {
      transform: none;
    }
  }

  .setup-box {
    margin: 0 0 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    overflow: hidden;
  }
  .setup-head {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 8px 12px;
    width: 100%;
    padding: 14px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .setup-head:hover {
    background: var(--paper-2);
  }
  .setup-head-text {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .setup-title {
    font-size: 14px;
    font-weight: 650;
  }
  .setup-progress {
    font-size: 12px;
    color: var(--ink-faint);
  }
  .setup-bar {
    grid-column: 1 / -1;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    overflow: hidden;
  }
  .setup-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.5s ease;
  }
  .setup-chevron {
    align-self: start;
    color: var(--ink-faint);
    transition: transform 0.2s ease;
  }
  .setup-chevron.open {
    transform: rotate(180deg);
  }
  .setup-list {
    list-style: none;
    margin: 0;
    padding: 0 8px 8px;
  }
  .setup-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
  }
  .setup-check {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    display: grid;
    place-items: center;
    flex: none;
  }
  .setup-list li.done .setup-check {
    background: color-mix(in srgb, var(--accent) 18%, var(--paper));
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    color: var(--accent);
  }
  .setup-check svg {
    width: 12px;
    height: 12px;
  }
  .setup-label {
    font-size: 13px;
    color: var(--ink);
    text-decoration: none;
  }
  .setup-label.done {
    color: var(--ink-faint);
  }
  .setup-footer {
    padding: 0 16px 14px;
  }
  .setup-dismiss {
    appearance: none;
    border: none;
    background: none;
    color: var(--ink-faint);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
  }

  .upgrade-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 20px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--paper-2);
  }
  .upgrade-banner p {
    margin: 0;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .upgrade-banner a {
    flex: none;
    font-size: 13px;
    font-weight: 650;
    color: var(--accent);
    text-decoration: none;
  }

  /* ── Control hero ─────────────────────────────────────────── */
  .control-hero {
    display: grid;
    gap: 18px;
    margin: 0 0 64px;
    padding: 18px 18px 16px;
    border-radius: 18px;
    border: 1px solid var(--line);
    min-width: 0;
    max-width: 100%;
    overflow-x: clip;
    background:
      radial-gradient(
        120% 80% at 100% 0%,
        color-mix(in srgb, var(--accent) 10%, transparent) 0%,
        transparent 55%
      ),
      var(--paper);
  }
  .control-hero.ok {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
  }
  .control-copy {
    min-width: 0;
  }
  .control-title {
    margin: 4px 0 6px;
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .control-desc {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink-soft);
    max-width: 42ch;
  }
  .gauge-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper-2) 70%, var(--paper));
    border: 1px solid transparent;
    text-decoration: none;
    color: inherit;
  }
  a.gauge:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
  }
  .gauge-ring {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: conic-gradient(var(--accent) calc(var(--v) * 1%), color-mix(in srgb, var(--ink) 8%, transparent) 0);
    transition: background 0.6s ease;
  }
  .gauge-ring span {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: var(--paper);
    display: grid;
    place-items: center;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .gauge-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
    text-align: center;
  }

  .review-queue {
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
  }
  .review-queue-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .review-queue-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 12rem;
  }
  .review-queue-title {
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .review-queue-meta {
    font-size: 12.5px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  .review-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper-2) 55%, var(--paper));
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }
  .review-list li {
    min-width: 0;
  }
  .review-list li + li {
    border-top: 1px solid var(--line);
  }
  .review-list a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    text-decoration: none;
    color: inherit;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }
  .review-list a:hover {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .review-list .up-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }
  .review-queue-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .review-pager {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .review-pager .ov-ai:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .review-page-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
    min-width: 4.5ch;
    text-align: center;
  }
  button.review-toggle {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }

  /* ── Pipeline ─────────────────────────────────────────────── */
  .pipe-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .pipe-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 14px 12px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--paper);
    text-decoration: none;
    color: inherit;
  }
  .pipe-card:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
    background: var(--paper-2);
  }
  .pipe-kind {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .pipe-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .pipe-l {
    font-size: 12.5px;
    color: var(--ink-soft);
  }
  .pipe-n {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .pipe-track {
    height: 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    overflow: hidden;
    margin-bottom: 4px;
  }
  .pipe-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.55s ease;
    min-width: 0;
  }
  .pipe-fill.warn {
    background: color-mix(in srgb, #c9782a 80%, var(--accent));
  }
  .pipe-fill.ok {
    background: color-mix(in srgb, #2a9a5c 70%, var(--accent));
  }

  .ov-section {
    margin: 0 0 64px;
  }
  .ov-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .ov-kicker {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 2px;
  }
  .ov-section-copy h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .ov-section-desc {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .ov-stats-updated {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--ink-faint, var(--ink-soft));
    opacity: 0.85;
  }
  .ov-link {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .ov-empty {
    margin: 0;
    padding: 16px;
    border-radius: 14px;
    border: 1px dashed var(--line);
    font-size: 13.5px;
    color: var(--ink-soft);
    text-align: center;
  }
  .ov-empty.quiet {
    border-style: solid;
    background: var(--paper);
  }

  .ov-panel {
    margin-top: 10px;
    padding: 14px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
  .ov-panel.compact {
    padding: 12px 14px;
  }
  .ov-panel + .ov-panel {
    margin-top: 10px;
  }
  .ov-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .ov-panel-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .ov-kind {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--paper));
    padding: 3px 7px;
    border-radius: 6px;
  }
  .ov-panel-title {
    font-size: 14px;
    font-weight: 650;
  }
  .ov-panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }
  .ov-ai {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 999px;
    cursor: pointer;
    max-width: 100%;
    white-space: nowrap;
  }
  .ov-ai:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  }
  .ov-ai-strong {
    background: color-mix(in srgb, var(--accent) 12%, var(--paper));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--line));
  }

  .upcoming-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .upcoming-list li + li {
    border-top: 1px solid var(--line);
  }
  .upcoming-list a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    text-decoration: none;
    color: inherit;
  }
  .up-thumb {
    width: 40px;
    height: 40px;
    border-radius: 9px;
    overflow: hidden;
    flex: none;
    background: color-mix(in srgb, var(--ink) 6%, var(--paper));
  }
  .up-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .up-ph {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-faint);
  }
  .up-body {
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }
  .up-meta {
    font-size: 11.5px;
    color: var(--ink-faint);
    min-width: 0;
    max-width: 100%;
  }
  .up-title {
    font-size: 13px;
    font-weight: 550;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Metrics / web ────────────────────────────────────────── */
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  @container workbench (min-width: 640px) {
    .metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .metric-grid-wide {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .metric-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 14px 14px 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
    text-decoration: none;
    color: var(--ink);
    min-width: 0;
  }
  .metric-card:hover {
    background: var(--paper-2);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
  }
  .metric-card.accent {
    border-color: color-mix(in srgb, var(--accent) 32%, var(--line));
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--accent) 9%, var(--paper)) 0%,
      var(--paper) 48%
    );
  }
  .metric-n {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .metric-l {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .metric-sub {
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .metric-top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .metric-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .mini-ring {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    background: conic-gradient(var(--accent) calc(var(--v) * 1%), color-mix(in srgb, var(--ink) 8%, transparent) 0);
    transition: background 0.55s ease;
  }
  .mini-ring span {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--paper);
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .mini-bar {
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    overflow: hidden;
    margin: 6px 0 2px;
  }
  .mini-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.55s ease;
  }

  /* ── Performance ──────────────────────────────────────────── */
  .perf-layout {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 10px;
  }
  .perf-spark,
  .perf-bars {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--paper);
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .perf-spark:hover,
  .perf-bars:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
    background: var(--paper-2);
  }
  .perf-spark-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .perf-spark-head .metric-n {
    font-size: 18px;
  }
  .spark-svg {
    width: 100%;
    height: 64px;
    display: block;
  }
  .spark-area {
    fill: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .spark-line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 400;
    stroke-dashoffset: 0;
    animation: spark-draw 0.9s ease both;
  }
  @keyframes spark-draw {
    from {
      stroke-dashoffset: 400;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  .spark-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .spark-days span {
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .spark-days span.hot {
    background: var(--accent);
  }
  .likes-bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 72px;
    padding-top: 4px;
  }
  .likes-bars span {
    flex: 1;
    border-radius: 6px 6px 3px 3px;
    background: color-mix(in srgb, var(--accent) 55%, var(--ink));
    min-height: 6px;
    transition: height 0.55s ease;
    opacity: 0.75;
  }
  .likes-bars span.hot {
    opacity: 1;
    background: var(--accent);
  }
  .perf-kpis {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  @media (prefers-reduced-motion: reduce) {
    .spark-line {
      animation: none;
    }
    .pipe-fill,
    .mini-bar span,
    .likes-bars span,
    .setup-bar span,
    .gauge-ring,
    .mini-ring {
      transition: none;
    }
  }

  @container workbench (max-width: 640px) {
    .gauge-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .gauge-ring {
      width: 58px;
      height: 58px;
    }
    .gauge-ring span {
      width: 44px;
      height: 44px;
      font-size: 12px;
    }
    .pipe-grid {
      grid-template-columns: 1fr;
    }
    .perf-layout {
      grid-template-columns: 1fr;
    }
    .control-hero {
      padding: 14px 12px 12px;
    }
    .control-title {
      font-size: 1.2rem;
    }
    .review-queue-head {
      flex-direction: column;
      align-items: stretch;
    }
    .review-queue-copy {
      flex: 1 1 auto;
    }
    .ov-panel-actions {
      width: 100%;
    }
    .ov-panel-actions .ov-ai {
      flex: 1 1 auto;
      text-align: center;
      white-space: normal;
    }
    .review-list a {
      padding: 10px;
      gap: 8px;
    }
    .up-title {
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      text-overflow: ellipsis;
    }
    .review-queue-foot {
      flex-direction: column;
      align-items: stretch;
    }
    .review-pager {
      justify-content: space-between;
      width: 100%;
    }
  }

  @container workbench (max-width: 420px) {
    .gauge-row {
      gap: 4px;
    }
    .gauge {
      padding: 10px 4px;
    }
    .gauge-ring {
      width: 52px;
      height: 52px;
    }
    .gauge-ring span {
      width: 40px;
      height: 40px;
      font-size: 11px;
    }
    .gauge-label {
      font-size: 11px;
    }
  }
</style>
