/**
 * EDITORIALE — a magazine.
 *
 * The rule that generates every slide: the headline is anchored LOW, everything above it is air,
 * and nothing else happens. One hairline in the brand colour is the only ornament allowed.
 *
 * On a photograph it fades from the bottom and lets the picture breathe. That is the prettiest of
 * the five answers and the only fragile one: a gradient cannot save a title that lands on a busy
 * area, and the photograph is not ours to choose.
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
  brackets,
  canvas,
  chevronStack,
  dotGrid,
  letterStack,
  overflowTitle,
  repeatPhrase,
  starMark,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F4F1EA',
  ink: '#191817',
  soft: '#6B6862',
  faint: '#9C988F',
  /** SLOT: the brand's colour lands here. */
  slot: '#8C4A33',
  pad: s(9)
};

const fonts = { display: 'Fraunces', body: 'Inter', mono: 'Inter' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const base = { width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, padding: C.pad, fontFamily: f.body };
  const contentW = PRESET_WIDTH - C.pad * 2;

  const kicker = (text: string, color = C.slot) =>
    el(
      {
        display: 'flex',
        fontSize: s(2.3),
        fontWeight: 500,
        letterSpacing: s(2.3) * 0.22,
        textTransform: 'uppercase',
        color
      },
      text
    );
  const filetto = (color = C.slot, w = 18) => el({ display: 'flex', width: s(w), height: 2, backgroundColor: color }, '');
  const footer = (ink = C.ink, faint = C.faint) =>
    row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
      row({ alignItems: 'center', gap: s(1.5) }, [
        el({ display: 'flex', width: s(2.1), height: s(2.1), borderRadius: s(2.1), backgroundColor: C.slot, flexShrink: 0 }, ''),
        el({ display: 'flex', fontSize: s(2.7), fontWeight: 500, color: ink }, BRAND_SLOT)
      ]),
      el({ display: 'flex', fontSize: s(2.5), color: faint }, SITE_SLOT)
    ]);
  const titolo = (text: string, pct = 9.4, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 400,
        letterSpacing: s(pct) * -0.03,
        lineHeight: 1.0
      })
    );
  const corpo = (text: string, color = C.soft, pct = 3.1) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.45, color }, text);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      // Title bleeds off the bottom; vertical stack on the left edge; dots in the corner.
      return canvas(
        C.bg,
        row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          col({ justifyContent: 'center', paddingRight: s(3) }, [
            letterStack('READ', { fontFamily: f.display, fontSize: s(2.8), color: C.slot, fontWeight: 400 })
          ]),
          col({ flexGrow: 1 }, [
            kicker(p.kicker),
            grow(1),
            corpo(p.sub, C.soft, 3.2),
            gap(3),
            titolo(p.headline, 10.2),
            gap(2),
            footer()
          ])
        ]),
        undefined,
        [
          dotGrid(5, 3, C.faint, { absolute: { position: 'absolute', top: C.pad, right: C.pad } }),
          overflowTitle(p.headline.split('\n')[0] ?? '', {
            fontFamily: f.display,
            fontSize: s(14),
            color: C.slot,
            fontWeight: 400,
            opacity: 0.12
          }, 'bottom')
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(to bottom, rgba(18,16,14,0.10) 30%, rgba(18,16,14,0.86) 100%)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tape(p.kicker, C.slot, '#FFFFFF'),
            starMark('rgba(255,255,255,0.7)', s(5))
          ]),
          grow(1),
          titolo(p.headline, 10.4, '#FFFFFF'),
          gap(3),
          filetto('#FFFFFF'),
          gap(3),
          corpo(p.sub, 'rgba(255,255,255,0.8)'),
          gap(3),
          barcode(s(32), s(4), 'rgba(255,255,255,0.55)'),
          grow(0.3),
          footer('#FFFFFF', 'rgba(255,255,255,0.6)')
        ]),
        C.ink
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return col(base, [
        row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
          kicker(p.kicker),
          brackets(s(10), C.slot)
        ]),
        grow(1),
        el(
          {
            display: 'flex',
            fontFamily: f.display,
            fontSize: s(18),
            lineHeight: 0.6,
            color: C.slot,
            height: s(9)
          },
          '“'
        ),
        gap(1),
        col(
          { color: C.ink },
          lines(p.quote, {
            fontFamily: f.display,
            fontSize: s(6.4),
            fontWeight: 400,
            letterSpacing: s(6.4) * -0.02,
            lineHeight: 1.18
          })
        ),
        gap(4.5),
        filetto(),
        gap(3),
        row({ alignItems: 'center', gap: s(2.4) }, [
          arrow(C.slot, s(4)),
          col({}, [
            el({ display: 'flex', fontSize: s(3.1), fontWeight: 500, color: C.ink }, p.author),
            el({ display: 'flex', fontSize: s(2.7), color: C.faint }, p.role)
          ])
        ]),
        grow(0.5),
        footer()
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      // Title at top; steps as a numbered column with chevrons — not the cover shell.
      return row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ flexGrow: 1, padding: C.pad }, [
          titolo(p.headline, 8.6),
          gap(4),
          filetto(),
          gap(4),
          col(
            { gap: s(3) },
            p.items.map((it, i) =>
              row({ alignItems: 'flex-start', gap: s(3) }, [
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(5),
                    fontWeight: 400,
                    color: C.slot,
                    width: s(6),
                    flexShrink: 0
                  },
                  String(i + 1)
                ),
                el({ display: 'flex', fontSize: s(3.2), lineHeight: 1.4, color: C.ink, paddingTop: s(0.8) }, it)
              ])
            )
          ),
          grow(1),
          footer()
        ]),
        col({ paddingTop: C.pad, paddingBottom: C.pad, paddingRight: s(4), justifyContent: 'center' }, [
          chevronStack(6, C.slot, s(3.2)),
          gap(4),
          kicker(p.kicker, C.faint)
        ])
      ]);
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const colonna = (label: string, items: readonly string[], accent: boolean) =>
        col({ flexGrow: 1, flexBasis: 0, gap: s(2.4) }, [
          el(
            {
              display: 'flex',
              fontSize: s(2.2),
              fontWeight: 500,
              letterSpacing: s(2.2) * 0.2,
              textTransform: 'uppercase',
              color: accent ? C.slot : C.faint
            },
            label
          ),
          ...items.map((it) =>
            el({ display: 'flex', fontSize: s(2.8), lineHeight: 1.35, color: accent ? C.ink : C.soft }, it)
          )
        ]);
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(3),
          titolo(p.headline, 7.6),
          gap(4),
          row({ gap: s(5) }, [
            colonna(p.a.label, p.a.items, false),
            el({ display: 'flex', width: 1, backgroundColor: '#D9D4C8' }, ''),
            colonna(p.b.label, p.b.items, true)
          ]),
          grow(1),
          footer()
        ]),
        undefined,
        [
          el(
            { display: 'flex', position: 'absolute', top: s(28), right: s(6), opacity: 0.08 },
            repeatPhrase('VS', 4, { fontFamily: f.display, fontSize: s(5), color: C.slot, fontWeight: 400 })
          )
        ]
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return col(base, [
        row({ justifyContent: 'space-between', alignItems: 'center' }, [
          kicker(p.kicker),
          tape('Fig. 01', C.ink, C.bg)
        ]),
        gap(3),
        img(photos.b, contentW, s(52)),
        gap(1.8),
        row({ alignItems: 'center', gap: s(1.6) }, [
          arrow(C.slot, s(3.5)),
          el({ display: 'flex', fontSize: s(2.4), color: C.faint }, p.caption)
        ]),
        grow(1),
        titolo(p.headline, 8.2),
        gap(3),
        corpo(p.sub),
        gap(4),
        footer()
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return col(base, [
        tape(p.kicker, C.slot, '#FFFFFF'),
        grow(1),
        row({ alignItems: 'flex-end', gap: s(4) }, [
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(30),
              fontWeight: 400,
              lineHeight: 0.9,
              letterSpacing: s(30) * -0.05,
              color: C.ink
            },
            p.stat
          ),
          col({ paddingBottom: s(1.5), color: C.soft, flexShrink: 1 }, lines(p.label, { fontSize: s(3.2), lineHeight: 1.35 }))
        ]),
        gap(4),
        barcode(s(38), s(4.5), C.ink),
        gap(4),
        corpo(p.sub, C.faint, 2.9),
        grow(0.3),
        footer()
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(1),
          col(
            { gap: s(2.6) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                starMark(C.slot, s(3.2)),
                el({ display: 'flex', fontSize: s(3.1), color: C.ink }, a)
              ])
            )
          ),
          gap(4),
          corpo(p.sub),
          gap(3),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            row({ alignItems: 'center', gap: s(2) }, [
              el({ display: 'flex', width: s(6), height: s(6), borderRadius: s(6), backgroundColor: C.slot, flexShrink: 0 }, ''),
              el({ display: 'flex', fontFamily: f.display, fontSize: s(5), color: C.ink }, p.handle)
            ]),
            el({ display: 'flex', fontSize: s(2.5), color: C.faint }, SITE_SLOT)
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline, {
            fontFamily: f.display,
            fontSize: s(11),
            color: C.ink,
            fontWeight: 400
          }, 'left')
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const editoriale: StylePreset = {
  slug: 'editoriale',
  name: 'Editoriale',
  thesis: {
    it: 'Una rivista. Il titolo è ancorato in basso, sopra c’è solo aria, e non succede nient’altro.',
    en: 'A magazine. The headline is anchored low, everything above it is air, and nothing else happens.'
  },
  suits: {
    it: 'Chi vende gusto, mestiere, tempo: ristorazione, moda, studi, consulenza.',
    en: 'Brands selling taste, craft, time: food, fashion, studios, consulting.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'carta avorio', en: 'ivory paper' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'serif alto contrasto', en: 'high-contrast serif' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'sfumatura dal basso', en: 'gradient from below' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'due colonne', en: 'two columns' } },
    { label: { it: 'citazione', en: 'quote' }, value: { it: 'virgoletta gigante', en: 'oversized quote mark' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'handle in serif', en: 'handle set in serif' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.slot, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.slot,
    muted: C.soft,
    displayFont: fonts.display,
    bodyFont: fonts.body
  }
};
