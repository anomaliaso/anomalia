/**
 * STRADA — pink / yellow / black street noise.
 *
 * Split colour blocks, repeated slogan as texture, photo plates on solid primaries. The streetwear
 * grid without needing wireframe globes — satori gets the clash and the repetition.
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
  bg: '#0A0A0A',
  pink: '#FF2BD6',
  yellow: '#FFE600',
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

  const badge = (text: string, bg = C.pink, fg = C.ink) =>
    el(
      {
        display: 'flex',
        alignSelf: 'flex-start',
        width: s(14),
        height: s(14),
        borderRadius: s(14),
        backgroundColor: bg,
        color: fg,
        fontSize: s(2),
        fontWeight: 700,
        alignItems: 'center',
        justifyContent: 'center',
        textTransform: 'uppercase'
      },
      text
    );

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.yellow,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ padding: C.pad }, [
            row({ justifyContent: 'space-between' }, [
              badge('GO'),
              el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.bg }, BRAND_SLOT)
            ]),
            gap(3),
            el({ display: 'flex', width: '100%', height: s(52), overflow: 'hidden', backgroundColor: C.bg }, [
              img(photos.a, PRESET_WIDTH - C.pad * 2, s(52))
            ])
          ]),
          col({ backgroundColor: C.pink, padding: C.pad, flexGrow: 1 }, [
            titolo(p.headline, 7.4, C.ink),
            gap(2),
            el({ display: 'flex', fontSize: s(2.7), fontWeight: 600, color: C.ink }, p.sub),
            grow(1),
            barcode(s(32), s(5), C.ink)
          ])
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          badge('SAY', C.yellow, C.bg),
          grow(1),
          titolo(p.quote, 5.4, C.pink),
          gap(4),
          tape(p.author, C.yellow, C.bg),
          grow(0.4),
          repeatPhrase('EXPERIENCE', 3, {
            fontFamily: f.display,
            fontSize: s(3.4),
            color: C.ink,
            fontWeight: 700
          })
        ]),
        POST_SIZE,
        [
          letterStack('SAY', {
            fontFamily: f.display,
            fontSize: s(3.2),
            color: C.pink,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            top: s(16)
          })
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ backgroundColor: C.yellow, padding: C.pad, flexGrow: 1, gap: s(2) }, [
            tape(p.a.label, C.bg, C.yellow),
            ...p.a.items.map((it) =>
              el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: C.bg, textTransform: 'uppercase' }, it)
            )
          ]),
          col({ backgroundColor: C.pink, padding: C.pad, flexGrow: 1, gap: s(2) }, [
            tape(p.b.label, C.bg, C.pink),
            ...p.b.items.map((it) =>
              el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, it)
            ),
            grow(1),
            dotGrid(5, 2, C.ink)
          ])
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.pink, C.ink),
          titolo(p.headline, 7.4, C.yellow),
          grow(1),
          el(
            {
              display: 'flex',
              width: s(55),
              height: s(55),
              backgroundColor: C.pink,
              padding: s(3),
              alignSelf: 'center'
            },
            [img(photos.b, s(49), s(49))]
          ),
          grow(1),
          repeatPhrase('DISTANCE', 2, {
            fontFamily: f.display,
            fontSize: s(5),
            color: C.pink,
            fontWeight: 700
          })
        ]),
        POST_SIZE,
        [
          overflowTitle('LOOK', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.yellow,
            fontWeight: 700,
            opacity: 0.25
          }, 'left')
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.pink,
        row(
          { padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body },
          [
            col({ justifyContent: 'center' }, [
              letterStack('STAT', { fontFamily: f.display, fontSize: s(3.4), color: C.ink, fontWeight: 700 })
            ]),
            col({ flexGrow: 1, paddingLeft: s(3) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, p.kicker),
              grow(1),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(34),
                  fontWeight: 700,
                  color: C.yellow,
                  lineHeight: 0.85,
                  letterSpacing: s(34) * -0.05
                },
                p.stat
              ),
              gap(3),
              titolo(p.label, 4, C.ink),
              grow(0.4),
              repeatPhrase('BAD', 3, {
                fontFamily: f.display,
                fontSize: s(5),
                color: C.bg,
                fontWeight: 700
              })
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
          tape(p.kicker, C.pink, C.ink),
          titolo(p.headline, 10, C.yellow),
          gap(3),
          repeatPhrase('THE STREET IS MY BLOOD', 4, {
            fontFamily: f.display,
            fontSize: s(3.6),
            color: C.pink,
            fontWeight: 700
          }),
          grow(1),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              el(
                {
                  display: 'flex',
                  backgroundColor: C.yellow,
                  color: C.bg,
                  padding: `${s(2.2)}px ${s(3)}px`,
                  fontSize: s(3),
                  fontWeight: 700,
                  textTransform: 'uppercase'
                },
                a
              )
            )
          ),
          gap(3),
          el({ display: 'flex', fontSize: s(4), fontWeight: 700, color: C.ink }, p.handle)
        ]),
        POST_SIZE,
        [
          overflowTitle('GO', {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.pink,
            fontWeight: 700,
            opacity: 0.3
          }, 'top')
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.yellow,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.pink, C.ink),
          titolo(p.headline, 8, C.bg),
          grow(1),
          col(
            { gap: s(2.4) },
            p.items.map((it, i) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                el(
                  {
                    display: 'flex',
                    backgroundColor: C.pink,
                    color: C.ink,
                    width: s(7),
                    height: s(7),
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: s(2.6),
                    fontWeight: 700
                  },
                  `0${i + 1}`
                ),
                el({ display: 'flex', fontSize: s(3.4), fontWeight: 700, color: C.bg, textTransform: 'uppercase' }, it)
              ])
            )
          ),
          grow(0.4),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.bg }, SITE_SLOT),
            barcode(s(28), s(5), C.bg)
          ])
        ])
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          col({ backgroundColor: C.yellow, padding: C.pad, minHeight: s(42) }, [
            row({ justifyContent: 'space-between' }, [
              badge('NEW', C.bg, C.yellow),
              el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.bg }, BRAND_SLOT)
            ]),
            grow(1),
            titolo(p.headline, 9, C.bg)
          ]),
          col({ padding: C.pad, flexGrow: 1 }, [
            repeatPhrase('VISUAL TAGLINE', 3, {
              fontFamily: f.display,
              fontSize: s(4.6),
              color: C.pink,
              fontWeight: 700
            }),
            grow(1),
            el({ display: 'flex', fontSize: s(2.8), color: C.ink }, p.sub),
            gap(2),
            el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'NEW', {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.pink,
            fontWeight: 700,
            opacity: 0.35
          }, 'right')
        ]
      );
    }
  }
}

export const strada: StylePreset = {
  slug: 'strada',
  name: 'Strada',
  thesis: {
    it: 'Rosa, giallo, nero. Slogan ripetuti come texture, blocchi di colore spezzati, vibe street.',
    en: 'Pink, yellow, black. Slogans repeated as texture, split colour blocks, street energy.'
  },
  suits: {
    it: 'Streetwear, skate, music, youth culture, drop e collab.',
    en: 'Streetwear, skate, music, youth culture, drops and collabs.'
  },
  fonts: { display: 'Anton', body: 'Archivo', mono: 'Archivo' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'split pink/yellow/black', en: 'split pink/yellow/black' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'condensato caps', en: 'condensed caps' } },
    { label: { it: 'texture', en: 'texture' }, value: { it: 'slogan ripetuto', en: 'repeated slogan' } },
    { label: { it: 'foto', en: 'photo' }, value: { it: 'lastra su primario', en: 'plate on a primary' } },
    { label: { it: 'badge', en: 'badge' }, value: { it: 'cerchio stamp', en: 'circle stamp' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'metà gialla / metà rosa', en: 'half yellow / half pink' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.pink, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.pink,
    muted: C.soft,
    displayFont: 'Anton',
    bodyFont: 'Archivo'
  }
};
