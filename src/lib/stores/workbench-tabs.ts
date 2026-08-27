import { writable, get } from 'svelte/store';

export type WorkbenchTab = {
  /** Stable id — usually pathname without trailing slash */
  id: string;
  /** Full path to navigate (may include query) */
  href: string;
  label: string;
};

const MAX_TABS = 12;

export const workbenchTabs = writable<WorkbenchTab[]>([]);
export const workbenchActiveId = writable<string | null>(null);

export function tabIdFromPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function openWorkbenchTab(tab: WorkbenchTab) {
  const id = tabIdFromPath(tab.id);
  workbenchTabs.update((tabs) => {
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      return tabs.map((t) => (t.id === id ? { ...t, href: tab.href, label: tab.label || t.label } : t));
    }
    const next = [...tabs, { ...tab, id }];
    return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
  });
  workbenchActiveId.set(id);
}

/** Close a tab. Returns the href to navigate to next, or null if none left. */
export function closeWorkbenchTab(id: string): string | null {
  const tabs = get(workbenchTabs);
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return get(workbenchActiveId) === id ? null : null;

  const nextTabs = tabs.filter((t) => t.id !== id);
  workbenchTabs.set(nextTabs);

  const active = get(workbenchActiveId);
  if (active !== id) return null;

  if (nextTabs.length === 0) {
    workbenchActiveId.set(null);
    return null;
  }
  const fallback = nextTabs[Math.min(idx, nextTabs.length - 1)];
  workbenchActiveId.set(fallback.id);
  return fallback.href;
}

export function clearWorkbenchTabs() {
  workbenchTabs.set([]);
  workbenchActiveId.set(null);
}

/** Reorder tabs by moving `fromId` to the index of `toId` (before it). */
export function reorderWorkbenchTabs(fromId: string, toId: string) {
  if (fromId === toId) return;
  workbenchTabs.update((tabs) => {
    const from = tabs.findIndex((t) => t.id === fromId);
    const to = tabs.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0 || from === to) return tabs;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}
