<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { browser } from '$app/environment';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';

  type VideoStandard = 'organic' | 'ads';
  type VideoReview = {
    verdict: 'ship' | 'fix' | 'kill';
    overall: number;
    doomscroll: { stops: boolean; who: string; reason: string };
    hook: { at_s: number; line: string; visual: string };
    scores: Record<string, number | undefined>;
    issues: Array<{ severity: string; problem: string; fix: string }>;
    next_test: string;
    summary: string;
    judgment?: string;
    script?: { spoken?: string; on_screen?: string; caption?: string };
    research?: { tools?: string[]; notes?: string[] };
  };

  let {
    url,
    brandSlug,
    defaultStandard = 'organic',
    product = '',
    caption = '',
    compact = false
  }: {
    url: string;
    brandSlug: string;
    defaultStandard?: VideoStandard;
    product?: string;
    caption?: string;
    compact?: boolean;
  } = $props();

  let standard = $state<VideoStandard>(defaultStandard);
  let loading = $state(false);
  let error = $state('');
  /** Crediti finiti: il testo da solo non dice dove andare. */
  let errorExhausted = $state(false);
  let review = $state<VideoReview | null>(null);

  $effect(() => {
    const u = url;
    const std = standard;
    const slug = brandSlug;
    if (!browser || !u || !slug) return;
    let stopped = false;
    void (async () => {
      try {
        const q = new URLSearchParams({ url: u, standard: std });
        const res = await fetch(`/app/${slug}/videos/review?${q}`);
        const data = (await res.json().catch(() => ({}))) as { review?: VideoReview | null };
        if (!stopped && data.review) review = data.review;
      } catch {
        /* cache miss is fine */
      }
    })();
    return () => {
      stopped = true;
    };
  });

  const DIM_ORDER = $derived(
    standard === 'ads'
      ? [
          'scroll_stop',
          'sound_off',
          'hold',
          'authenticity',
          'anatomy',
          'structure',
          'spoken_craft',
          'audience_signal',
          'proof',
          'offer',
          'uniqueness',
          'claims_safe'
        ]
      : [
          'scroll_stop',
          'sound_off',
          'hold',
          'authenticity',
          'anatomy',
          'structure',
          'spoken_craft',
          'cta_soft',
          'loop_worthiness'
        ]
  );

  async function run() {
    if (!url || loading) return;
    loading = true;
    error = '';
    errorExhausted = false;
    review = null;
    try {
      const res = await fetch(`/app/${brandSlug}/videos/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          standard,
          product: product || undefined,
          caption: caption || undefined
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        review?: VideoReview;
        error?: string;
      };
      if (!res.ok || !data.review) {
        errorExhausted = data.error === 'credits_exhausted' || res.status === 402;
        error =
          data.error === 'credits_exhausted'
            ? $_('app.videoReview.credits')
            : data.error === 'fetch_failed'
              ? $_('app.videoReview.fetchFailed')
              : $_('app.videoReview.error');
        return;
      }
      review = data.review;
    } catch {
      error = $_('app.videoReview.error');
    } finally {
      loading = false;
    }
  }
</script>

<div class="vr" class:compact>
  <div class="vr-bar">
    <div class="vr-seg" role="group" aria-label={$_('app.videoReview.standard')}>
      <button type="button" class:on={standard === 'organic'} onclick={() => (standard = 'organic')}>
        {$_('app.videoReview.organic')}
      </button>
      <button type="button" class:on={standard === 'ads'} onclick={() => (standard = 'ads')}>
        {$_('app.videoReview.ads')}
      </button>
    </div>
    <button type="button" class="vr-run" disabled={loading || !url} onclick={() => void run()}>
      {loading ? $_('app.videoReview.running') : $_('app.videoReview.run')}
    </button>
  </div>

  {#if error}
    <p class="vr-err">{error}{#if errorExhausted}{' '}<UpgradeLink />{/if}</p>
  {/if}

  {#if review}
    <div class="vr-head">
      <span class="vr-verdict" data-v={review.verdict}>{$_(`app.videoReview.${review.verdict}`)}</span>
      <span class="vr-overall">{review.overall}<small>/10</small></span>
      <span class="vr-doom" data-stop={review.doomscroll.stops}>
        {review.doomscroll.stops ? $_('app.videoReview.stops') : $_('app.videoReview.scrolls')}
      </span>
    </div>
    {#if review.doomscroll.reason}
      <p class="vr-reason">{review.doomscroll.reason}</p>
    {/if}
    {#if review.hook.line || review.hook.visual}
      <p class="vr-hook">
        <strong>{$_('app.videoReview.hook')}</strong>
        {review.hook.line || review.hook.visual}
        {#if review.hook.at_s}
          <span class="vr-t">{review.hook.at_s.toFixed(1)}s</span>
        {/if}
      </p>
    {/if}

    <ul class="vr-dims">
      {#each DIM_ORDER as id (id)}
        {@const score = review.scores[id as keyof typeof review.scores]}
        {#if score != null}
          <li>
            <span class="vr-dim-lab">{$_(`app.videoReview.dim.${id}`)}</span>
            <span class="vr-bar-track" aria-hidden="true">
              <span class="vr-bar-fill" style="width: {score * 10}%" data-s={score}></span>
            </span>
            <span class="vr-dim-n">{score}</span>
          </li>
        {/if}
      {/each}
    </ul>

    {#if review.issues.length}
      <ul class="vr-issues">
        {#each review.issues as issue, i (i)}
          <li data-sev={issue.severity}>
            <strong>{issue.problem}</strong>
            {#if issue.fix}
              <span>{issue.fix}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if review.next_test}
      <p class="vr-next"><strong>{$_('app.videoReview.nextTest')}</strong> {review.next_test}</p>
    {/if}
    {#if review.summary}
      <p class="vr-sum">{review.summary}</p>
    {/if}
    {#if review.judgment && review.judgment !== review.summary}
      <p class="vr-sum">{review.judgment}</p>
    {/if}
    {#if review.script?.spoken || review.script?.on_screen}
      <div class="vr-script">
        {#if review.script.spoken}
          <p><strong>{$_('app.videoReview.spoken')}</strong> {review.script.spoken}</p>
        {/if}
        {#if review.script.on_screen}
          <p><strong>{$_('app.videoReview.onScreen')}</strong> {review.script.on_screen}</p>
        {/if}
      </div>
    {/if}
    {#if review.research?.notes?.length}
      <p class="vr-research">
        <strong>{$_('app.videoReview.research')}</strong>
        {review.research.notes.join(' · ')}
      </p>
    {/if}
  {/if}
</div>

<style>
  .vr {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    color: inherit;
    font-size: 13px;
    line-height: 1.45;
  }
  .vr-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .vr-seg {
    display: inline-flex;
    border: 1px solid var(--line, rgba(255, 255, 255, 0.2));
    border-radius: 10px;
    overflow: hidden;
  }
  .vr-seg button {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .vr-seg button.on {
    background: var(--accent, #5b4cff);
    color: #fff;
  }
  .vr-run {
    appearance: none;
    border: 1px solid var(--line, rgba(255, 255, 255, 0.24));
    background: var(--paper, rgba(255, 255, 255, 0.1));
    color: inherit;
    border-radius: 10px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }
  .vr-run:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .vr-err {
    margin: 0;
    color: #f87171;
  }
  .vr-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }
  .vr-verdict {
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
  }
  .vr-verdict[data-v='ship'] {
    background: #16a34a;
    color: #fff;
  }
  .vr-verdict[data-v='fix'] {
    background: #d97706;
    color: #fff;
  }
  .vr-verdict[data-v='kill'] {
    background: #dc2626;
    color: #fff;
  }
  .vr-overall {
    font-weight: 750;
    font-size: 18px;
  }
  .vr-overall small {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.7;
  }
  .vr-doom {
    font-size: 12px;
    font-weight: 650;
  }
  .vr-doom[data-stop='true'] {
    color: #4ade80;
  }
  .vr-doom[data-stop='false'] {
    color: #f87171;
  }
  .vr-reason,
  .vr-hook,
  .vr-next,
  .vr-sum,
  .vr-research,
  .vr-script p {
    margin: 0;
    opacity: 0.92;
  }
  .vr-script {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(127, 127, 127, 0.12);
    white-space: pre-wrap;
  }
  .vr-t {
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
  .vr-dims {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 5px;
  }
  .vr-dims li {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(48px, 1fr) 22px;
    align-items: center;
    gap: 8px;
  }
  .vr-dim-lab {
    font-size: 11.5px;
    opacity: 0.85;
  }
  .vr-bar-track {
    display: block;
    height: 6px;
    border-radius: 99px;
    background: rgba(127, 127, 127, 0.25);
    overflow: hidden;
  }
  .vr-bar-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #4ade80;
  }
  .vr-bar-fill[data-s='1'],
  .vr-bar-fill[data-s='2'],
  .vr-bar-fill[data-s='3'] {
    background: #f87171;
  }
  .vr-bar-fill[data-s='4'],
  .vr-bar-fill[data-s='5'],
  .vr-bar-fill[data-s='6'] {
    background: #fbbf24;
  }
  .vr-dim-n {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    text-align: right;
  }
  .vr-issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .vr-issues li {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(127, 127, 127, 0.12);
  }
  .vr-issues li[data-sev='critical'] {
    background: rgba(220, 38, 38, 0.18);
  }
  .vr-issues li span {
    opacity: 0.85;
    font-size: 12.5px;
  }
</style>
