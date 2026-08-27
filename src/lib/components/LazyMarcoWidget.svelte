<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { BOOKING_URL } from '$lib/links';

  // Chat/booking floater is never LCP-critical. Defer the JS+CSS chunk until idle so
  // MarcoWidget.*.css does not sit on the render-blocking critical path (PSI ~450ms).
  let { href = BOOKING_URL }: { href?: string } = $props();

  let Marco = $state<Component<any> | null>(null);

  onMount(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled || Marco) return;
      const mod = await import('$lib/components/MarcoWidget.svelte');
      if (!cancelled) Marco = mod.default;
    };

    const onInteract = () => {
      void load();
    };
    for (const e of ['scroll', 'pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(e, onInteract, { once: true, passive: true, capture: true });
    }

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(() => void load(), { timeout: 4000 });
      } else {
        timeoutId = setTimeout(() => void load(), 2500);
      }
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });

    return () => {
      cancelled = true;
      for (const e of ['scroll', 'pointerdown', 'keydown', 'touchstart'] as const) {
        window.removeEventListener(e, onInteract, { capture: true } as EventListenerOptions);
      }
      if (idleId !== undefined && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  });
</script>

{#if Marco}
  <Marco {href} />
{/if}
