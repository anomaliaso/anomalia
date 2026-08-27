import {
  graphicSize,
  paletteFor,
  resolveFill,
  scale,
  IMAGE_SIZE_PCT,
  type Block,
  type Graphic,
  type Palette
} from './blocks';
import { iconDataUri, resolveGraphicIcon } from './graphic-icons';

/**
 * Turn a Graphic spec into the element tree satori rasterises.
 *
 * Plain objects, not JSX: satori accepts React-element-SHAPED objects, so building them by hand
 * keeps this module importable from server code with no React runtime and no .tsx in the SSR graph.
 *
 * Flexbox only — no absolute positioning anywhere. That is the invariant the whole design rests on
 * (see blocks.ts): the layout engine decides where things go, so a model that picked the wrong block
 * order gets an ugly graphic, never a broken one. It is also, not by coincidence, the subset satori
 * implements, so the same tree renders on a server with no browser.
 *
 * Image `src` values must already be data URIs by the time this runs — design-render fetches remote
 * URLs first. Icons resolve here via Lucide / Simple Icons → SVG data URI.
 */

export type El = {
  type: string;
  props: {
    style: Record<string, unknown>;
    children?: El | El[] | string;
    src?: string;
    width?: number | string;
    height?: number | string;
  };
};

const el = (
  style: Record<string, unknown>,
  children?: El | El[] | string,
  type = 'div',
  extra: Partial<El['props']> = {}
): El => ({ type, props: { style, children, ...extra } });

/** A flex column is the default container; satori needs `display` stated on every one. */
const col = (style: Record<string, unknown>, children?: El | El[] | string) =>
  el({ display: 'flex', flexDirection: 'column', ...style }, children);

const row = (style: Record<string, unknown>, children?: El | El[] | string) =>
  el({ display: 'flex', flexDirection: 'row', ...style }, children);

/**
 * Satori has no `<br>` and its `pre-wrap` support is not worth relying on, so an explicit newline
 * becomes its own line box. The model uses this to break a headline where the break means something.
 */
const lines = (text: string, style: Record<string, unknown>): El[] =>
  text
    // A model asked for "\n" often emits the two characters backslash-n rather than a newline —
    // verified live, it rendered "Il nostro va\naspettato" on the canvas. Both mean "break here".
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => el({ display: 'flex', ...style }, line));

/**
 * Headline size steps down as the text gets longer. Satori wraps, but a 130-character headline set
 * at the display size would wrap past the canvas — and there is no measurement available here to
 * discover that. Three steps tuned against the reference set.
 * ponytail: character-count heuristic, not metrics. If a brand font runs much wider than Inter and
 * long headlines start touching the edges, lower these percentages rather than adding a measurer.
 */
