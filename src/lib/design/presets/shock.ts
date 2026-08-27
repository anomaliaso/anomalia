/**
 * SHOCK — hot magenta, black bars, white ground.
 *
 * Event-poster punch: magenta tags, solid black information bars, and hard B&W photo plates.
 * Nothing soft. A list is a stack of black slabs; a number is a blur of magenta scale.
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
  arrow,
  barcode,
  brackets,
  canvas,
  dotGrid,
  overflowTitle,
  POST_SIZE,
  repeatPhrase,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#0A0A0A',
  paper: '#F5F5F5',
  mag: '#FF1FA8',
  ink: '#FFFFFF',
  soft: 'rgba(255,255,255,0.65)',
  pad: s(6.5)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 11, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.04,
        lineHeight: 0.92,
        textTransform: 'uppercase'
      })
    );

  const bar = (text: string, left?: El) =>
    row(
      {
        backgroundColor: '#000000',
        padding: `${s(2.4)}px ${s(3)}px`,
        alignItems: 'center',
        gap: s(2.4),
        width: '100%'
      },
      [
        ...(left ? [left] : []),
        el({ display: 'flex', fontSize: s(3.1), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, text)
      ]
    );

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tape(p.kicker, C.mag, C.ink),
            brackets(s(10), C.mag)
          ]),
          gap(3),
          el({ display: 'flex', width: '100%', height: s(58), overflow: 'hidden' }, [
            img(photos.a, PRESET_WIDTH - C.pad * 2, s(58))
          ]),
          gap(3),
          titolo(p.headline, 8),
          gap(2),
          el({ display: 'flex', fontSize: s(2.8), color: C.soft }, p.sub),
          grow(1),
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: C.mag }, BRAND_SLOT),
            el({ display: 'flex', fontSize: s(2.4), color: 'rgba(255,255,255,0.5)' }, SITE_SLOT)
          ])
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.paper,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.mag, C.ink),
          grow(1),
          titolo(`"${p.quote}"`, 5.4, C.bg),
          gap(4),
          row({ alignItems: 'center', gap: s(3) }, [
            tape(p.author, C.bg, C.ink),
            arrow(C.mag, s(4))
          ]),
          gap(1.2),
          el({ display: 'flex', fontSize: s(2.5), color: '#555555' }, p.role),
          grow(0.5),
          barcode(s(40), s(5), C.mag)
        ]),
        POST_SIZE,
        [
          overflowTitle('SAY', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.mag,
            fontWeight: 700,
            opacity: 0.2
          }, 'right')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.mag, C.ink),
          gap(3),
          titolo(p.headline, 7.4),
          grow(1),
          col({ gap: s(2) }, [
            tape(p.a.label, C.ink, C.bg),
            ...p.a.items.map((it) => bar(it)),
            gap(1),
            tape(p.b.label, C.mag, C.ink),
            ...p.b.items.map((it) =>
              bar(it, el({ display: 'flex', width: s(2.4), height: s(2.4), backgroundColor: C.mag }, ''))
            )
          ]),
          grow(0.3),
          dotGrid(8, 1, C.mag, { absolute: { bottom: C.pad, left: C.pad } })
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.mag, C.ink),
          grow(1),
          row({ gap: s(3), alignItems: 'flex-end' }, [
            el({ display: 'flex', width: s(42), height: s(55), overflow: 'hidden' }, [img(photos.b, s(42), s(55))]),
            col({ flexGrow: 1, gap: s(2) }, [
              titolo(p.headline, 6.2),
              el({ display: 'flex', fontSize: s(2.6), color: C.soft }, p.sub)
            ])
          ]),
          grow(0.4),
          repeatPhrase('SHOCK', 3, {
            fontFamily: f.display,
            fontSize: s(4),
            color: C.mag,
            fontWeight: 700
          })
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.paper,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.bg, C.ink),
          grow(1),
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(28),
              fontWeight: 700,
              color: C.mag,
              lineHeight: 0.85,
              letterSpacing: s(28) * -0.05,
              opacity: 0.92
            },
            p.stat
          ),
          gap(2),
          titolo(p.label, 4.2, C.bg),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            dotGrid(6, 2, C.mag),
            barcode(s(30), s(5), C.mag)
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle(p.stat, {
            fontFamily: f.display,
            fontSize: s(24),
            color: C.mag,
            fontWeight: 700,
            opacity: 0.15
          }, 'bottom')
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.mag, C.ink),
          grow(1),
          titolo(p.headline, 11),
          gap(3),
          el({ display: 'flex', fontSize: s(3), color: C.soft }, p.sub),
          gap(4),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              bar(a, el({ display: 'flex', width: s(2.4), height: s(2.4), backgroundColor: C.mag }, ''))
            )
          ),
          grow(0.4),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(4.4), fontWeight: 700, color: C.mag }, p.handle),
            arrow(C.mag, s(6))
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle('GO', {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.mag,
            fontWeight: 700,
            opacity: 0.3
          }, 'top')
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.paper,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.mag, C.ink),
          gap(4),
          titolo(p.headline, 8, C.bg),
          grow(1),
          col(
            { gap: s(2) },
            p.items.map((it, i) =>
              bar(
                it,
                el(
                  {
                    display: 'flex',
                    width: s(5.5),
                    height: s(5.5),
                    backgroundColor: C.mag,
                    color: C.ink,
                    fontSize: s(2.2),
                    fontWeight: 700,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  },
                  `0${i + 1}`
                )
              )
            )
          ),
          grow(0.4),
          dotGrid(12, 1, C.mag, { absolute: { bottom: C.pad, right: C.pad } })
        ])
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(BRAND_SLOT, C.mag, C.ink),
          grow(1),
          titolo(p.headline, 11),
          gap(3),
          el({ display: 'flex', fontSize: s(3.1), color: C.soft, maxWidth: s(70) }, p.sub),
          grow(0.5),
          dotGrid(12, 1, C.mag, { gap: s(1.6), absolute: { bottom: s(18), left: C.pad, right: C.pad } }),
          gap(3),
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: C.mag }, 'ENTRADAS'),
            el({ display: 'flex', fontSize: s(2.4), color: 'rgba(255,255,255,0.5)' }, SITE_SLOT)
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'NOW', {
            fontFamily: f.display,
            fontSize: s(20),
            color: C.mag,
            fontWeight: 700,
            opacity: 0.35
          }, 'right')
        ]
      );
    }
  }
}

export const shock: StylePreset = {
  slug: 'shock',
  name: 'Shock',
  thesis: {
    it: 'Magenta caldo, barre nere, tag a spigolo vivo. Poster da evento, zero mezze misure.',
    en: 'Hot magenta, black bars, sharp tags. Event-poster energy, no middle ground.'
  },
  suits: {
    it: 'Festival, fiere, giveaway, talk, brand culturali ad alto contrasto.',
    en: 'Festivals, fairs, giveaways, talks, high-contrast cultural brands.'
  },
  fonts: { display: 'Archivo', body: 'Work Sans', mono: 'Work Sans' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'nero / bianco carta', en: 'black / paper white' } },
    { label: { it: 'accento', en: 'accent' }, value: { it: 'magenta shock', en: 'shock magenta' } },
    { label: { it: 'lista', en: 'list' }, value: { it: 'barre nere piene', en: 'solid black bars' } },
    { label: { it: 'numero', en: 'number' }, value: { it: 'magenta su bianco', en: 'magenta on white' } },
    { label: { it: 'tag', en: 'tag' }, value: { it: 'etichette a spigolo', en: 'sharp labels' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'fila di dots', en: 'dot row' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.mag, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.mag,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Work Sans'
  }
};
