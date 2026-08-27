/**
 * Path della workbench del brand: dove un agente può mandare l'utente.
 *
 * Vive fuori da tools.ts perché ormai lo usano due superfici diverse — il bottone di conferma in
 * chat (`propose_open_tab`) e il link dentro le notifiche fuori dalla chat (`notify_user`, email +
 * push). Due copie della stessa allowlist significherebbero, prima o poi, due allowlist diverse.
 */

/** Primo segmento ammesso sotto /app/{slug}. */
const WORKBENCH_SEGMENTS = new Set([
  '',
  'content',
  'calendar',
  'plan',
  'campaigns',
  'studio',
  'knowledge',
  'media',
  'motion-video',
  'voice',
  'rubrics',
  'gtm',
  'analytics',
  'radar',
  'leads',
  'custom',
  'automations',
  'seo',
  'seo-geo',
  'geo',
  'citations',
  'library',
  'site',
  'settings',
  'strategy'
]);

export function resolveWorkbenchPath(raw: string, slug: string): { path: string; href: string } | null {
  let p = (raw || '').trim();
  if (!p) return null;
  const prefix = `/app/${slug}`;
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  if (p.startsWith(prefix)) p = p.slice(prefix.length) || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.includes('..') || p.includes('//')) return null;
  const lower = p.toLowerCase();
  if (lower.startsWith('/chat') || lower.includes('/activate') || lower.includes('/upgrade')) return null;
  const seg = p.replace(/^\//, '').split(/[/?#]/)[0] ?? '';
  if (!WORKBENCH_SEGMENTS.has(seg)) return null;
  const pathOnly = (p.split('?')[0] || '/') as string;
  const href = pathOnly === '/' ? prefix : `${prefix}${p.startsWith('/') ? p : `/${p}`}`;
  return { path: pathOnly === '/' ? '/' : pathOnly, href };
}
