<script lang="ts">
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { browser } from '$app/environment';

  let {
    value,
    format = (n: number) => Math.round(n).toLocaleString(),
    prefix = '',
    suffix = '',
    dash = '—',
    /**
     * When true, hold at 0 until this node enters the viewport, then count up.
     * Later value changes still tween. Off = animate changes only (no enter count-up).
     */
    enter = true
  }: {
    /** Target count; `null` shows `dash` once settled at 0. */
    value: number | null;
    format?: (n: number) => string;
    prefix?: string;
    suffix?: string;
    dash?: string;
    enter?: boolean;
  } = $props();

  const reduced =
    browser &&
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  let el = $state<HTMLElement | null>(null);
  // No enter anim / reduced motion → treat as already revealed.
  let revealed = $state(!enter || reduced);

  const tween = new Tween(enter && !reduced ? 0 : (value ?? 0), {
    duration: reduced
      ? 0
      : (from, to) => Math.min(520, 160 + Math.abs(to - from) * 12),
    easing: cubicOut
  });

  $effect(() => {
    if (!revealed) return;
    void tween.set(value == null ? 0 : value);
  });

  $effect(() => {
    if (!enter || reduced || !browser || !el) return;

    const node = el;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          revealed = true;
          io.disconnect();
        }
      },
      // Fire once a meaningful slice is on-screen (not just 1px peeking in).
      { threshold: 0.35, rootMargin: '0px 0px -6% 0px' }
    );
    io.observe(node);
    return () => io.disconnect();
  });

  // Keep showing the digit while it counts down to 0 so off/null feels like a decrement.
  const showDash = $derived(value == null && Math.round(tween.current) === 0);
</script>

<span bind:this={el} class="animated-num">
  {#if showDash}{dash}{:else}{prefix}{format(tween.current)}{suffix}{/if}
</span>

<style>
  .animated-num {
    font-variant-numeric: tabular-nums;
  }
</style>
