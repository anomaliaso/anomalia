import { writable } from 'svelte/store';

export type WorkbenchTab = {
  /** Stable id — usually pathname without trailing slash */
  id: string;
  /** Full path to navigate (may include query) */
  href: string;
  label: string;
};

export const workbenchTabs = writable<WorkbenchTab[]>([]);
export const workbenchActiveId = writable<string | null>(null);

export function tabIdFromPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

