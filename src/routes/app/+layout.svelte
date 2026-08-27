<script lang="ts">
  // Dashboard-only styling: Tailwind v4 + shadcn-svelte live here, scoped to /app so the
  // preflight/utilities never reach the hand-rolled marketing pages. The brand tokens
  // (colours, dark mode) come from app.css, already loaded by the root layout.
  import '$lib/styles/tailwind.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { loadGuestOnboarding } from '$lib/guest-onboarding';

  let { children } = $props();

  // Belt-and-suspenders: if OAuth/login dumped a returning user on /app/[brand] before the
  // guest cookie was read, bounce them into onboarding to finish website + socials analysis.
  onMount(() => {
    const path = $page.url.pathname;
    if (path === '/app/onboarding' || path.startsWith('/app/onboarding/')) return;
    const guest = loadGuestOnboarding();
    if (guest?.readyForAnalysis) {
      void goto('/app/onboarding');
    }
  });
</script>

{@render children()}
