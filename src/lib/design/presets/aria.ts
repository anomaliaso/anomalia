/**
 * ARIA — Oshea-style minimal type on cream.
 *
 * Reference move: a quiet cream ground, a huge bright-red grotesk headline tightly stacked with
 * lots of air, and a tiny brand mark bottom-left in the same red. Nothing else competes.
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
  letterStack
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F4F4F2',
  ink: '#E10600',
  black: '#0A0A0A',
  soft: '#8A8A86',
  faint: 'rgba(10,10,10,0.38)',
  pad: s(8)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 14, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.055,
        lineHeight: 0.88
      })
    );
  const corpo = (text: string, color = C.soft, pct = 2.8) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.45, fontWeight: 500, color, maxWidth: s(72) }, text);
  const brandTiny = () =>
    col({ gap: s(0.4) }, [
      el({ display: 'flex', fontSize: s(2.2), fontWeight: 700, color: C.ink, letterSpacing: s(2.2) * 0.04 }, BRAND_SLOT),
      el({ display: 'flex', fontSize: s(2), fontWeight: 500, color: C.soft }, SITE_SLOT)
    ]);
  const kicker = (text: string) =>
    el({
      display: 'flex',
      fontSize: s(2.2),
      fontWeight: 600,
      color: C.soft,
      textTransform: 'uppercase',
      letterSpacing: s(2.2) * 0.12
    }, text);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      // Huge 2-line red title centered-ish, brand+site tiny bottom left — max air
      const twoLine = p.headline.split('\n').slice(0, 2).join('\n');
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, flexGrow: 1 }, [
          grow(1.2),
          col({ alignItems: 'center', width: '100%' }, [
            titolo(twoLine, 15)
          ]),
          grow(1.4),
          brandTiny()
        ])
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.55) 100%)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          grow(1),
          el(
            {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: C.ink,
              padding: `${s(4)}px ${C.pad}px`,
              gap: s(1.6)
            },
            [
              titolo(p.headline, 8, '#FFFFFF'),
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 500, color: 'rgba(255,255,255,0.75)' }, p.sub)
            ]
          )
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(1),
          col(
            { color: C.ink, maxWidth: s(88) },
            lines(`“${p.quote}”`, {
              fontFamily: f.display,
              fontSize: s(6.2),
              fontWeight: 700,
              letterSpacing: s(6.2) * -0.04,
              lineHeight: 1.05
            })
          ),
          gap(5),
          el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.black }, p.author),
          gap(0.5),
          el({ display: 'flex', fontSize: s(2.4), fontWeight: 500, color: C.soft }, p.role),
          grow(0.6),
          brandTiny()
        ]),
        undefined,
        [
          letterStack('SAY', {
            fontFamily: f.display,
            fontSize: s(3.2),
            color: C.ink,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            top: s(18)
          })
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(3),
          titolo(p.headline, 9),
          gap(6),
          col(
            { gap: s(3.6) },
            p.items.map((it, i) =>
              row({ alignItems: 'baseline', gap: s(3) }, [
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(5.5),
                    fontWeight: 700,
                    color: C.ink,
                    lineHeight: 1,
                    letterSpacing: s(5.5) * -0.04,
                    flexShrink: 0,
                    width: s(8)
                  },
                  `0${i + 1}`
                ),
                el({ display: 'flex', fontSize: s(3.6), fontWeight: 600, color: C.black, lineHeight: 1.25 }, it)
              ])
            )
          ),
          grow(1),
          brandTiny()
        ]),
        undefined,
        [dotGrid(3, 8, C.ink, { gap: s(1.8), size: s(0.7), absolute: { position: 'absolute', right: C.pad, top: s(22) } })]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const colPane = (label: string, items: readonly string[], accent: boolean) =>
        col({ flexGrow: 1, paddingRight: accent ? 0 : s(4), paddingLeft: accent ? s(4) : 0 }, [
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(5),
              fontWeight: 700,
              color: accent ? C.ink : C.black,
              letterSpacing: s(5) * -0.04,
              lineHeight: 1
            },
            label
          ),
          gap(3.2),
          ...items.map((it) =>
            el({ display: 'flex', fontSize: s(2.7), fontWeight: 500, color: C.soft, lineHeight: 1.35, marginBottom: s(1.6) }, it)
          )
        ]);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(2.4),
          titolo(p.headline, 8),
          grow(0.4),
          row({ flexGrow: 1, alignItems: 'stretch' }, [
            colPane(p.a.label, p.a.items, false),
            el({ display: 'flex', width: 2, backgroundColor: C.ink, flexShrink: 0 }, ''),
            colPane(p.b.label, p.b.items, true)
          ]),
          brandTiny()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoW = Math.round(PRESET_WIDTH * 0.48);
      return canvas(
        C.bg,
        row({ fontFamily: f.body, height: '100%' }, [
          img(photos.b, photoW, PRESET_HEIGHT),
          col({ flexGrow: 1, padding: C.pad, justifyContent: 'center' }, [
            kicker(p.kicker),
            gap(3.2),
            titolo(p.headline, 7.5),
            gap(3),
            corpo(p.sub),
            grow(1),
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color: C.soft }, p.caption),
            gap(2),
            brandTiny()
          ])
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(1),
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(48),
              fontWeight: 700,
              lineHeight: 0.8,
              letterSpacing: s(48) * -0.06,
              color: C.ink
            },
            p.stat
          ),
          gap(4),
          col({ color: C.black }, lines(p.label, { fontSize: s(3.8), fontWeight: 600, lineHeight: 1.2 })),
          gap(2.4),
          corpo(p.sub),
          grow(0.7),
          brandTiny()
        ]),
        undefined,
        [
          el(
            { display: 'flex', position: 'absolute', right: C.pad, top: s(18) },
            [barcode(s(22), s(48), C.ink)]
          ),
          letterStack('AIR', {
            fontFamily: f.display,
            fontSize: s(4),
            color: C.ink,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            bottom: C.pad,
            opacity: 0.15
          })
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(0.8),
          titolo(p.headline, 13),
          gap(3),
          corpo(p.sub, C.soft, 3),
          gap(5),
          col(
            { gap: s(2.4) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                arrow(C.ink, s(3.6)),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.black }, a)
              ])
            )
          ),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(6),
                fontWeight: 700,
                color: C.ink,
                letterSpacing: s(6) * -0.04
              },
              p.handle
            ),
            chevronStack(3, C.ink, s(4))
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const aria: StylePreset = {
  slug: 'aria',
  name: 'Aria',
  thesis: {
    it: 'Crema, rosso acceso, tipografia enorme con tanta aria. Quasi niente altro.',
    en: 'Cream, bright red, huge type with lots of air. Almost nothing else.'
  },
  suits: {
    it: 'Fashion, design studios, editoriali minimal, brand che vogliono leggerezza e impatto tipografico.',
    en: 'Fashion, design studios, minimal editorials — brands that want air and typographic punch.'
  },
  fonts: { display: 'Archivo', body: 'Archivo', mono: 'Archivo' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'crema fredda', en: 'cool cream' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesk rosso 700', en: 'red grotesk 700' } },
    { label: { it: 'inchiostro', en: 'ink' }, value: { it: 'rosso #E10600', en: 'red #E10600' } },
    { label: { it: 'marchio', en: 'mark' }, value: { it: 'micro in basso a sinistra', en: 'micro bottom-left' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'striscia titolo rossa in basso', en: 'red title strip low' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'handle rosso + frecce', en: 'red handle + arrows' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.ink, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.ink,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Archivo'
  }
};
