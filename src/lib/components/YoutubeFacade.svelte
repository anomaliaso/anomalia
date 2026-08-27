<script lang="ts">
  // Lightweight YouTube embed: show a static poster until the user clicks play.
  // Avoids downloading ~1MB+ of youtube.com JS on every landing visit (huge TBT hit on mobile).
  let {
    videoId,
    title = 'YouTube video player',
    poster,
    /** When true, poster is a likely LCP candidate (landing hero video). */
    priority = false
  }: {
    videoId: string;
    title?: string;
    poster?: string;
    priority?: boolean;
  } = $props();

  let playing = $state(false);
  const posterSrc = $derived(poster ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
</script>

{#if playing}
  <iframe
    width="560"
    height="315"
    src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
    {title}
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
{:else}
  <button type="button" class="yt-facade" onclick={() => (playing = true)} aria-label={`Play: ${title}`}>
    <img
      src={posterSrc}
      alt=""
      width="720"
      height="405"
      decoding={priority ? 'sync' : 'async'}
      fetchpriority={priority ? 'high' : 'low'}
      loading={priority ? 'eager' : 'lazy'}
    />
    <span class="yt-play" aria-hidden="true">
      <svg viewBox="0 0 68 48" width="68" height="48">
        <path
          d="M66.52 7.42a8 8 0 0 0-5.63-5.66C55.57.72 34 0.72 34 0.72s-21.57 0-26.89 1.04A8 8 0 0 0 1.48 7.42 83.3 83.3 0 0 0 0 24a83.3 83.3 0 0 0 1.48 16.58 8 8 0 0 0 5.63 5.66C12.43 47.28 34 47.28 34 47.28s21.57 0 26.89-1.04a8 8 0 0 0 5.63-5.66A83.3 83.3 0 0 0 68 24a83.3 83.3 0 0 0-1.48-16.58Z"
          fill="red"
        />
        <path d="M45 24 27 14v20" fill="#fff" />
      </svg>
    </span>
  </button>
{/if}

<style>
  .yt-facade {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    cursor: pointer;
    background: #000;
    aspect-ratio: 16 / 9;
  }
  .yt-facade img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .yt-play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    transition: transform 0.15s ease;
  }
  .yt-facade:hover .yt-play,
  .yt-facade:focus-visible .yt-play {
    transform: scale(1.08);
  }
  :global(.video-wrap iframe) {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    border: 0;
  }
</style>
