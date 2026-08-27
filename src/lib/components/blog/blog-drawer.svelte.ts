export interface TocItem { id: string; text: string; level: number }

let _drawerOpen = $state(false);
let _drawerToc = $state<TocItem[]>([]);

export function isDrawerOpen() { return _drawerOpen; }
export function getDrawerToc() { return _drawerToc; }

export let drawerScrollTo: ((id: string) => void) | null = null;

export function openDrawer() { _drawerOpen = true; }
export function closeDrawer() { _drawerOpen = false; }
export function setDrawerToc(items: TocItem[]) {
  _drawerToc = [...items];
}
export function setDrawerScrollTo(fn: (id: string) => void) {
  drawerScrollTo = fn;
}
