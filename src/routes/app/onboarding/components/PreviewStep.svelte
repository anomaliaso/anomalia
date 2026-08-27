<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { track } from '$lib/analytics';
  import { cancelPoll, peekJob, runStepJob, type JobPoll } from './step-jobs';
  import { pmeta, plabel, picon } from './platform-utils';

  let {
    previewPhase = $bindable('idle' as 'idle' | 'generating' | 'done'),
    imagesRendering = $bindable(false),
    previewPosts = $bindable([]),
    planPostsJobId = $bindable(null),
    previewImagesJobId = $bindable(null),
    pollRef = $bindable(),
    brandName = $bindable(''),
    brandId = null,
    draftId = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    genProfile = null,
    planVisualStyle = null,
    platforms = [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prefs = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan = null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people = [],
    url = '',
    creatorNiche = '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    researchData = null,
    citations = [],
    namedCompetitors = [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    peopleForSave = [],
    handles = [],
    additionalContext = '',
    planParam = '',
    cycleParam = '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formError = null,
    publishing = false,
    isContinueMode = false,
    publishEnhance,
    onskip,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror
  }: {
    previewPhase?: 'idle' | 'generating' | 'done';
    imagesRendering?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previewPosts?: any[];
    planPostsJobId?: string | null;
    previewImagesJobId?: string | null;
    pollRef?: JobPoll | undefined;
    brandName?: string;
    brandId?: string | null;
    draftId?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    genProfile?: any;
    planVisualStyle?: string | null;
    platforms?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prefs?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan?: any | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    people?: any[];
    url?: string;
    creatorNiche?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    researchData?: any;
    citations?: { uri: string; title: string }[];
    namedCompetitors?: { name: string; website: string; kind: 'direct' | 'indirect'; rationale: string; source: 'ai' | 'user' }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    peopleForSave?: any[];
    handles?: { platform: string; username: string | null; profileUrl: string | null }[];
    additionalContext?: string;
    planParam?: string;
    cycleParam?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formError?: any;
    publishing?: boolean;
    isContinueMode?: boolean;
    publishEnhance: SubmitFunction;
    onskip: () => void;
    onerror?: (step: string, message: unknown, context?: Record<string, unknown>) => void;
  } = $props();

  let previewProgress = $state('');
  let previewStage = $state<'planning' | 'writing' | 'captions_ready' | 'generating'>('planning');
  let previewError = $state('');
  const previewBusy = $derived(previewPhase === 'generating' || imagesRendering);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openPost = $state<any | null>(null);
  const isVideo = (fmt: string | undefined) => /video|reel|short/i.test(fmt ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isTextOnly = (p: any) => p?.media === 'text';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imagePending = (p: any) => !p?.imageUrl && !isTextOnly(p) && (previewPhase === 'generating' || imagesRendering);

  // L'anteprima si ferma a 3 post per arrivare prima al checkout; il resto nasce all'attivazione.
  const weekTotal = $derived.by(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mix: any[] = plan?.weeks?.[0]?.content_mix ?? [];
    const sum = mix.reduce((acc, m) => acc + (Number(m?.count) || 0), 0);
    return sum > 0 ? Math.min(sum, 14) : 5;
  });
  const expectedPosts = $derived(Math.min(3, weekTotal));

  function applyProgress(msg: { type?: string; step?: string; message?: string }) {
    if (msg.type !== 'progress' && !msg.step) return;
    const step = String(msg.step ?? '');
    if (step === 'planning' || step === 'writing' || step === 'captions_ready' || step === 'generating') {
      previewStage = step;
    }
    if (step === 'planning') previewProgress = $_('onboarding.preview.stepPlan');
    else if (step === 'writing') previewProgress = $_('onboarding.preview.stepCaptions');
    else if (step === 'captions_ready') previewProgress = $_('onboarding.preview.stepImages');
    else if (step === 'generating') previewProgress = (msg.message as string) || $_('onboarding.preview.stepImages');
    else if (msg.message) previewProgress = msg.message as string;
  }

  export async function planPosts(force = true) {
    if (!plan) return;
    previewPhase = 'generating';
    previewStage = 'planning';
    previewPosts = [];
    previewError = '';
    previewProgress = $_('onboarding.preview.stepPlan');
    cancelPoll(pollRef);
    const poll: JobPoll = { cancelled: false };
    pollRef = poll;
    try {
      const outcome = await runStepJob({
        path: '/app/onboarding/plan/posts',
        jobId: planPostsJobId,
        force,
        poll,
        body: {
          brandId,
          draftId,
          profile: { ...genProfile, visual_style: planVisualStyle ?? genProfile.visual_style ?? null },
          platforms,
          prefs,
          plan,
          people
        },
        onProgress: (m, progress) => {
          applyProgress({ type: 'progress', step: String(progress.step ?? ''), message: m });
        },
        onResult: (result) => {
          if (Array.isArray(result?.posts) && result.posts.length) {
            previewPosts = result.posts;
          }
        }
      });
      if (outcome.jobId) planPostsJobId = outcome.jobId;
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'failed') {
        onerror?.('plan_posts', outcome.error || 'planning failed');
        if (!previewError) previewError = $_('onboarding.status.previewFailed');
      }
      if (previewPosts.length) {
        await renderImages();
      } else {
        if (!previewError) {
          onerror?.('plan_posts', 'job done without posts');
          previewError = $_('onboarding.status.previewFailed');
        }
        previewPhase = 'idle';
      }
    } catch (e) {
      onerror?.('plan_posts', e instanceof Error ? e.message : 'enqueue failed');
      if (!previewError) previewError = $_('onboarding.status.previewFailed');
      if (previewPosts.length) await renderImages();
      else previewPhase = 'idle';
    }
  }

  async function renderImages(force = true) {
    imagesRendering = true;
    previewStage = 'generating';
    previewProgress = $_('onboarding.preview.stepImages');
    cancelPoll(pollRef);
    const poll: JobPoll = { cancelled: false };
    pollRef = poll;
    try {
      const outcome = await runStepJob({
        path: '/app/onboarding/preview/images',
        jobId: previewImagesJobId,
        force,
        poll,
        body: {
          brandId,
          draftId,
          profile: { ...genProfile, visual_style: planVisualStyle ?? genProfile.visual_style ?? null },
          posts: previewPosts,
          people,
          platforms
        },
        onProgress: (m, progress) => {
          applyProgress({ type: 'progress', step: String(progress.step ?? 'generating'), message: m });
        },
        onResult: (result) => {
          if (Array.isArray(result?.posts)) {
            // Merge per `_i`: i render parziali devono finire sulla scheda giusta. Al resume la
            // lista locale può essere vuota — allora si prende quella del job in blocco.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const byI = new Map<number, any>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const p of result.posts as any[]) {
              if (typeof p?._i === 'number') byI.set(p._i, p);
            }
            previewPosts = previewPosts.length
              ? previewPosts.map((p, i) => {
                  const idx = typeof p._i === 'number' ? p._i : i;
                  return byI.has(idx) ? { ...p, ...byI.get(idx) } : p;
                })
              : result.posts;
          }
        }
      });
      if (outcome.jobId) previewImagesJobId = outcome.jobId;
      if (outcome.status === 'failed') {
        onerror?.('preview_images', outcome.error || 'image render failed');
      }
    } catch (e) {
      onerror?.('preview_images', e instanceof Error ? e.message : 'enqueue failed');
    } finally {
      imagesRendering = false;
      // Cancelled = la pagina se ne va, non un render finito: non segnare done né tracciare.
      if (!poll.cancelled) {
        previewPhase = 'done';
        track('onboarding_preview_generated', { posts: previewPosts.length });
      }
    }
  }

  /** Riattacca allo stage ancora in volo dopo un refresh, invece di far pagare un secondo render. */
  export async function resumeJobs() {
    if (previewBusy) return;
    // Le immagini sono l'ultimo stage: se quel job è vivo, possiede già lo schermo.
    if (previewImagesJobId) {
      const snap = await peekJob('/app/onboarding/preview/images', previewImagesJobId);
      if (snap?.status === 'pending' || snap?.status === 'running') {
        previewPhase = 'generating';
        await renderImages(false);
        return;
      }
    }
    if (planPostsJobId) {
      const snap = await peekJob('/app/onboarding/plan/posts', planPostsJobId);
      if (snap?.status === 'pending' || snap?.status === 'running') await planPosts(false);
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && openPost && (openPost = null)} />

{#if previewBusy}
  <div class="gen-progress" aria-live="polite">
    <div class="gen-progress-top">
      <span class="hsp"></span>
      <div class="gen-progress-copy">
        <strong>{$_('onboarding.preview.progressTitle')}</strong>
        <span>{previewProgress || $_('onboarding.status.designingPosts')}</span>
        <small>{$_('onboarding.preview.progressHint')}</small>
      </div>
    </div>
    <ol class="gen-steps">
      <li class:done={previewStage !== 'planning'} class:active={previewStage === 'planning'}>
        {$_('onboarding.preview.stepPlan')}
      </li>
      <li
        class:done={previewStage === 'captions_ready' || previewStage === 'generating'}
        class:active={previewStage === 'writing'}
      >
        {$_('onboarding.preview.stepCaptions')}
      </li>
      <li class:done={previewPhase === 'done' && !imagesRendering} class:active={previewStage === 'captions_ready' || previewStage === 'generating'}>
        {$_('onboarding.preview.stepImages')}
      </li>
    </ol>
  </div>
{/if}

<div class="post-grid">
  {#each previewPosts as p, i (p._i ?? i)}
    {@const ic = picon(p.platform)}
    {@const extra = (Array.isArray(p.platforms) ? p.platforms : []).filter((x: string) => x !== p.platform)}
    <button type="button" class="pcard" onclick={() => (openPost = p)} aria-label={$_('onboarding.post.openToReview')}>
      <div class="pimg" class:textonly={isTextOnly(p)} style={p.imageUrl ? `background-image:url(${p.imageUrl})` : ''}>
        {#if isTextOnly(p)}
          <span class="textpost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h10" /></svg>{$_('onboarding.post.textPost')}</span>
        {:else if imagePending(p)}
          <span class="imgwait">
            <span class="iwbar"></span>
            <span class="iwlbl">{$_('onboarding.post.generatingImage')}</span>
          </span>
        {:else if !p.imageUrl}
          <span class="noimg">{$_('onboarding.post.noImage')}</span>
        {/if}
        {#if isVideo(p.format) && !isTextOnly(p)}
          <span class="vbadge" title={$_('onboarding.post.video')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)" /><path d="M10 8.5v7l5.5-3.5z" fill="#fff" /></svg>
          </span>
        {/if}
        <span class="zoom" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        </span>
      </div>
      <div class="pbody">
        <div class="prow">
          {#if ic}
            <svg class="picon" viewBox="0 0 24 24" fill={`#${ic.hex}`}><path d={ic.path} /></svg>
          {:else}
            <span class="picon-badge" style={`background:${pmeta(p.platform)?.bg ?? '#999'}`}>{pmeta(p.platform)?.short ?? '?'}</span>
          {/if}
          <span class="pplat">{plabel(p.platform)}</span>
          {#if extra.length}
            <span class="xpost" title={$_('onboarding.post.crossPost')}>+{extra.map((x: string) => plabel(x)).join(', ')}</span>
          {/if}
          {#if p.product}<span class="prod-tag" title={$_('onboarding.post.featuredProduct')}>{p.product}</span>{/if}
        </div>
        <p class="pcap">{p.caption}</p>
        <div class="pwhen">
          <svg class="clk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          {p.day} · {p.time}{#if p.format} · {p.format}{/if}
        </div>
      </div>
    </button>
  {/each}

  {#if previewBusy}
    {#each Array.from({ length: Math.max(0, expectedPosts - previewPosts.length) }, (_v, i) => i) as sk (sk)}
      <div class="pcard skeleton"><div class="pimg"><span class="sp"></span></div></div>
    {/each}
  {/if}
</div>

{#if previewPhase === 'done' && weekTotal > previewPosts.length}
  <p class="hint">{$_('onboarding.preview.remaining', { values: { count: weekTotal - previewPosts.length } })}</p>
{/if}

{#if previewError}
  <p class="err">{previewError}</p>
  <button type="button" class="ghost retry-btn" onclick={() => planPosts()} disabled={previewBusy}>{$_('onboarding.retry')}</button>
{/if}

<div class="next-up">
  <div class="nu-h">{$_('onboarding.nextUp.title')}</div>
  <ul class="nu-list">
    {#each ['gtm', 'rows', 'loop'] as k, i (k)}
      <li>
        <span class="nu-n">{i + 1}</span>
        <span><b>{$_('onboarding.nextUp.' + k + '.t')}</b>{$_('onboarding.nextUp.' + k + '.s')}</span>
      </li>
    {/each}
  </ul>
</div>

<!-- Rete di sicurezza: senza nome il brand non nasce, e l'analisi può non averlo trovato. -->
{#if !brandName.trim()}
  <div class="block">
    <div class="lbl">{$_('onboarding.brand.nameLabel')}</div>
    <input bind:value={brandName} placeholder="Latina Coffee Co." />
  </div>
{/if}

<form method="POST" action="?/finish" use:enhance={publishEnhance} class="form">
  {#if brandId && isContinueMode}<input type="hidden" name="brand_id" value={brandId} />{/if}
  <input type="hidden" name="draft_id" value={draftId ?? ''} />
  <input type="hidden" name="name" value={brandName} />
  <input type="hidden" name="website" value={url} />
  {#if profile}
    <input type="hidden" name="profile" value={JSON.stringify(profile)} />
  {:else if creatorNiche.trim()}
    <input type="hidden" name="profile" value={JSON.stringify({ name: brandName, about: creatorNiche.trim(), url: url || '' })} />
  {/if}
  {#if previewPosts.length}<input type="hidden" name="posts" value={JSON.stringify(previewPosts)} />{/if}
  <input type="hidden" name="competitors" value={JSON.stringify(researchData?.competitors?.length ? researchData.competitors : namedCompetitors)} />
  {#if researchData}
    <input type="hidden" name="strategy" value={JSON.stringify({ report: researchData.report, benchmark: researchData.benchmark, positioning: researchData.positioning, citations })} />
  {/if}
  {#if peopleForSave.length}<input type="hidden" name="people" value={JSON.stringify(peopleForSave)} />{/if}
  <input type="hidden" name="platforms" value={JSON.stringify(platforms)} />
  <input type="hidden" name="prefs" value={JSON.stringify(prefs)} />
  {#if plan}<input type="hidden" name="editorial_plan" value={JSON.stringify(plan)} />{/if}
  <input type="hidden" name="handles" value={JSON.stringify(handles)} />
  <input type="hidden" name="additional_context" value={additionalContext} />
  {#if planParam}<input type="hidden" name="plan" value={planParam} />{/if}
  {#if cycleParam}<input type="hidden" name="cycle" value={cycleParam} />{/if}
  <div class="cta-row">
    {#if isContinueMode}
      <button type="button" class="ghost" onclick={onskip} disabled={previewBusy || publishing}>{$_('onboarding.finishLater')}</button>
    {/if}
    <button type="submit" class="primary cta-press" disabled={previewBusy || publishing || !brandName.trim()}>
      {previewBusy
        ? $_('onboarding.preview.generating')
        : isContinueMode
          ? $_('onboarding.preview.finishSetup')
          : $_('onboarding.preview.openDashboard')}
    </button>
  </div>
  {#if formError}<p class="err">{formError === 'slotLimit' ? $_('onboarding.slotLimit') : formError}</p>{/if}
</form>

{#if openPost}
  {@const op = openPost}
  {@const oic = picon(op.platform)}
  <div
    class="lb-overlay"
    role="button"
    tabindex="-1"
    aria-label={$_('onboarding.close')}
    onclick={(e) => e.target === e.currentTarget && (openPost = null)}
    onkeydown={(e) => e.key === 'Enter' && (openPost = null)}
  >
    <div class="lb-card" role="dialog" aria-modal="true" tabindex="-1">
      <button type="button" class="lb-close" onclick={() => (openPost = null)} aria-label={$_('onboarding.close')}>×</button>
      <div class="lb-img" class:textonly={isTextOnly(op)} style={op.imageUrl ? `background-image:url(${op.imageUrl})` : ''}>
        {#if isTextOnly(op)}
          <span class="textpost lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h10" /></svg>{$_('onboarding.post.textOnlyPost')}</span>
        {:else if imagePending(op)}
          <span class="imgwait">
            <span class="iwbar"></span>
            <span class="iwlbl">{$_('onboarding.post.generatingImage')}</span>
          </span>
        {:else if !op.imageUrl}
          <span class="noimg">{$_('onboarding.post.noImage')}</span>
        {/if}
        {#if isVideo(op.format) && !isTextOnly(op)}
          <span class="vbadge" title={$_('onboarding.post.video')}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.45)" /><path d="M10 8.5v7l5.5-3.5z" fill="#fff" /></svg>
          </span>
        {/if}
      </div>
      <div class="lb-body">
        <div class="lb-meta">
          {#if oic}
            <svg class="picon" viewBox="0 0 24 24" fill={`#${oic.hex}`}><path d={oic.path} /></svg>
          {:else}
            <span class="picon-badge" style={`background:${pmeta(op.platform)?.bg ?? '#999'}`}>{pmeta(op.platform)?.short ?? '?'}</span>
          {/if}
          <span class="pplat">{plabel(op.platform)}</span>
          {#if op.product}<span class="prod-tag" title={$_('onboarding.post.featuredProduct')}>{op.product}</span>{/if}
          <span class="lb-when">{op.day} · {op.time}{#if op.format} · {op.format}{/if}</span>
        </div>
        <p class="lb-cap">{op.caption}</p>
        {#if op.first_comment}
          <div class="lb-extra"><div class="lb-xh">{$_('onboarding.post.firstComment')}</div><p class="lb-xt">{op.first_comment}</p></div>
        {/if}
        {#if op.hook_variants?.length}
          <div class="lb-extra"><div class="lb-xh">{$_('onboarding.post.hookVariants')}</div>
            <ul class="lb-xl">{#each op.hook_variants as h (h)}<li>{h}</li>{/each}</ul></div>
        {/if}
        {#if op.alt_captions?.length}
          <div class="lb-extra"><div class="lb-xh">{$_('onboarding.post.altCaptions')}</div>
            <ul class="lb-xl">{#each op.alt_captions as a (a)}<li>{a}</li>{/each}</ul></div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  input { flex: 1; font-size: 16px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line-2, #d2d2d7); outline: none; width: 100%; height: 44px; }
  input:focus { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12); }
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }
  .primary { border-radius: 980px; padding: 13px 22px; margin-top: 24px; background: var(--accent, #7c5cff); color: #fff; }
  .primary:hover { background: #6b4dff; }
  .ghost { background: var(--paper-2, #f1f1f3); color: var(--ink, #1d1d1f); border-radius: 980px; padding: 13px 22px; }
  .err { color: #c0392b; font-size: 14px; margin-top: 14px; }
  .retry-btn { margin-top: 12px; }

  .block { margin-top: 18px; }
  .block .lbl { font-size: 16px; font-weight: 650; margin-bottom: 10px; letter-spacing: -0.01em; }
  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }

  .cta-row .primary, .cta-row .ghost { margin-top: 0; }

  @keyframes spin { to { transform: rotate(360deg); } }

  .gen-progress {
    position: sticky; top: 8px; z-index: 5; margin: 8px 0 18px; padding: 14px 16px;
    border: 1px solid var(--line, #e3e3e6); border-radius: 14px;
    background: color-mix(in srgb, var(--paper, #fff) 92%, var(--accent, #7c5cff));
    backdrop-filter: blur(8px); box-shadow: 0 8px 24px -16px rgba(0,0,0,.35);
  }
  .gen-progress-top { display: flex; align-items: flex-start; gap: 10px; }
  .gen-progress-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .gen-progress-copy strong { font-size: 14px; color: var(--ink, #1d1d1f); }
  .gen-progress-copy span { font-size: 13px; color: var(--ink-soft, #6e6e73); }
  .gen-progress-copy small { font-size: 11px; color: var(--ink-faint, #86868b); }
  .gen-steps { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
  .gen-steps li {
    position: relative; padding: 6px 10px 6px 28px; border-radius: 8px;
    font-size: 12px; font-weight: 600; color: var(--ink-faint, #86868b);
    background: color-mix(in srgb, var(--paper, #fff) 70%, transparent);
  }
  .gen-steps li::before {
    content: ''; position: absolute; left: 10px; top: 50%; width: 8px; height: 8px;
    border-radius: 50%; transform: translateY(-50%);
    background: var(--ink-faint, #c7c7cc);
  }
  .gen-steps li.active { color: var(--ink, #1d1d1f); background: color-mix(in srgb, var(--accent, #7c5cff) 12%, var(--paper, #fff)); }
  .gen-steps li.active::before { background: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.2); }
  .gen-steps li.done { color: var(--ink-soft, #6e6e73); }
  .gen-steps li.done::before { background: var(--accent, #7c5cff); }

  .post-grid { display: flex; flex-direction: column; gap: 18px; margin-top: 22px; }
  .pcard { display: block; width: 100%; padding: 0; font: inherit; text-align: left; cursor: pointer;
    border: 1px solid var(--line, #e3e3e6); border-radius: 16px; overflow: hidden; background: var(--paper, #fff);
    transition: box-shadow 0.15s var(--ease, ease), transform 0.15s var(--ease, ease); animation: rise 0.5s var(--ease, ease) both; }
  @media (prefers-reduced-motion: reduce) {
    .pcard { animation: none; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .pcard:not(.skeleton):hover { box-shadow: 0 10px 28px -12px rgba(0, 0, 0, 0.25); transform: translateY(-2px); }
  /* contain, non cover: 4:5, 9:16 e 16:9 devono uscire tutti senza tagli. */
  .pimg { position: relative; height: 400px; background-color: var(--paper-2, #f5f5f7);
    background-size: contain; background-repeat: no-repeat; background-position: center;
    display: flex; align-items: center; justify-content: center; }
  .skeleton .pimg, .pimg.textonly { height: 200px; }
  .pimg .noimg { font-size: 11px; color: var(--ink-faint, #86868b); }
  .imgwait { display: flex; flex-direction: column; align-items: center; gap: 10px; width: min(180px, 60%); }
  .iwbar { position: relative; width: 100%; height: 4px; border-radius: 980px; overflow: hidden;
    background: rgba(var(--accent-rgb), 0.16); }
  .iwbar::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 980px;
    background: var(--accent, #7c5cff); animation: iwslide 1.4s var(--ease, ease) infinite; }
  .iwlbl { font-size: 11px; font-weight: 600; color: var(--ink-soft, #6e6e73); }
  @keyframes iwslide { 0% { left: -40%; } 100% { left: 100%; } }
  @media (prefers-reduced-motion: reduce) {
    .iwbar::after { animation: none; left: 0; width: 100%; opacity: 0.5; }
  }
  .pimg.textonly, .lb-img.textonly { background: linear-gradient(160deg, var(--paper-2, #f6f7f8),
    color-mix(in srgb, var(--ink, #1d1d1f) 7%, var(--paper-2, #eceef0))); }
  .textpost { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--ink-soft, #6e6e73); font-size: 11px; font-weight: 600; }
  .textpost svg { width: 26px; height: 26px; }
  .textpost.lg { font-size: 13px; gap: 9px; }
  .textpost.lg svg { width: 40px; height: 40px; }
  .vbadge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .vbadge svg { width: 36px; height: 36px; filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35)); }
  .zoom { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.45); opacity: 0; transform: scale(0.9); transition: all 0.15s var(--ease, ease); pointer-events: none; }
  .zoom svg { width: 16px; height: 16px; }
  .pcard:hover .zoom { opacity: 1; transform: scale(1); }
  .pbody { padding: 14px 18px 16px; }
  .prow { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .prod-tag { font-size: 11px; font-weight: 600; color: var(--ink-soft, #6e6e73); background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line, #e3e3e6); border-radius: 999px; padding: 2px 9px; max-width: 160px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picon { width: 16px; height: 16px; flex: 0 0 auto; }
  .picon-badge { width: 16px; height: 16px; border-radius: 5px; color: #fff; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .pplat { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink, #1d1d1f); }
  .xpost { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; color: var(--ink-faint, #86868b); }
  /* Caption intera, mai troncata: prima di pagare si deve poter LEGGERE cosa è stato scritto. */
  .pcap { font-size: 13.5px; line-height: 1.55; margin-top: 10px; color: var(--ink, #1d1d1f); white-space: pre-wrap; }
  .pwhen { display: flex; align-items: center; gap: 5px; margin-top: 9px; font-size: 11.5px; font-weight: 600; color: var(--ink-faint, #86868b); }
  .pwhen .clk { width: 13px; height: 13px; flex: 0 0 auto; }
  .skeleton .pimg { background: var(--paper-2, #f5f5f7); }
  .sp { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent, #7c5cff); animation: spin 0.8s linear infinite; }

  .next-up { margin-top: 22px; border: 1px solid rgba(var(--accent-rgb), 0.3); border-radius: 16px; padding: 16px 18px;
    background: rgba(var(--accent-rgb), 0.04); }
  .nu-h { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent, #7c5cff); margin-bottom: 12px; }
  .nu-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
  .nu-list li { display: flex; gap: 11px; align-items: flex-start; }
  .nu-n { width: 22px; height: 22px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center;
    font-size: 11.5px; font-weight: 700; background: rgba(var(--accent-rgb), 0.12); color: var(--accent, #7c5cff); }
  .nu-list b { display: block; font-size: 14px; }
  .nu-list span:not(.nu-n) { font-size: 12.5px; color: var(--ink-soft, #6e6e73); line-height: 1.45; }

  .form { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .lb-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: rgba(18, 26, 22, 0.5); backdrop-filter: blur(5px); animation: fade 0.2s var(--ease, ease); }
  .lb-card { position: relative; width: min(880px, 95vw); max-height: 92vh; overflow: hidden; display: grid; grid-template-columns: 1.1fr 1fr;
    background: var(--paper, #fff); border-radius: 22px; box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.5); }
  .lb-close { position: absolute; top: 12px; right: 14px; z-index: 2; width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
    background: rgba(0, 0, 0, 0.4); color: #fff; font-size: 20px; line-height: 1; }
  .lb-img { position: relative; background-color: var(--paper-2, #f5f5f7); background-size: contain; background-repeat: no-repeat; background-position: center; min-height: 320px;
    display: flex; align-items: center; justify-content: center; }
  .lb-body { padding: 24px 24px 26px; overflow-y: auto; }
  .lb-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lb-meta .picon { width: 18px; height: 18px; flex: 0 0 auto; }
  .lb-when { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ink-faint, #86868b); }
  .lb-cap { margin-top: 14px; font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; color: var(--ink, #1d1d1f); }
  .lb-extra { margin-top: 16px; }
  .lb-xh { font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: var(--ink-faint, #86868b); margin-bottom: 6px; }
  .lb-xt { font-size: 13.5px; line-height: 1.5; color: var(--ink, #1d1d1f); margin: 0; }
  .lb-xl { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
  .lb-xl li { font-size: 13.5px; line-height: 1.45; color: var(--ink, #1d1d1f); }
  @media (max-width: 640px) { .lb-card { grid-template-columns: 1fr; max-height: 88vh; overflow-y: auto; } }
</style>
