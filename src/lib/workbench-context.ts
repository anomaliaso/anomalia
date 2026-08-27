import { get } from 'svelte/store';
import { page } from '$app/stores';
import { _ } from 'svelte-i18n';
import { workbenchTabs, workbenchActiveId } from '$lib/stores/workbench-tabs';
import { workbenchTabLabel } from '$lib/workbench-paths';

export type WorkbenchContextPayload = {
  activeHref: string;
  activeLabel: string;
  tabs: Array<{ href: string; label: string }>;
};

/** Snapshot of open workbench tabs + active page for the chat system prompt. */
export function snapshotWorkbench(brandSlug: string): WorkbenchContextPayload {
  const p = get(page);
  const base = `/app/${brandSlug}`;
  const tFn = get(_);
  const tabs = get(workbenchTabs);
  const activeId = get(workbenchActiveId);
  const activeTab = tabs.find((x) => x.id === activeId);
  const pathHref = `${p.url.pathname}${p.url.search || ''}`;
  const activeHref = activeTab?.href ?? pathHref;
  const activeLabel =
    activeTab?.label ?? workbenchTabLabel(p.url.pathname, base, (k) => String(tFn(k)));
  return {
    activeHref,
    activeLabel,
    tabs: tabs.map((tab) => ({ href: tab.href, label: tab.label }))
  };
}
