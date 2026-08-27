<script lang="ts">
  /**
   * One card on the wall.
   *
   * THE ANIMATION IS LOADED ON INTENT, NEVER UP FRONT. A grid of 36 cards where every animated WebP
   * downloads on page load is a 10MB page; the poster alone is a few hundred kilobytes for the whole
   * grid. So the `<img src>` for the preview is only set once the pointer enters the card (or the
   * card is tapped on touch), which means a visitor who scrolls past pays nothing for the movement
   * they never asked to see.
   *
   * It is an `<img>` and not a `<video>` on purpose — see the header of `wall-media.ts`: an image has
   * no autoplay policy to lose, and a grid where a third of the cards refuse to move looks broken.
   */
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import type { WallCard } from '$lib/wall';

  let {
    card,
    /** Shown on the trending wall, hidden on the design wall where the score is the story. */
    showMetric = false,
    eager = false
  }: { card: WallCard; showMetric?: boolean; eager?: boolean } = $props();

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  /** Set on first intent and never unset: re-downloading on every hover would be worse than keeping it. */
  let wantsPreview = $state(false);
  let previewReady = $state(false);

  const hasPreview = $derived(Boolean(card.previewUrl));

  function intent() {
    if (hasPreview) wantsPreview = true;
  }

  const metric = $derived(
    card.outperformance ? $_('wall.trending.metric', { values: { value: card.outperformance.toFixed(1) } }) : null
  );
</script>

<article
  class="wt"
  class:wt-playing={previewReady}
  onpointerenter={intent}
  onfocusin={intent}
  ontouchstart={intent}
>
  <a class="wt-link" href={lp(`/design/${card.slug}`)}>
    <span class="wt-frame">
      <img
        class="wt-poster"
        src={card.posterUrl}
        alt={card.caption ?? card.account ?? card.platform}
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : 'auto'}
        decoding="async"
      />
      {#if wantsPreview && card.previewUrl}
        <img
          class="wt-preview"
          src={card.previewUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          onload={() => (previewReady = true)}
        />
      {/if}
      {#if hasPreview}
        <span class="wt-badge" aria-hidden="true">GIF</span>
      {/if}
    </span>

    <span class="wt-meta">
      <span class="wt-account">{card.account ?? card.platform}</span>
      {#if showMetric && metric}
        <span class="wt-metric">{metric}</span>
      {:else if card.designScore != null}
        <span class="wt-score">{$_('wall.card.score', { values: { score: Math.round(card.designScore) } })}</span>
      {/if}
    </span>
    {#if card.note}
      <span class="wt-note">{card.note}</span>
    {/if}
  </a>
</article>

<style>
  .wt {
    break-inside: avoid;
    margin: 0 0 1.15rem;
  }
  .wt-link {
    display: block;
    color: inherit;
    text-decoration: none;
  }
  .wt-frame {
    position: relative;
    display: block;
    overflow: hidden;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    line-height: 0;
  }
  .wt-poster,
  .wt-preview {
    display: block;
    width: 100%;
    height: auto;
  }
  .wt-preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.18s ease;
  }
  .wt-playing .wt-preview {
    opacity: 1;
  }
  .wt-badge {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    font-weight: 700;
    line-height: 1.5;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    backdrop-filter: blur(6px);
  }
  .wt-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 0.55rem;
    font-size: 0.82rem;
  }
  .wt-account {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wt-metric,
  .wt-score {
    flex: none;
    font-variant-numeric: tabular-nums;
    opacity: 0.62;
  }
  .wt-note {
    display: block;
    margin-top: 0.2rem;
    font-size: 0.8rem;
    line-height: 1.45;
    opacity: 0.6;
  }
  .wt-link:hover .wt-frame {
    border-color: rgba(255, 255, 255, 0.22);
  }
  .wt-link:focus-visible .wt-frame {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
  /* Somebody who asked the system for less motion should not get a wall of loops. */
  @media (prefers-reduced-motion: reduce) {
    .wt-preview {
      display: none;
    }
  }
</style>
