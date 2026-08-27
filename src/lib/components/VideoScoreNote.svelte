<script lang="ts">
  import { _ } from 'svelte-i18n';
  import {
    formatVideoScore,
    videoScoreTone,
    type ReviewChatKind,
    type VideoScoreBadge
  } from '$lib/video-score';

  let {
    badge,
    video = false,
    disabled = false,
    chipsOnly = false,
    onprompt
  }: {
    badge: VideoScoreBadge;
    video?: boolean;
    disabled?: boolean;
    chipsOnly?: boolean;
    onprompt: (kind: ReviewChatKind) => void;
  } = $props();

  const tone = $derived(videoScoreTone(badge));
  const score = $derived(formatVideoScore(badge.overall ?? 0));
  const verdict = $derived(badge.verdict ? $_('app.videoReview.' + badge.verdict) : '');
  const ready = $derived(badge.status === 'ready' && badge.overall != null);
</script>

{#if ready}
  <div class="vr-note" class:chips={chipsOnly} data-tone={tone}>
    {#if !chipsOnly}
      <div class="vr-head">
        <span class="vr-score">{score}/10</span>
        {#if verdict}<span class="vr-verdict">{verdict}</span>{/if}
      </div>
      {#if badge.judgment}
        <p class="vr-block">
          <span class="vr-k">{$_('posteditor.review.why')}</span>
          {badge.judgment}
        </p>
      {/if}
      {#if badge.nextTest}
        <p class="vr-block">
          <span class="vr-k">{$_('posteditor.review.improve')}</span>
          {badge.nextTest}
        </p>
      {:else if badge.issues?.[0]?.fix}
        <p class="vr-block">
          <span class="vr-k">{$_('posteditor.review.improve')}</span>
          {badge.issues[0].fix}
        </p>
      {/if}
    {/if}
    <div class="vr-chips">
      <button type="button" class="vr-chip" disabled={disabled} onclick={() => onprompt('apply')}>
        {$_('posteditor.review.chipApply')}
      </button>
      {#if video}
        <button type="button" class="vr-chip" disabled={disabled} onclick={() => onprompt('hook')}>
          {$_('posteditor.review.chipHook')}
        </button>
        <button type="button" class="vr-chip" disabled={disabled} onclick={() => onprompt('reel')}>
          {$_('posteditor.review.chipReel')}
        </button>
      {:else}
        <button type="button" class="vr-chip" disabled={disabled} onclick={() => onprompt('visual')}>
          {$_('posteditor.review.chipVisual')}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .vr-note {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 13px 11px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 14px;
    background: var(--paper-2, #f5f5f7);
    border-left: 3px solid rgba(0, 0, 0, 0.18);
  }
  .vr-note[data-tone='ship'] { border-left-color: #3d9a5f; }
  .vr-note[data-tone='fix'] { border-left-color: #d4a017; }
  .vr-note[data-tone='kill'] { border-left-color: #e0564a; }
  .vr-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vr-score { font-size: 13px; font-weight: 800; letter-spacing: -0.03em; color: var(--ink, #1d1d1f); }
  .vr-verdict {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--ink-soft, #6e6e73);
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 999px;
    padding: 1px 8px;
  }
  .vr-note[data-tone='ship'] .vr-verdict { color: #2f7d4a; border-color: #c8e6d2; background: #ecf8f0; }
  .vr-note[data-tone='fix'] .vr-verdict { color: #9a7a10; border-color: #ead89a; background: #fbf6e4; }
  .vr-note[data-tone='kill'] .vr-verdict { color: #c0392b; border-color: #f0c7c2; background: #fde8e6; }
  .vr-block {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink, #1d1d1f);
  }
  .vr-k {
    display: block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint, #86868b);
    margin-bottom: 2px;
  }
  .vr-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
  .vr-chip {
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    color: var(--ink-soft, #6e6e73);
    background: var(--paper, #fff);
    border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 999px;
    padding: 5px 11px;
    cursor: pointer;
  }
  .vr-chip:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .vr-chip:disabled { opacity: 0.45; cursor: default; }
  .vr-note.chips {
    padding: 0;
    border: none;
    background: none;
    border-left: none;
  }
</style>
