/**
 * JOLT — neon green geometry on black.
 *
 * Big shapes do the talking: a full lime field cut by a black wave of type, a void of concentric
 * circles, a checklist crushed by a giant mark. Minimal ornament, maximum signal — the juju move
 * without needing 3D renders.
 */
import {
  BRAND_SLOT,
  DEMO,
  PRESET_HEIGHT,
  PRESET_WIDTH,
  SITE_SLOT,
  col,
  el,
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
  brackets,
  canvas,
  chevronStack,
  dotGrid,
  letterStack,
  overflowTitle,
  POST_SIZE,
  plusMark,
  starMark,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#0A0A0A',
  lime: '#B8FF00',
  ink: '#FFFFFF',
  soft: 'rgba(255,255,255,0.55)',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 10, color = C.ink) =>
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

  const voidRings = () => {
    const rings = [s(55), s(42), s(28), s(14)];
    return el(
      {
        display: 'flex',
        position: 'relative',
        width: rings[0],
        height: rings[0],
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center'
      },
      rings.map((d, i) =>
        el(
          {
            display: 'flex',
            position: 'absolute',
            width: d,
            height: d,
            borderRadius: d,
            border: `${i === rings.length - 1 ? 0 : 2}px solid ${C.lime}`,
            backgroundColor: i === rings.length - 1 ? C.bg : 'transparent'
          },
          ''
        )
      )
    );
  };

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          el({ display: 'flex', width: PRESET_WIDTH, height: s(62), overflow: 'hidden', position: 'relative' }, [
            img(photos.a, PRESET_WIDTH, s(62)),
            el(
              {
                display: 'flex',
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: s(18),
                backgroundImage: `linear-gradient(180deg, transparent, ${C.bg})`
              },
              ''
            )
          ]),
          col({ padding: C.pad, flexGrow: 1 }, [
            titolo(p.headline, 8, C.lime),
            gap(2.4),
            el({ display: 'flex', fontSize: s(2.9), color: C.soft }, p.sub),
            grow(1),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: C.ink }, BRAND_SLOT),
              starMark(C.lime, s(5))
            ])
          ])
        ]),
        POST_SIZE,
        [dotGrid(3, 3, C.lime, { absolute: { top: C.pad, right: C.pad } })]
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.lime,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          starMark(C.bg, s(7)),
          grow(1),
          titolo(`"${p.quote}"`, 5.6, C.bg),
          gap(4),
          el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: C.bg }, p.author),
          gap(0.6),
          el({ display: 'flex', fontSize: s(2.5), color: 'rgba(10,10,10,0.6)' }, p.role),
          grow(0.4),
          chevronStack(4, C.bg, s(3.6))
        ])
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ backgroundColor: C.lime, padding: C.pad, flexGrow: 1 }, [
            tape(p.a.label, C.bg, C.lime),
            gap(2),
            titolo(p.a.items.join('\n'), 5.4, C.bg)
          ]),
          col({ padding: C.pad, flexGrow: 1 }, [
            tape(p.b.label, C.lime, C.bg),
            gap(2),
            titolo(p.b.items.join('\n'), 5.4, C.ink),
            grow(1),
            brackets(s(12), C.lime)
          ])
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.lime, C.bg),
          titolo(p.headline, 8, C.lime),
          grow(1),
          row({ alignItems: 'center', gap: s(4) }, [
            el(
              {
                display: 'flex',
                width: s(40),
                height: s(40),
                borderRadius: s(40),
                overflow: 'hidden',
                border: `4px solid ${C.lime}`
              },
              [img(photos.b, s(40), s(40))]
            ),
            col({ flexGrow: 1, gap: s(2) }, [
              el({ display: 'flex', fontSize: s(2.8), color: C.soft }, p.sub),
              plusMark(C.lime, s(6))
            ])
          ]),
          grow(1),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ]),
        POST_SIZE,
        [
          letterStack('LOOK', {
            fontFamily: f.display,
            fontSize: s(3.2),
            color: C.lime,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            top: s(22)
          })
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.lime,
        row(
          { padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body },
          [
            col({ justifyContent: 'center' }, [
              letterStack('DATA', { fontFamily: f.display, fontSize: s(3.4), color: C.bg, fontWeight: 700 })
            ]),
            col({ flexGrow: 1, paddingLeft: s(4) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.bg, textTransform: 'uppercase' }, p.kicker),
              grow(1),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(34),
                  fontWeight: 700,
                  color: C.bg,
                  lineHeight: 0.85,
                  letterSpacing: s(34) * -0.05
                },
                p.stat
              ),
              gap(3),
              titolo(p.label, 4.2, C.bg),
              grow(0.5),
              starMark(C.bg, s(7))
            ])
          ]
        )
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          grow(1),
          voidRings(),
          gap(5),
          titolo(p.headline, 9, C.lime),
          gap(3),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                el(
                  {
                    display: 'flex',
                    backgroundColor: C.lime,
                    color: C.bg,
                    padding: `${s(1.6)}px ${s(3.2)}px`,
                    borderRadius: s(10),
                    fontSize: s(2.6),
                    fontWeight: 700
                  },
                  `${a}  →`
                )
              ])
            )
          ),
          grow(0.5),
          el({ display: 'flex', fontSize: s(3.8), fontWeight: 700, color: C.ink }, p.handle)
        ]),
        POST_SIZE,
        [
          overflowTitle('JOLT', {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.lime,
            fontWeight: 700,
            opacity: 0.25
          }, 'top')
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body, position: 'relative' }, [
          tape(p.kicker, C.lime, C.bg),
          titolo(p.headline, 8, C.ink),
          grow(1),
          el(
            {
              display: 'flex',
              position: 'absolute',
              right: s(4),
              top: s(28),
              fontFamily: f.display,
              fontSize: s(55),
              fontWeight: 700,
              color: C.lime,
              opacity: 0.95,
              lineHeight: 1
            },
            '✓'
          ),
          col(
            { gap: s(3.4), position: 'relative' },
            p.items.map((it, i) =>
              el({ display: 'flex', fontSize: s(4.2), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, `${i + 1}. ${it}`)
            )
          ),
          grow(0.5),
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.4), color: C.soft }, BRAND_SLOT),
            dotGrid(4, 2, C.lime)
          ])
        ])
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.lime,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ padding: C.pad, flexGrow: 1.2 }, [
            row({ justifyContent: 'space-between' }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 600, color: C.bg }, BRAND_SLOT),
              starMark(C.bg, s(5))
            ]),
            grow(1),
            titolo(p.headline, 10, C.bg),
            gap(2.4),
            el({ display: 'flex', fontSize: s(3), color: 'rgba(10,10,10,0.65)' }, p.sub)
          ]),
          col(
            {
              backgroundColor: C.bg,
              padding: C.pad,
              paddingTop: s(6),
              borderTopLeftRadius: s(18),
              borderTopRightRadius: s(18),
              minHeight: s(28)
            },
            [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.lime, textTransform: 'uppercase' }, 'swipe →'),
              gap(2),
              el({ display: 'flex', fontSize: s(2.5), color: C.soft }, SITE_SLOT)
            ]
          )
        ]),
        POST_SIZE,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'NOW', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.bg,
            fontWeight: 700,
            opacity: 0.2
          }, 'right')
        ]
      );
    }
  }
}

