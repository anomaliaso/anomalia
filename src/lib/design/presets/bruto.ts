/**
 * BRUTO — experimental brutalism, red box on photo.
 *
 * The Alastro move: a solid red rectangle dropped off-centre over a photograph, type broken across
 * lines inside it, outlined words faked with a lighter weight on a darker ground. Asymmetry first.
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
  barcode,
  brackets,
  canvas,
  overflowTitle,
  POST_SIZE,
  plusMark,
  repeatPhrase,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  red: '#FF1A1A',
  bg: '#F2F2F2',
  ink: '#0A0A0A',
  soft: '#555555',
  pad: s(6)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 9, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.035,
        lineHeight: 0.92,
        textTransform: 'uppercase'
      })
    );

  const outline = (text: string, pct = 8) =>
    el(
      {
        display: 'flex',
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        color: 'transparent',
        textTransform: 'uppercase',
        letterSpacing: s(pct) * -0.03,
        borderBottom: `3px solid ${C.red}`,
        paddingBottom: s(0.6)
      },
      text
    );

  const redBox = (children: El[], w = s(70), extra: Record<string, unknown> = {}) =>
    col({ backgroundColor: C.red, padding: s(4.5), width: w, ...extra }, children);

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'rgba(10,10,10,0.25)',
        canvas(
          C.ink,
          col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
            grow(0.4),
            redBox(
              [
                titolo(p.headline, 7.4, '#FFFFFF'),
                gap(2),
                el({ display: 'flex', fontSize: s(2.7), color: 'rgba(255,255,255,0.85)' }, p.sub)
              ],
              s(72)
            ),
            grow(1),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: '#FFFFFF' }, BRAND_SLOT),
              brackets(s(10), C.red)
            ])
          ])
        ),
        C.ink
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, '#FFFFFF'),
          grow(1),
          titolo(`"${p.quote}"`, 5.8),
          gap(4),
          row({ alignItems: 'center', gap: s(3) }, [
            el({ display: 'flex', width: s(18), height: s(18), overflow: 'hidden' }, [img(photos.c, s(18), s(18))]),
            col({}, [
              el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: C.ink }, p.author),
              el({ display: 'flex', fontSize: s(2.4), color: C.soft }, p.role)
            ])
          ]),
          grow(0.4),
          plusMark(C.red, s(6))
        ]),
        POST_SIZE,
        [
          overflowTitle('SAY', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.red,
            fontWeight: 700,
            opacity: 0.15
          }, 'right')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.ink,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ backgroundColor: C.red, padding: C.pad, flexGrow: 1, gap: s(2) }, [
            tape(p.a.label, C.ink, C.red),
            titolo(p.a.items.join('\n'), 5, '#FFFFFF')
          ]),
          col({ padding: C.pad, flexGrow: 1, gap: s(2) }, [
            tape(p.b.label, C.red, C.ink),
            titolo(p.b.items.join('\n'), 5, '#FFFFFF'),
            grow(1),
            barcode(s(32), s(5), C.red)
          ])
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, '#FFFFFF'),
          titolo(p.headline, 8),
          gap(2),
          outline('MÉTODO'),
          grow(1),
          row({ gap: s(2), flexWrap: 'wrap' }, [
            el({ display: 'flex', width: s(28), height: s(34), overflow: 'hidden' }, [img(photos.a, s(28), s(34))]),
            el({ display: 'flex', width: s(28), height: s(34), overflow: 'hidden' }, [img(photos.b, s(28), s(34))]),
            el({ display: 'flex', width: s(28), height: s(34), overflow: 'hidden' }, [img(photos.c, s(28), s(34))])
          ]),
          gap(3),
          el({ display: 'flex', fontSize: s(2.7), color: C.soft }, p.sub)
        ]),
        POST_SIZE,
        [
          repeatPhrase('RAW', 2, {
            fontFamily: f.display,
            fontSize: s(5),
            color: C.red,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            bottom: s(12)
          })
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.red,
        row(
          { padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body },
          [
            col({ flexGrow: 1 }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }, p.kicker),
              grow(1),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(32),
                  fontWeight: 700,
                  color: '#FFFFFF',
                  lineHeight: 0.85,
                  letterSpacing: s(32) * -0.05
                },
                p.stat
              ),
              gap(3),
              titolo(p.label, 4.2, C.ink),
              grow(0.4),
              el(
                {
                  display: 'flex',
                  fontSize: s(8),
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.35)',
                  textTransform: 'uppercase'
                },
                '★'
              )
            ]),
            col({ justifyContent: 'center', paddingLeft: s(3) }, [brackets(s(14), C.ink)])
          ]
        ),
        POST_SIZE,
        [
          overflowTitle(p.stat, {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.ink,
            fontWeight: 700,
            opacity: 0.25
          }, 'bottom')
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.ink,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          grow(1),
          redBox(
            [
              titolo(p.headline, 9, '#FFFFFF'),
              gap(3),
              ...p.actions.map((a) =>
                el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }, `→ ${a}`)
              )
            ],
            s(78)
          ),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(4.2), fontWeight: 700, color: '#FFFFFF' }, p.handle),
            plusMark(C.red, s(6))
          ])
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, '#FFFFFF'),
          titolo(p.headline, 8),
          gap(2),
          outline('LISTA'),
          grow(1),
          col(
            { gap: s(0) },
            p.items.map((it, i) =>
              row(
                {
                  borderTop: `2px solid ${C.ink}`,
                  paddingTop: s(2.4),
                  paddingBottom: s(2.4),
                  gap: s(3),
                  alignItems: 'center'
                },
                [
                  el({ display: 'flex', fontSize: s(3.4), fontWeight: 700, color: C.red }, `0${i + 1}`),
                  el({ display: 'flex', fontSize: s(3.4), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, it)
                ]
              )
            )
          ),
          el({ display: 'flex', borderTop: `2px solid ${C.ink}`, width: '100%', height: 2 }, ''),
          grow(0.3),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ])
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          titolo(p.headline, 9),
          gap(2),
          outline('BRUTO'),
          grow(1),
          row({ alignItems: 'flex-end', gap: s(3) }, [
            el({ display: 'flex', width: s(36), height: s(48), overflow: 'hidden', backgroundColor: C.red }, [
              img(photos.a, s(36), s(48))
            ]),
            redBox(
              [
                el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }, BRAND_SLOT),
                gap(1.4),
                el({ display: 'flex', fontSize: s(2.5), color: 'rgba(255,255,255,0.85)' }, p.sub)
              ],
              s(42)
            )
          ]),
          gap(3),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ]),
        POST_SIZE,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'BRUTO', {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.red,
            fontWeight: 700,
            opacity: 0.2
          }, 'right')
        ]
      );
    }
  }
}

export const bruto: StylePreset = {
  slug: 'bruto',
  name: 'Bruto',
  thesis: {
    it: 'Rettangolo rosso buttato sopra la foto, tipo spezzato, asimmetria da studio sperimentale.',
    en: 'A red rectangle dropped on the photo, broken type, experimental-studio asymmetry.'
  },
  suits: {
    it: 'Studi sperimentali, portfolio designer, editorial punk, brand culturali.',
    en: 'Experimental studios, designer portfolios, editorial punk, cultural brands.'
  },
  fonts: { display: 'Archivo', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'grigio / rosso vivo', en: 'grey / hot red' } },
    { label: { it: 'firma', en: 'signature' }, value: { it: 'box rosso off-centre', en: 'off-centre red box' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'box sopra l’immagine', en: 'box over the image' } },
    { label: { it: 'lista', en: 'list' }, value: { it: 'righe con filetto nero', en: 'rows with black rules' } },
    { label: { it: 'outline', en: 'outline' }, value: { it: 'parola sottolineata', en: 'underlined word' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'box rosso su nero', en: 'red box on black' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.red, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.red,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Inter'
  }
};
