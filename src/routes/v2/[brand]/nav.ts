const CALENDAR = '/calendar';

// L'ordine del mockup. Una voce entra qui il giorno che la sua pagina esiste: un link che dà 404
// è peggio di una superficie che manca, perché la fa sembrare rotta invece che non ancora scritta.
const NAV = [
  { label: 'Home', path: '' },
  { label: 'Materials', path: '/materials' },
  { label: 'Strategy', path: '/strategy' },
  { label: 'Calendar', path: CALENDAR },
  { label: 'Results', path: '/results' }
];

export const NAV_PATHS = NAV.map((item) => item.path);

export type NavEntry = { label: string; href: string; badge: number; current: boolean };

export function navFor(slug: string, pathname: string, pending: number): NavEntry[] {
  const base = `/v2/${slug}`;

  return NAV.map(({ label, path }) => {
    const href = `${base}${path}`;

    return {
      label,
      href,
      badge: path === CALENDAR ? pending : 0,
      current: path ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
    };
  });
}