export const jolt: StylePreset = {
  slug: 'jolt',
  name: 'Jolt',
  thesis: {
    it: 'Verde neon e nero. Forme grandi, checklist schiacciata da un ✓, cerchi concentrici.',
    en: 'Neon green and black. Big shapes, a checklist crushed by a ✓, concentric voids.'
  },
  suits: {
    it: 'Personal brand, coach, agency bold, SaaS giovane — chi vuole segnale, non soft.',
    en: 'Personal brands, coaches, bold agencies, young SaaS — signal over soft.'
  },
  fonts: { display: 'Syne', body: 'Syne', mono: 'Syne' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'nero / lime pieno', en: 'black / full lime' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'geometrico 700', en: 'geometric 700' } },
    { label: { it: 'cover', en: 'cover' }, value: { it: 'lime tagliato da onda nera', en: 'lime cut by a black wave' } },
    { label: { it: 'lista', en: 'list' }, value: { it: '✓ gigante sopra', en: 'giant ✓ overlay' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'cerchi concentrici', en: 'concentric rings' } },
    { label: { it: 'mark', en: 'mark' }, value: { it: 'stella ✦', en: 'star ✦' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.lime, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.lime,
    muted: C.soft,
    displayFont: 'Syne',
    bodyFont: 'Syne'
  }
};
