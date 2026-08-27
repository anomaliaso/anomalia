import {
  SETTINGS_MODAL_DEFAULT,
  SETTINGS_MODAL_SECTIONS
} from '$lib/components/settings/platforms';
import { brandModalTarget } from '$lib/workbench-paths';

/**
 * Da un pathname al suffisso di rotta della SOVRAPPOSIZIONE (relativo a `/app/<slug>/`),
 * o null se quel path non ci vive dentro: `settings/profile` per le impostazioni,
 * `calendar` per le pagine del brand.
 *
 * Una definizione sola, perché i consumatori sono due e su superfici diverse: la modal
 * (desktop, `PageModal`) e il drawer del burger (mobile, `PageRailDrawer`). Le due
 * classificazioni vere restano dove stavano — `SETTINGS_MODAL_SECTIONS` in platforms.ts
 * e `brandModalTarget` in workbench-paths.ts: qui si sceglie solo quale delle due
 * interrogare.
 */
export function overlayRoute(pathname: string, base: string): string | null {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = pathname.replace(/\/$/, '');
  const settingsBase = `${b}/settings`;
  if (p === settingsBase) return `settings/${SETTINGS_MODAL_DEFAULT}`;
  if (p.startsWith(`${settingsBase}/`)) {
    const rest = p.slice(settingsBase.length + 1);
    return (SETTINGS_MODAL_SECTIONS as readonly string[]).includes(rest) ? `settings/${rest}` : null;
  }
  return brandModalTarget(p, b);
}

/** Quale delle due famiglie del rail: impostazioni o pagine del brand. */
export function isSettingsRoute(route: string | null): boolean {
  return !!route && route.startsWith('settings/');
}
