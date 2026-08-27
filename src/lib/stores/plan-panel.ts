import { writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { SHELL_MOBILE_BREAKPOINT } from '$lib/hooks/is-mobile.svelte';

export type PlanPanelState = { brandSlug: string; planId: string } | null;

/** Desktop-only: plan document open in the right overlay panel. */
export const planPanel = writable<PlanPanelState>(null);

export function openPlanPanel(brandSlug: string, planId: string) {
  planPanel.set({ brandSlug, planId });
}

export function closePlanPanel() {
  // Avoid notifying subscribers when already closed (effects that call this on every run).
  planPanel.update((cur) => (cur === null ? cur : null));
}

/**
 * Open a chat plan document:
 * - mobile → full page with `?from=` for back navigation
 * - desktop → right overlay panel (stay on current URL)
 */
export function openPlanDocument(opts: {
  brandSlug: string;
  planId: string;
  /** Optional prebuilt href; `from` is appended on mobile. */
  href?: string;
}) {
  const href = opts.href ?? `/app/${opts.brandSlug}/plans/${opts.planId}`;
  const mobile =
    typeof window !== 'undefined' &&
    window.matchMedia(`(max-width: ${SHELL_MOBILE_BREAKPOINT - 1}px)`).matches;

  if (mobile) {
    closePlanPanel();
    const from = `${window.location.pathname}${window.location.search}`;
    const url = new URL(href, window.location.origin);
    if (from.startsWith(`/app/${opts.brandSlug}`)) {
      url.searchParams.set('from', from);
    }
    void goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
    return;
  }

  openPlanPanel(opts.brandSlug, opts.planId);
}
