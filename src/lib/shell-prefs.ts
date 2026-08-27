/** Persistent shell layout prefs (sidebar + chat/workbench split). Browser localStorage. */

export const SHELL_PREF_KEYS = {
  sidebarOpen: 'anomalia.sidebarOpen',
  sidebarPanePx: 'anomalia.sidebarPanePx',
  chatPanePx: 'anomalia.chatPanePx',
  workbenchCollapsed: 'anomalia.workbenchCollapsed',
  chatCollapsed: 'anomalia.chatCollapsed'
} as const;

/** Cookie kept in sync so SSR / first paint can match the sidebar open state. */
export const SIDEBAR_OPEN_COOKIE = 'sidebar_state';
export const SIDEBAR_OPEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Last brand slug visited — used by `/app` to resume the right project after login. */
export const LAST_BRAND_COOKIE = 'anomalia_last_brand';
export const LAST_BRAND_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const CHAT_W_DEFAULT = 340;
const CHAT_W_MIN = 280;
const SIDEBAR_W_DEFAULT = 280;
const SIDEBAR_W_MIN = 220;
const SIDEBAR_W_MAX = 420;

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readRaw(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAge: number) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function readSidebarOpen(fallback = true): boolean {
  const ls = readRaw(SHELL_PREF_KEYS.sidebarOpen);
  if (ls === '0' || ls === 'false') return false;
  if (ls === '1' || ls === 'true') return true;
  const cookie = readCookie(SIDEBAR_OPEN_COOKIE);
  if (cookie === 'false' || cookie === 'true') {
    const open = cookie === 'true';
    // One-time migrate cookie → localStorage
    writeRaw(SHELL_PREF_KEYS.sidebarOpen, open ? 'true' : 'false');
    return open;
  }
  return fallback;
}

export function writeSidebarOpen(open: boolean) {
  writeRaw(SHELL_PREF_KEYS.sidebarOpen, open ? 'true' : 'false');
  writeCookie(SIDEBAR_OPEN_COOKIE, open ? 'true' : 'false', SIDEBAR_OPEN_COOKIE_MAX_AGE);
}

export function readSidebarPanePx(): number {
  const n = Number(readRaw(SHELL_PREF_KEYS.sidebarPanePx));
  if (!Number.isFinite(n)) return SIDEBAR_W_DEFAULT;
  return Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, Math.round(n)));
}

export function writeSidebarPanePx(px: number) {
  writeRaw(SHELL_PREF_KEYS.sidebarPanePx, String(Math.round(px)));
}

export function readChatPanePx(): number {
  const n = Number(readRaw(SHELL_PREF_KEYS.chatPanePx));
  if (!Number.isFinite(n) || n < CHAT_W_MIN) return CHAT_W_DEFAULT;
  return Math.round(n);
}

export function writeChatPanePx(px: number) {
  writeRaw(SHELL_PREF_KEYS.chatPanePx, String(Math.round(px)));
}

export function readWorkbenchCollapsed(): boolean {
  const v = readRaw(SHELL_PREF_KEYS.workbenchCollapsed);
  return v === '1' || v === 'true';
}

export function writeWorkbenchCollapsed(collapsed: boolean) {
  writeRaw(SHELL_PREF_KEYS.workbenchCollapsed, collapsed ? 'true' : 'false');
}

export function readChatCollapsed(): boolean {
  const v = readRaw(SHELL_PREF_KEYS.chatCollapsed);
  return v === '1' || v === 'true';
}

export function writeChatCollapsed(collapsed: boolean) {
  writeRaw(SHELL_PREF_KEYS.chatCollapsed, collapsed ? 'true' : 'false');
}

export const SHELL_LAYOUT = {
  CHAT_W_DEFAULT,
  CHAT_W_MIN,
  SIDEBAR_W_DEFAULT,
  SIDEBAR_W_MIN,
  SIDEBAR_W_MAX
} as const;
