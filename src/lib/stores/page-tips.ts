import { writable } from 'svelte/store';

export type PageTip = {
  id: string;
  text: string;
  cta?: string;
  href?: string;
  action?: string; // form action name (e.g. 'refresh90d')
};

/** Store for page-specific tips. Each page sets its own tips; the floating bubble reads them. */
export const pageTips = writable<PageTip[]>([]);
