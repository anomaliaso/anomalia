import * as Lucide from 'lucide-static';
import * as SimpleIcons from 'simple-icons';
import {
  siOpenai,
  siMicrosoftbing,
  siExa,
  siGrok,
  siMicrosoftcopilot,
  type BrandIcon
} from '$lib/simple-icons-extra';

/**
 * Resolve an icon name for typographic graphics.
 *
 * Sources (in `auto` order):
 *  1. Built-in aliases (check → Lucide Check, …)
 *  2. Lucide Static — UI marks (`arrow-right`, `sparkles`, PascalCase also accepted)
 *  3. Simple Icons — brand marks by slug (`instagram`, `tiktok`, …)
 *  4. Extra brand marks we keep locally (OpenAI, Grok, …)
 *
 * Returns an SVG string ready to embed as a data-URI `<img>` for satori — never freeform SVG
 * from the model.
 */

export type GraphicIconSet = 'auto' | 'lucide' | 'simple';

export type ResolvedGraphicIcon = {
  /** Full SVG markup with colour already applied. */
  svg: string;
  source: 'lucide' | 'simple-icons' | 'extra';
  title: string;
  /** Brand hex from Simple Icons / extras when available. */
  brandHex?: string;
};

const EXTRA_BY_SLUG: Record<string, BrandIcon> = {
  openai: siOpenai,
  chatgpt: siOpenai,
  microsoftbing: siMicrosoftbing,
  bing: siMicrosoftbing,
  exa: siExa,
  grok: siGrok,
  xai: siGrok,
  microsoftcopilot: siMicrosoftcopilot,
  copilot: siMicrosoftcopilot
};

/** Short aliases the art-direction model is likely to emit. */
const ALIASES: Record<string, { set: 'lucide' | 'simple'; name: string }> = {
  check: { set: 'lucide', name: 'check' },
  tick: { set: 'lucide', name: 'check' },
  star: { set: 'lucide', name: 'star' },
  arrow: { set: 'lucide', name: 'arrow-right' },
  'arrow-right': { set: 'lucide', name: 'arrow-right' },
  quote: { set: 'lucide', name: 'quote' },
  spark: { set: 'lucide', name: 'sparkles' },
  sparkles: { set: 'lucide', name: 'sparkles' },
  heart: { set: 'lucide', name: 'heart' },
  bolt: { set: 'lucide', name: 'zap' },
  zap: { set: 'lucide', name: 'zap' },
  plus: { set: 'lucide', name: 'plus' },
  dot: { set: 'lucide', name: 'circle' },
  circle: { set: 'lucide', name: 'circle' },
  x: { set: 'simple', name: 'x' },
  twitter: { set: 'simple', name: 'x' },
  ig: { set: 'simple', name: 'instagram' },
  fb: { set: 'simple', name: 'facebook' },
  linkedin: { set: 'simple', name: 'linkedin' },
  yt: { set: 'simple', name: 'youtube' },
  youtube: { set: 'simple', name: 'youtube' }
};

let simpleBySlug: Map<string, { title: string; hex: string; path: string; paths?: string[]; viewBox?: string }> | null =
  null;

function buildSimpleIndex() {
  if (simpleBySlug) return simpleBySlug;
  const map = new Map<string, { title: string; hex: string; path: string; paths?: string[]; viewBox?: string }>();
  for (const v of Object.values(SimpleIcons) as unknown[]) {
    if (!v || typeof v !== 'object') continue;
    const icon = v as { slug?: string; title?: string; hex?: string; path?: string };
    if (typeof icon.slug === 'string' && typeof icon.path === 'string' && typeof icon.hex === 'string') {
      map.set(icon.slug.toLowerCase(), {
        title: icon.title ?? icon.slug,
        hex: icon.hex,
        path: icon.path
      });
    }
  }
  for (const [slug, icon] of Object.entries(EXTRA_BY_SLUG)) {
    map.set(slug, {
      title: icon.title,
      hex: icon.hex,
      path: icon.path ?? '',
      paths: icon.paths,
      viewBox: icon.viewBox
    });
  }
  simpleBySlug = map;
  return map;
}

function kebab(s: string): string {
  return s
    .trim()
    .replace(/^si/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function pascal(kebabName: string): string {
  return kebabName
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function lucideSvg(name: string): { svg: string; title: string } | null {
  const key = pascal(kebab(name));
  const raw = (Lucide as Record<string, unknown>)[key];
  if (typeof raw !== 'string' || !raw.includes('<svg')) return null;
  return { svg: raw, title: key };
}

function colourLucide(svg: string, color: string): string {
  // Lucide ships stroke="currentColor"; swap to the palette colour and keep fill none.
  return svg
    .replace(/\bstroke="currentColor"/g, `stroke="${color}"`)
    .replace(/\bclass="[^"]*"/g, '')
    .replace(/\bwidth="24"/, 'width="100%"')
    .replace(/\bheight="24"/, 'height="100%"');
}

function simpleSvg(
  icon: { title: string; hex: string; path: string; paths?: string[]; viewBox?: string },
  color: string
): string {
  const vb = icon.viewBox ?? '0 0 24 24';
  const paths =
    icon.paths?.length
      ? icon.paths.map((d) => `<path fill="${color}" d="${d}"/>`).join('')
      : `<path fill="${color}" d="${icon.path}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%">${paths}</svg>`;
}

export function resolveGraphicIcon(
  name: string,
  color: string,
  opts: { set?: GraphicIconSet; brandColor?: boolean } = {}
): ResolvedGraphicIcon | null {
  const raw = name.trim();
  if (!raw) return null;
  const set = opts.set ?? 'auto';
  const aliased = ALIASES[kebab(raw)];
  const want = aliased ? aliased.name : kebab(raw);
  const prefer = aliased?.set;

  const tryLucide = () => {
    const hit = lucideSvg(want);
    if (!hit) return null;
    return {
      svg: colourLucide(hit.svg, color),
      source: 'lucide' as const,
      title: hit.title
    };
  };

  const trySimple = () => {
    const map = buildSimpleIndex();
    const icon = map.get(want) ?? map.get(kebab(raw));
    if (!icon || (!icon.path && !icon.paths?.length)) return null;
    const hex = opts.brandColor !== false && icon.hex ? `#${icon.hex.replace(/^#/, '')}` : color;
    const isExtra = want in EXTRA_BY_SLUG || kebab(raw) in EXTRA_BY_SLUG;
    return {
      svg: simpleSvg(icon, hex),
      source: (isExtra ? 'extra' : 'simple-icons') as 'extra' | 'simple-icons',
      title: icon.title,
      brandHex: `#${icon.hex.replace(/^#/, '')}`
    };
  };

  if (set === 'lucide' || prefer === 'lucide') {
    return tryLucide() ?? (set === 'auto' ? trySimple() : null);
  }
  if (set === 'simple' || prefer === 'simple') {
    return trySimple() ?? (set === 'auto' ? tryLucide() : null);
  }
  // auto: Lucide first for UI verbs, then Simple Icons for brand slugs
  return tryLucide() ?? trySimple();
}

/** Encode a resolved icon as a data-URI suitable for satori `<img src>`. */
export function iconDataUri(resolved: ResolvedGraphicIcon): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolved.svg)}`;
}
