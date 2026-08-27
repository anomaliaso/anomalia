/**
 * TRACIMA — TEXTURAS-style overflow type.
 *
 * Reference move: cream ground, a MASSIVE red overflow title cropped on the left, and a right
 * column with black headline, sub, circle-arrow CTA, and a small brand top-right. Same palette
 * across slides; ornaments swap (barcode, letterStack, overflow edge, circled arrow).
 */
import {
  BRAND_SLOT,
  DEMO,
  PRESET_HEIGHT,
  PRESET_WIDTH,
  SITE_SLOT,
  col,
  el,
  fullBleed,
  gap,
  grow,
  img,
  lines,
  row,
  s,
  type El,
  type PresetFonts,
  type PresetPhotos,
  type PresetSlide,
  type StylePreset
} from './shared';
import {
  arrow,
  barcode,
  canvas,
  chevronStack,
  dotGrid,
  letterStack,
  overflowTitle,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F2F4F1',
  ink: '#0A0A0A',
  accent: '#FF0000',
  soft: 'rgba(10,10,10,0.55)',
  faint: 'rgba(10,10,10,0.35)',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 8.5, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.04,
        lineHeight: 0.92
      })
    );
  const corpo = (text: string, color = C.soft, pct = 2.8) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.4, fontWeight: 500, color, maxWidth: s(70) }, text);
  const brandTiny = (color = C.ink) =>
    el({ display: 'flex', fontSize: s(2.2), fontWeight: 700, color, letterSpacing: s(2.2) * 0.02 }, BRAND_SLOT);
  const circleArrow = (size = s(9), color = C.ink) =>
    el(
      {
        display: 'flex',
        width: size,
        height: size,
        borderRadius: size,
        border: `3px solid ${color}`,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      },
      [arrow(color, Math.round(size * 0.42))]
    );
  const firstWord = (headline: string) => (headline.split('\n')[0] ?? headline).split(/\s+/)[0] ?? 'NOW';

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body, height: '100%' }, [
          // Left gutter reserved for overflow title bleed
          el({ display: 'flex', width: s(28), flexShrink: 0 }, ''),
          col({ flexGrow: 1, justifyContent: 'space-between' }, [
            row({ justifyContent: 'flex-end' }, [brandTiny(C.accent)]),
            col({}, [
              titolo(p.headline, 9.5),
              gap(3.2),
              corpo(p.sub),
              gap(5),
              circleArrow(s(10), C.ink)
            ]),
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 500, color: C.faint }, SITE_SLOT)
          ])
        ]),
        undefined,
        [
          overflowTitle(firstWord(p.headline), {
            fontFamily: f.display,
            fontSize: s(28),
            color: C.accent,
            fontWeight: 700,
            letterSpacing: s(28) * -0.05,
            lineHeight: 0.85
          }, 'left')
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.1) 100%)',
        row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          col({ flexGrow: 1, justifyContent: 'space-between' }, [
            tape(p.kicker, C.accent, '#FFFFFF'),
            col({}, [
              titolo(p.headline, 9, '#FFFFFF'),
              gap(2.8),
              corpo(p.sub, 'rgba(255,255,255,0.78)'),
              gap(4),
              circleArrow(s(9), '#FFFFFF')
            ]),
            brandTiny('#FFFFFF')
          ])
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 700, color: C.soft, textTransform: 'uppercase', letterSpacing: s(2.2) * 0.1 }, p.kicker),
            brandTiny(C.accent)
          ]),
          grow(1),
          col(
            { color: C.ink, maxWidth: s(85) },
            lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(5.8),
              fontWeight: 700,
              letterSpacing: s(5.8) * -0.035,
              lineHeight: 1.08
            })
          ),
          gap(4),
          el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: C.accent }, p.author),
          gap(0.5),
          el({ display: 'flex', fontSize: s(2.4), fontWeight: 500, color: C.soft }, p.role),
          grow(0.5),
          circleArrow(s(8), C.accent)
        ]),
        undefined,
        [
          overflowTitle('“', {
            fontFamily: f.display,
            fontSize: s(40),
            color: C.accent,
            fontWeight: 700,
            lineHeight: 0.8
          }, 'top')
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body, height: '100%' }, [
          col({ flexGrow: 1, paddingRight: s(3) }, [
            tape(p.kicker, C.ink, C.bg),
            gap(3.5),
            titolo(p.headline, 7.5),
            gap(5),
            col(
              { gap: s(2.8) },
              p.items.map((it, i) =>
                row({ alignItems: 'center', gap: s(2.6) }, [
                  el(
                    {
                      display: 'flex',
                      fontFamily: f.display,
                      fontSize: s(4.5),
                      fontWeight: 700,
                      color: C.accent,
                      lineHeight: 1,
                      width: s(7),
                      flexShrink: 0
                    },
                    `${i + 1}`
                  ),
                  el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.ink, lineHeight: 1.25 }, it)
                ])
              )
            ),
            grow(1),
            brandTiny()
          ]),
          col({ justifyContent: 'center', alignItems: 'center', width: s(10) }, [
            letterStack('LIST', { fontFamily: f.display, fontSize: s(3.8), color: C.accent, fontWeight: 700 })
          ])
        ])
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ fontFamily: f.body }, [
          row({ padding: C.pad, paddingBottom: s(3), justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 700, color: C.soft, textTransform: 'uppercase', letterSpacing: s(2.2) * 0.1 }, p.kicker),
            brandTiny(C.accent)
          ]),
          row({ flexGrow: 1 }, [
            col({ flexGrow: 1, padding: C.pad, paddingTop: 0, borderRight: `2px solid ${C.ink}` }, [
              titolo(p.a.label, 6.5),
              gap(3),
              ...p.a.items.map((it) =>
                el({ display: 'flex', fontSize: s(2.7), fontWeight: 500, color: C.soft, marginBottom: s(1.8), lineHeight: 1.3 }, it)
              ),
              grow(1),
              barcode(s(32), s(4.5), C.ink)
            ]),
            col({ flexGrow: 1, padding: C.pad, paddingTop: 0, backgroundColor: C.ink }, [
              titolo(p.b.label, 6.5, C.accent),
              gap(3),
              ...p.b.items.map((it) =>
                el({ display: 'flex', fontSize: s(2.7), fontWeight: 600, color: '#FFFFFF', marginBottom: s(1.8), lineHeight: 1.3 }, it)
              ),
              grow(1),
              circleArrow(s(8), C.accent)
            ])
          ])
        ]),
        undefined,
        [
          overflowTitle('VS', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.accent,
            fontWeight: 700,
            opacity: 0.2
          }, 'bottom')
        ]
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoH = Math.round(PRESET_HEIGHT * 0.42);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tape(p.kicker, C.accent, '#FFFFFF'),
            brandTiny()
          ]),
          gap(3.5),
          titolo(p.headline, 8),
          gap(2.4),
          corpo(p.sub),
          grow(1),
          img(photos.c, PRESET_WIDTH - C.pad * 2, photoH),
          gap(2),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color: C.soft }, p.caption),
            circleArrow(s(7), C.accent)
          ])
        ]),
        undefined,
        [
          overflowTitle(firstWord(p.headline), {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.accent,
            fontWeight: 700,
            opacity: 0.12
          }, 'right')
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body }, [
          col({ flexGrow: 1 }, [
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 700, color: C.soft, textTransform: 'uppercase', letterSpacing: s(2.2) * 0.1 }, p.kicker),
            grow(1),
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(40),
                fontWeight: 700,
                lineHeight: 0.82,
                letterSpacing: s(40) * -0.05,
                color: C.accent
              },
              p.stat
            ),
            gap(3.5),
            col({ color: C.ink }, lines(p.label, { fontSize: s(3.6), fontWeight: 700, lineHeight: 1.15 })),
            gap(2),
            corpo(p.sub),
            grow(0.55),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              brandTiny(),
              circleArrow(s(8), C.ink)
            ])
          ]),
          col({ justifyContent: 'center', paddingLeft: s(2) }, [
            letterStack('BIG', { fontFamily: f.display, fontSize: s(4), color: C.ink, fontWeight: 700 })
          ])
        ]),
        undefined,
        [
          el(
            { display: 'flex', position: 'absolute', left: C.pad, bottom: C.pad },
            [barcode(s(18), s(8), C.accent)]
          )
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tape(p.kicker, C.accent, '#FFFFFF'),
            brandTiny()
          ]),
          grow(0.7),
          titolo(p.headline, 12),
          gap(3),
          corpo(p.sub, C.soft, 3),
          gap(5),
          col(
            { gap: s(2.6) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                circleArrow(s(5.5), C.accent),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.ink }, a)
              ])
            )
          ),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(5.5),
                fontWeight: 700,
                color: C.accent,
                letterSpacing: s(5.5) * -0.03
              },
              p.handle
            ),
            chevronStack(3, C.ink, s(4.2))
          ])
        ]),
        undefined,
        [
          overflowTitle(firstWord(p.headline), {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.accent,
            fontWeight: 700,
            opacity: 0.15
          }, 'bottom'),
          dotGrid(4, 3, C.accent, { gap: s(1.5), size: s(0.8), absolute: { position: 'absolute', right: C.pad, top: s(20) } })
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const tracima: StylePreset = {
  slug: 'tracima',
  name: 'Tracima',
  thesis: {
    it: 'Titolo rosso enorme che esce dal bordo. Colonna destra nera, freccia in cerchio, brand piccolo in alto.',
    en: 'Massive red title bleeding off the edge. Black right column, circled arrow, tiny brand up top.'
  },
  suits: {
    it: 'Editoriali, culture brand, studi creativi, campagne tipografiche aggressive ma pulite.',
    en: 'Editorials, culture brands, creative studios — aggressive type campaigns that stay clean.'
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'crema verdognola', en: 'greenish cream' } },
    { label: { it: 'accento', en: 'accent' }, value: { it: 'rosso #FF0000', en: 'red #FF0000' } },
    { label: { it: 'overflow', en: 'overflow' }, value: { it: 'titolo cropped a sinistra', en: 'title cropped left' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'freccia in cerchio', en: 'arrow in circle' } },
    { label: { it: 'ornamenti', en: 'ornaments' }, value: { it: 'barcode, letterStack, dots', en: 'barcode, letterStack, dots' } },
    { label: { it: 'marchio', en: 'mark' }, value: { it: 'micro in alto a destra', en: 'micro top-right' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.accent, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.accent,
    muted: C.soft,
    displayFont: 'Inter',
    bodyFont: 'Inter'
  }
};
