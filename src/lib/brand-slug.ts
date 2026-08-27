// Pure helpers for turning a brand name into a URL-safe, per-org-unique slug.

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip accent marks (é -> e)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'brand';
}

/**
 * Uno slug dal NOME, o dal sito quando il nome non lascia lettere latine.
 *
 * `slugify('يونس بن عمارة')` è `'brand'`: è il fallback condiviso, e in produzione lo unique
 * globale `brands_slug_key` lo rifiuta al secondo org. Il sito che l'utente ha appena analizzato
 * (`youdo.blog`) è un identificatore vero — meglio `youdo` che un `brand-x7k2` (o un hard-stop).
 */
export function slugifyBrand(name: string, website?: string | null): string {
  const fromName = slugify(name);
  if (fromName !== 'brand') return fromName;
  const fromSite = slugFromWebsite(website);
  return fromSite && fromSite !== 'brand' ? fromSite : fromName;
}

function slugFromWebsite(website?: string | null): string | null {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(href).hostname.replace(/^www\./i, '');
    const first = host.split('.')[0] ?? '';
    const s = slugify(first);
    return s === 'brand' ? null : s;
  } catch {
    return null;
  }
}

export function uniqueSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const TAIL_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const TAIL_LENGTH = 4;

export function slugWithRandomTail(base: string): string {
  let tail = '';
  for (let i = 0; i < TAIL_LENGTH; i++) {
    tail += TAIL_ALPHABET[Math.floor(Math.random() * TAIL_ALPHABET.length)];
  }
  return `${base}-${tail}`;
}
