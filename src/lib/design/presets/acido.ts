/**
 * ACIDO — lime on purple, barcode, stacked side type.
 *
 * Rave-flyer / acid-tech energy: a vibrating lime panel on a deep violet field, a fake barcode as
 * ornament, and a word stacked letter-by-letter down the edge (rotation is unreliable in satori,
 * so the stack IS the vertical). Photos land as hard rectangles, never full-bleed under type.
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
  barcode,
  canvas,
  dotGrid,
  letterStack,
  overflowTitle,
  POST_SIZE,
  repeatPhrase,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#1A0830',
  lime: '#C8FF00',
  ink: '#FFFFFF',
  soft: 'rgba(255,255,255,0.55)',
  pad: s(6)
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
        lineHeight: 0.9,
        textTransform: 'uppercase'
      })
    );

  const sideStack = (word: string) =>
    el(
      { display: 'flex', position: 'absolute', left: s(2.5), top: s(10), bottom: s(10), justifyContent: 'center' },
      [letterStack(word, { fontFamily: f.display, fontSize: s(3.4), color: C.lime, fontWeight: 700 })]
    );

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.bg,
        col({ padding: C.pad, paddingLeft: s(10), width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.ink, C.bg),
          gap(3),
          barcode(s(28), s(6), C.ink),
          grow(1),
          el({ display: 'flex', width: s(70), height: s(55), overflow: 'hidden', border: `4px solid ${C.lime}` }, [
            img(photos.a, s(70), s(55))
          ]),
          gap(3),
          titolo(p.headline, 8, C.lime),
          grow(0.3),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ]),
        POST_SIZE,
        [sideStack('WORKSHOP')]
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.lime,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body, color: C.bg }, [
          tape(p.kicker, C.bg, C.lime),
          grow(1),
          col({}, [
            ...lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(5.2),
              fontWeight: 700,
              lineHeight: 1.12,
              textTransform: 'uppercase',
              color: C.bg
            }),
            gap(3),
            el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.bg }, `${p.author} / ${p.role}`)
          ]),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            dotGrid(5, 2, C.bg),
            letterStack('QUOTE', { fontFamily: f.display, fontSize: s(3), color: C.bg, fontWeight: 700 })
          ])
        ])
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, paddingLeft: s(10), width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.lime, C.bg),
          gap(2),
          titolo(p.headline, 7, C.lime),
          grow(1),
          row({ gap: s(2.4) }, [
            col({ flexGrow: 1, backgroundColor: C.lime, padding: s(3.4), gap: s(1.6) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.bg, textTransform: 'uppercase' }, p.a.label),
              ...p.a.items.map((it) => el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: C.bg }, it))
            ]),
            col({ flexGrow: 1, backgroundColor: '#FFFFFF', padding: s(3.4), gap: s(1.6) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.bg, textTransform: 'uppercase' }, p.b.label),
              ...p.b.items.map((it) => el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: C.bg }, it))
            ])
          ]),
          grow(0.4),
          barcode(s(50), s(5), C.lime)
        ]),
        POST_SIZE,
        [sideStack('SPLIT')]
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, paddingLeft: s(10), width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.ink, C.lime),
          grow(1),
          titolo(p.headline, 8, C.ink),
          gap(3),
          row({ gap: s(2) }, [
            el({ display: 'flex', width: s(36), height: s(44), overflow: 'hidden' }, [img(photos.b, s(36), s(44))]),
            el({ display: 'flex', width: s(36), height: s(44), overflow: 'hidden', border: `3px solid ${C.lime}` }, [
              img(photos.c, s(36), s(44))
            ])
          ]),
          gap(2.4),
          el({ display: 'flex', fontSize: s(2.6), color: C.soft, textTransform: 'uppercase' }, p.sub),
          grow(0.3)
        ]),
        POST_SIZE,
        [
          overflowTitle('LOOK', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.lime,
            fontWeight: 700
          }, 'right'),
          sideStack('LOOK')
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        row(
          { padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body },
          [
            col({ justifyContent: 'center', paddingRight: s(3) }, [
              letterStack('METRIC', { fontFamily: f.display, fontSize: s(3.2), color: C.lime, fontWeight: 700 })
            ]),
            col({ flexGrow: 1 }, [
              tape(p.kicker, C.lime, C.bg),
              grow(1),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(32),
                  fontWeight: 700,
                  color: C.lime,
                  lineHeight: 0.85,
                  letterSpacing: s(32) * -0.05
                },
                p.stat
              ),
              gap(2),
              barcode(s(40), s(5), C.lime),
              gap(3),
              titolo(p.label, 4, C.ink),
              grow(0.5)
            ])
          ]
        ),
        POST_SIZE,
        [
          overflowTitle(p.stat, {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.lime,
            fontWeight: 700,
            opacity: 0.18
          }, 'bottom')
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.lime,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.bg, C.lime),
          grow(1),
          titolo(p.headline, 10, C.bg),
          gap(3),
          barcode(s(32), s(5), C.bg),
          gap(4),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              el(
                {
                  display: 'flex',
                  backgroundColor: C.bg,
                  color: C.lime,
                  padding: `${s(2.2)}px ${s(3)}px`,
                  fontSize: s(3),
                  fontWeight: 700,
                  textTransform: 'uppercase'
                },
                `→  ${a}`
              )
            )
          ),
          grow(0.4),
          el({ display: 'flex', fontSize: s(4.2), fontWeight: 700, color: C.bg }, p.handle)
        ]),
        POST_SIZE,
        [
          overflowTitle('ENTER', {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.bg,
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
        col({ padding: C.pad, paddingLeft: s(10), width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.lime, C.bg),
          gap(3),
          titolo(p.headline, 8, C.lime),
          grow(1),
          col(
            { gap: s(2) },
            p.items.map((it, i) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                el(
                  {
                    display: 'flex',
                    width: s(7),
                    height: s(7),
                    backgroundColor: C.lime,
                    color: C.bg,
                    fontSize: s(2.6),
                    fontWeight: 700,
                    alignItems: 'center',
                    justifyContent: 'center'
                  },
                  `0${i + 1}`
                ),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, it)
              ])
            )
          ),
          grow(0.4),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            barcode(s(36), s(5), C.lime),
            repeatPhrase('STEP', 2, {
              fontFamily: f.display,
              fontSize: s(3.6),
              color: C.lime,
              fontWeight: 700
            })
          ])
        ]),
        POST_SIZE,
        [sideStack('STEPS')]
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tape(BRAND_SLOT, C.lime, C.bg),
            barcode(s(22), s(5), C.lime)
          ]),
          grow(1),
          el(
            {
              display: 'flex',
              backgroundColor: C.lime,
              padding: s(5),
              width: '100%'
            },
            col({ color: C.bg }, [
              ...lines(p.headline, {
                fontFamily: f.display,
                fontSize: s(9.5),
                fontWeight: 700,
                letterSpacing: s(9.5) * -0.04,
                lineHeight: 0.9,
                textTransform: 'uppercase'
              }),
              gap(2.4),
              el({ display: 'flex', fontSize: s(2.8), fontWeight: 600 }, p.sub)
            ])
          ),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.5), color: C.soft }, SITE_SLOT),
            dotGrid(4, 3, C.lime)
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'NOW', {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.lime,
            fontWeight: 700,
            opacity: 0.35
          }, 'right')
        ]
      );
    }
  }
}

export const acido: StylePreset = {
  slug: 'acido',
  name: 'Acido',
  thesis: {
    it: 'Lime su viola, barcode finto, parola incolonnata sul bordo. Energia da flyer rave.',
    en: 'Lime on violet, a fake barcode, a word stacked down the edge. Rave-flyer energy.'
  },
  suits: {
    it: 'Streetwear, music, nightlife, workshop, brand giovani ad alto volume.',
    en: 'Streetwear, music, nightlife, workshops, high-volume youth brands.'
  },
  fonts: { display: 'Archivo', body: 'Archivo', mono: 'IBM Plex Mono' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'viola + pannello lime', en: 'violet + lime panel' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'caps heavy', en: 'heavy caps' } },
    { label: { it: 'bordo', en: 'edge' }, value: { it: 'stack verticale', en: 'vertical letter stack' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'barcode + nastro', en: 'barcode + tape' } },
    { label: { it: 'foto', en: 'photo' }, value: { it: 'rettangolo con bordo', en: 'bordered rectangle' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'barre lime', en: 'lime bars' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.lime, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.lime,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Archivo'
  }
};