function headlinePct(text: string): number {
  const n = text.replace(/\s+/g, ' ').length;
  if (n > 72) return 5.8;
  if (n > 42) return 7.1;
  return 8.4;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const RADIUS_PCT = { none: 0, sm: 1.2, md: 2.4, full: 50 } as const;
const MARK_SIZE_PCT = { sm: 4.5, md: 6.5, lg: 9 } as const;

export type Fonts = { display: string; body: string };

function blockEl(block: Block, w: number, contentW: number, p: Palette, fonts: Fonts): El | null {
  const s = (pct: number) => scale(w, pct);
  // The display face carries the lines people stop on; everything else stays in the body face.
  const display = { fontFamily: fonts.display };

  switch (block.type) {
    case 'kicker':
      return el(
        {
          display: 'flex',
          fontSize: s(2.5),
          fontWeight: 600,
          letterSpacing: s(2.5) * 0.16,
          textTransform: 'uppercase',
          color: p.faint
        },
        block.text
      );

    case 'headline': {
      const size = s(headlinePct(block.text));
      return col(
        { color: p.ink },
        lines(block.text, {
          ...display,
          fontSize: size,
          fontWeight: 400,
          letterSpacing: size * -0.038,
          lineHeight: 1.04
        })
      );
    }

    case 'body':
      return el(
        { display: 'flex', fontSize: s(3.4), lineHeight: 1.4, color: p.soft, letterSpacing: s(3.4) * -0.008 },
        block.text
      );

    case 'list':
      return col(
        { gap: s(2.2) },
        block.items.map((item, i) =>
          row(
            { alignItems: 'center', gap: s(2.2), fontSize: s(3.1), color: p.ink },
            block.marker === 'number'
              ? [
                  el(
                    {
                      display: 'flex',
                      color: p.faint,
                      fontWeight: 500,
                      width: s(3.4),
                      flexShrink: 0
                    },
                    String(i + 1)
                  ),
                  el({ display: 'flex' }, item)
                ]
              : [
                  el(
                    {
                      display: 'flex',
                      width: s(1.9),
                      height: s(1.9),
                      borderRadius: s(1.9),
                      backgroundColor: p.accent,
                      flexShrink: 0
                    },
                    ''
                  ),
                  el({ display: 'flex' }, item)
                ]
          )
        )
      );

    case 'stat':
      return col({ gap: s(1.6) }, [
        el(
          {
            ...display,
            display: 'flex',
            fontSize: s(20),
            fontWeight: 400,
            letterSpacing: s(20) * -0.05,
            lineHeight: 1,
            color: p.ink
          },
          block.value
        ),
        ...(block.label ? [el({ display: 'flex', fontSize: s(3.2), color: p.soft }, block.label)] : [])
      ]);

    case 'quote':
      return col({ gap: s(3) }, [
        el(
          {
            ...display,
            display: 'flex',
            fontSize: s(6),
            fontWeight: 400,
            letterSpacing: s(6) * -0.03,
            lineHeight: 1.16,
            color: p.ink
          },
          block.text
        ),
        ...(block.attribution
          ? [el({ display: 'flex', fontSize: s(3), color: p.soft }, `— ${block.attribution}`)]
          : [])
      ]);

    case 'grid': {
      // Satori implements flexbox but not grid, so the 3-across grid is rows of flex cells and the
      // 1px gaps are the container's own background showing through.
      const rows = chunk(block.items, 3);
      const cellW = (contentW - 2) / 3;
      return col(
        { backgroundColor: p.hair, gap: 1, border: `1px solid ${p.hair}` },
        rows.map((cells, r) =>
          row(
            { gap: 1 },
            cells.map((cell, c) => {
              const on = block.highlight === r * 3 + c;
              return el(
                {
                  display: 'flex',
                  flexGrow: 1,
                  flexBasis: 0,
                  height: Math.round(cellW * 0.62),
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: s(3.1),
                  fontWeight: on ? 500 : 400,
                  letterSpacing: s(3.1) * -0.015,
                  backgroundColor: on ? p.accent : p.bg,
                  color: on ? p.onAccent : p.faint
                },
                cell
              );
            })
          )
        )
      );
    }

    case 'answer': {
      // The card is a mockup of someone else's chat UI, so it keeps ITS colours in every theme —
      // inheriting the palette would put white ink on a white card the moment the theme goes dark.
      const card = { bg: '#ffffff', ink: '#1d1d1f', faint: '#86868b', hair: '#ededef' };
      return col(
        {
          backgroundColor: card.bg,
          border: `1px solid ${card.hair}`,
          borderRadius: s(3),
          padding: s(5),
          gap: s(3.4)
        },
        [
          el(
            {
              display: 'flex',
              fontSize: s(3.5),
              fontWeight: 450,
              letterSpacing: s(3.5) * -0.018,
              color: card.ink
            },
            `“${block.question}”`
          ),
          el({ display: 'flex', height: 1, backgroundColor: card.hair }, ''),
          col(
            { gap: s(2.6) },
            block.items.map((item, i) =>
              row({ gap: s(2.4), fontSize: s(3.4), color: card.ink }, [
                el({ display: 'flex', color: card.faint, width: s(3.4), flexShrink: 0 }, String(i + 1)),
                el({ display: 'flex' }, item)
              ])
            )
          ),
          ...(block.missing
            ? [
                row(
                  {
                    borderTop: `1px dashed ${card.faint}`,
                    paddingTop: s(2.8),
                    gap: s(2.4),
                    fontSize: s(3.2),
                    color: card.faint
                  },
                  [
                    el({ display: 'flex', color: p.accent, width: s(3.4), flexShrink: 0 }, '—'),
                    el({ display: 'flex' }, block.missing)
                  ]
                )
              ]
            : [])
        ]
      );
    }

    case 'image': {
      const h = s(IMAGE_SIZE_PCT[block.size ?? 'md']);
      const r = s(RADIUS_PCT[block.radius ?? 'md']);
      const img = el(
        {
          display: 'flex',
          width: contentW,
          height: h,
          objectFit: block.fit ?? 'cover',
          borderRadius: r
        },
        undefined,
        'img',
        { src: block.src, width: contentW, height: h }
      );
      if (!block.label) return img;
      return col({ gap: s(1.6) }, [
        img,
        el({ display: 'flex', fontSize: s(2.6), color: p.faint }, block.label)
      ]);
    }

    case 'shape': {
      const fill = resolveFill(block.fill ?? 'accent', p);
      const size = block.size ?? 'md';
      const kind = block.kind ?? 'bar';
      if (kind === 'bar') {
        return el(
          {
            display: 'flex',
            width: size === 'lg' ? s(40) : size === 'sm' ? s(16) : s(26),
            height: s(0.9),
            backgroundColor: fill,
            borderRadius: s(0.45),
            flexShrink: 0
          },
          ''
        );
      }
      if (kind === 'circle') {
        const d = s(MARK_SIZE_PCT[size]);
        return el(
          {
            display: 'flex',
            width: d,
            height: d,
            borderRadius: d,
            backgroundColor: fill,
            flexShrink: 0
          },
          ''
        );
      }
      if (kind === 'pill') {
        return el(
          {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: `${s(1.4)}px ${s(3.2)}px`,
            borderRadius: s(10),
            backgroundColor: fill,
            color: fill === p.accent ? p.onAccent : p.bg === fill ? p.ink : p.bg,
            fontSize: s(2.6),
            fontWeight: 600,
            letterSpacing: s(2.6) * 0.04,
            textTransform: 'uppercase',
            flexShrink: 0,
            alignSelf: 'flex-start'
          },
          block.label ?? ''
        );
      }
      // box
      return el(
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: s(size === 'lg' ? 18 : size === 'sm' ? 8 : 12),
          padding: s(3),
          borderRadius: s(2),
          backgroundColor: fill,
          color: fill === p.accent ? p.onAccent : p.ink,
          fontSize: s(3.2),
          fontWeight: 500,
          flexShrink: 0
        },
        block.label ?? ''
      );
    }

    case 'icon': {
      const fill = resolveFill(block.fill ?? 'accent', p);
      const resolved = resolveGraphicIcon(block.name, fill, {
        set: block.set ?? 'auto',
        brandColor: block.brand_color
      });
      if (!resolved) return null;
      const d = s(MARK_SIZE_PCT[block.size ?? 'md']);
      const mark = el(
        { display: 'flex', width: d, height: d, flexShrink: 0 },
        undefined,
        'img',
        { src: iconDataUri(resolved), width: d, height: d }
      );
      if (!block.label) return mark;
      return row({ alignItems: 'center', gap: s(2.2) }, [
        mark,
        el({ display: 'flex', fontSize: s(3.1), color: p.ink, fontWeight: 500 }, block.label)
      ]);
    }

    case 'rule':
      return el(
        { display: 'flex', width: s(26), height: s(0.9), backgroundColor: p.accent, flexShrink: 0 },
        ''
      );

    case 'space':
      // The one positioning primitive the model gets: "push what follows away".
      return el({ display: 'flex', flexGrow: 1 }, '');

    case 'footer':
      return row({ justifyContent: 'space-between', alignItems: 'flex-end', gap: s(4) }, [
        row({ alignItems: 'center', gap: s(1.6) }, [
          el(
            {
              display: 'flex',
              width: s(2.6),
              height: s(2.6),
              borderRadius: s(2.6),
              backgroundColor: p.accent,
              flexShrink: 0
            },
            ''
          ),
          el(
            { display: 'flex', fontSize: s(3), fontWeight: 500, letterSpacing: s(3) * -0.02, color: p.ink },
            block.brand
          )
        ]),
        ...(block.note
          ? [el({ display: 'flex', fontSize: s(2.9), color: p.soft }, block.note)]
          : [])
      ]);
  }
}

