import { parseDesign, type Design } from '$lib/design/schema';

export type TemplateContent = {
  quote?: string;
  attribution?: string;
  stat?: string;
  label?: string;
  /** photo-overlay: the photographic layer (AI render, library asset, or upload). */
  imageUrl?: string;
  title?: string;
  kicker?: string;
};

export type BrandKitLike = {
  fonts?: unknown;
  brand_colors?: unknown;
};

function pickColors(kit: BrandKitLike): { fg: string; bg: string; muted: string } {
  const colors = Array.isArray(kit.brand_colors)
    ? kit.brand_colors.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
  return {
    fg: colors[0] ?? '#111111',
    bg: colors[1] ?? '#f4f1ea',
    muted: colors[2] ?? '#666666'
  };
}

function pickFont(kit: BrandKitLike, fallback = 'Inter'): string {
  if (!Array.isArray(kit.fonts)) return fallback;
  for (const f of kit.fonts) {
    if (typeof f === 'string' && f.trim()) return f.trim();
    if (f && typeof f === 'object') {
      const name = (f as { name?: string }).name ?? (f as { family?: string }).family;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return fallback;
}

/** Quote card: large text + attribution. */
export function quoteTemplate(kit: BrandKitLike, content: TemplateContent): Design {
  const { fg, bg, muted } = pickColors(kit);
  const font = pickFont(kit);
  return parseDesign({
    v: 1,
    aspect: '4:5',
    template: 'quote',
    slides: [
      {
        background: bg,
        layers: [
          {
            id: 'wash',
            type: 'gradient',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            from: bg,
            to: '#ffffff',
            angle: 165
          },
          {
            id: 'quote',
            type: 'text',
            name: 'quote',
            x: 0.08,
            y: 0.28,
            w: 0.84,
            h: 0.36,
            text: content.quote?.trim() || 'Your brand voice, composed.',
            font,
            weight: 700,
            size: 72,
            color: fg,
            align: 'left',
            lineHeight: 1.12,
            autoFit: true
          },
          {
            id: 'attr',
            type: 'text',
            name: 'attribution',
            x: 0.08,
            y: 0.72,
            w: 0.84,
            h: 0.08,
            text: content.attribution?.trim() || '— Brand',
            font,
            weight: 500,
            size: 28,
            color: muted,
            align: 'left',
            autoFit: true
          }
        ]
      }
    ]
  });
}

/** Big number + label. */
export function statTemplate(kit: BrandKitLike, content: TemplateContent): Design {
  const { fg, bg, muted } = pickColors(kit);
  const font = pickFont(kit);
  return parseDesign({
    v: 1,
    aspect: '4:5',
    template: 'stat',
    slides: [
      {
        background: bg,
        layers: [
          {
            id: 'panel',
            type: 'shape',
            shape: 'rect',
            x: 0.08,
            y: 0.22,
            w: 0.84,
            h: 0.56,
            fill: '#ffffff',
            radius: 24,
            opacity: 0.92
          },
          {
            id: 'stat',
            type: 'text',
            name: 'stat',
            x: 0.12,
            y: 0.3,
            w: 0.76,
            h: 0.28,
            text: content.stat?.trim() || '3×',
            font,
            weight: 700,
            size: 160,
            color: fg,
            align: 'center',
            autoFit: true
          },
          {
            id: 'label',
            type: 'text',
            name: 'label',
            x: 0.12,
            y: 0.6,
            w: 0.76,
            h: 0.1,
            text: content.label?.trim() || 'faster than a stock render',
            font,
            weight: 500,
            size: 32,
            color: muted,
            align: 'center',
            autoFit: true
          }
        ]
      }
    ]
  });
}

/**
 * Photo + scrim + title: the layout an AI photo post becomes once it is composable.
 * This is the only template that exercises ImageLayer — without it the layer ships unverified.
 * The scrim exists so the title stays legible over an arbitrary photo, which is exactly the
 * defect the composition agent is meant to catch and fix later.
 */
export function photoOverlayTemplate(kit: BrandKitLike, content: TemplateContent): Design {
  const { bg, muted } = pickColors(kit);
  const font = pickFont(kit);
  return parseDesign({
    v: 1,
    aspect: '4:5',
    template: 'photo-overlay',
    slides: [
      {
        background: bg,
        layers: [
          {
            id: 'photo',
            type: 'image',
            name: 'photo',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            src:
              content.imageUrl?.trim() ||
              // 1x1 transparent PNG: a missing photo must render an empty frame, never a broken
              // image that fails the whole still.
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            fit: 'cover'
          },
          {
            id: 'scrim',
            type: 'gradient',
            name: 'scrim',
            x: 0,
            y: 0.45,
            w: 1,
            h: 0.55,
            from: 'rgba(0,0,0,0)',
            to: 'rgba(0,0,0,0.72)',
            angle: 180
          },
          {
            id: 'kicker',
            type: 'text',
            name: 'kicker',
            x: 0.08,
            y: 0.7,
            w: 0.84,
            h: 0.06,
            text: content.kicker?.trim() || 'IN EVIDENZA',
            font,
            weight: 600,
            size: 24,
            color: muted,
            align: 'left',
            letterSpacing: 2,
            autoFit: true
          },
          {
            id: 'title',
            type: 'text',
            name: 'title',
            x: 0.08,
            y: 0.78,
            w: 0.84,
            h: 0.14,
            text: content.title?.trim() || 'Il titolo sopra la foto',
            font,
            weight: 700,
            size: 64,
            color: '#ffffff',
            align: 'left',
            lineHeight: 1.1,
            maxLines: 2,
            autoFit: true
          }
        ]
      }
    ]
  });
}