/** Full canvas tree for one graphic. `font` is the resolved family name satori was given. */
export function graphicTree(
  graphic: Graphic,
  opts: { brandColors?: string[] | null; fonts: Fonts }
): El {
  const { width, height } = graphicSize(graphic.aspect);
  const p = paletteFor(graphic.theme, opts.brandColors);
  const pad = scale(width, 7);
  const contentW = width - pad * 2;

  const children = graphic.blocks
    .map((b) => blockEl(b, width, contentW, p, opts.fonts))
    .filter((b): b is El => !!b);

  const stack = col(
    {
      width,
      height,
      // When a photo sits behind the type, keep the stack transparent so the image shows through;
      // otherwise the theme fills the canvas.
      backgroundColor: graphic.background ? 'transparent' : p.bg,
      padding: pad,
      gap: scale(width, 3),
      fontFamily: opts.fonts.body,
      ...(graphic.background ? { position: 'relative' as const } : {})
    },
    children
  );

  if (!graphic.background?.src) return stack;

  const dim = graphic.background.dim ?? 0.45;
  // Scrim: on light themes veil toward white; on dark/accent toward the canvas ink so type stays
  // readable without hard-coding a second palette.
  const scrim =
    graphic.theme === 'light'
      ? `rgba(249,249,249,${dim})`
      : graphic.theme === 'accent'
        ? // accent ink is onAccent; veil with the accent itself
          (() => {
            const hex = p.bg;
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!m) return `rgba(0,0,0,${dim})`;
            const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
            return `rgba(${r},${g},${b},${dim})`;
          })()
        : `rgba(29,29,31,${dim})`;

  return el(
    {
      display: 'flex',
      position: 'relative',
      width,
      height,
      overflow: 'hidden',
      backgroundColor: p.bg
    },
    [
      el(
        {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          objectFit: graphic.background.fit ?? 'cover'
        },
        undefined,
        'img',
        { src: graphic.background.src, width, height }
      ),
      el(
        {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          backgroundColor: scrim
        },
        ''
      ),
      stack
    ]
  );
}
