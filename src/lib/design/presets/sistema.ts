/**
 * SISTEMA — a spec sheet.
 *
 * The rule: everything rests on a grid of hairlines and the type scale stays LOW. Where the other
 * presets get attention by making something big, this one gets it by making everything measured —
 * the read is "these people are precise", which is the only claim some brands need to make.
 *
 * On a photograph it never sets type over the image at all: an opaque card lands on top, like an
 * archive caption. Along with Manifesto's flat veil, it is one of the two treatments that survive a
 * photograph nobody chose.
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
  slideIndex,
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
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#FFFFFF',
  ink: '#111214',
  soft: '#61646B',
  hair: '#E3E5E8',
  /** SLOT: the brand's colour lands here. */
  slot: '#3B4A5A',
  pad: s(6.5)
};

const fonts = { display: 'Inter', body: 'Inter', mono: 'IBM Plex Mono' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const base = { width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, padding: C.pad, fontFamily: f.body };
  const contentW = PRESET_WIDTH - C.pad * 2;

  const rule = (color = C.hair) => el({ display: 'flex', width: '100%', height: 1, backgroundColor: color }, '');
  const mono = (size: number) => ({ fontFamily: f.mono, fontSize: s(size), letterSpacing: s(size) * 0.08 });
  const testata = (text: string) =>
    col({}, [
      row({ justifyContent: 'space-between', alignItems: 'center', paddingBottom: s(2.2) }, [
        el({ display: 'flex', ...mono(2.1), textTransform: 'uppercase', color: C.soft }, text),
        row({ alignItems: 'center', gap: s(1.2) }, [
          el({ display: 'flex', width: s(1), height: s(1), backgroundColor: C.slot }, ''),
          el({ display: 'flex', ...mono(2.1), color: C.soft }, slideIndex(kind))
        ])
      ]),
      rule()
    ]);
  const footer = () =>
    col({}, [
      rule(),
      row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(2.6) }, [
        el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, color: C.ink }, BRAND_SLOT),
        el({ display: 'flex', ...mono(2.1), color: C.soft }, SITE_SLOT)
      ])
    ]);
  const titolo = (text: string, pct = 6.4, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 600,
        letterSpacing: s(pct) * -0.025,
        lineHeight: 1.12
      })
    );
  const corpo = (text: string) =>
    el({ display: 'flex', paddingTop: s(2.6), fontSize: s(2.8), lineHeight: 1.45, color: C.soft }, text);
  const righe = (items: readonly string[], marker = false) =>
    col(
      {},
      items.map((it, i) =>
        col({}, [
          i === 0 ? rule() : el({ display: 'flex' }, ''),
          row(
            { alignItems: 'center', gap: s(3), paddingTop: s(2.8), paddingBottom: s(2.8), fontSize: s(2.9), color: C.ink },
            [
              el({ display: 'flex', ...mono(2.3), width: s(5), flexShrink: 0, color: C.slot }, String(i + 1).padStart(2, '0')),
              el({ display: 'flex', flexGrow: 1 }, it),
              ...(marker ? [el({ display: 'flex', width: s(2), height: s(2), backgroundColor: C.slot, flexShrink: 0 }, '')] : [])
            ]
          ),
          rule()
        ])
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          testata(p.kicker),
          gap(6),
          titolo(p.headline),
          gap(6),
          rule(),
          corpo(p.sub),
          grow(1),
          footer()
        ]),
        undefined,
        [dotGrid(6, 8, C.hair, { absolute: { position: 'absolute', top: 0, right: 0, padding: C.pad } })]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const chip = (text: string) =>
        el(
          {
            display: 'flex',
            ...mono(2.1),
            textTransform: 'uppercase',
            color: C.ink,
            backgroundColor: '#FFFFFF',
            padding: `${s(0.9)}px ${s(1.6)}px`
          },
          text
        );
      return fullBleed(
        photos.a,
        'rgba(10,12,14,0.22)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'center' }, [chip(p.kicker), chip(slideIndex(kind))]),
          grow(1),
          col({ backgroundColor: '#FFFFFF', padding: s(5) }, [
            titolo(p.headline),
            gap(3),
            rule(),
            corpo(p.sub),
            gap(3),
            rule(),
            row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(2.4) }, [
              el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: C.ink }, BRAND_SLOT),
              el({ display: 'flex', ...mono(2), color: C.soft }, SITE_SLOT)
            ])
          ])
        ]),
        C.ink
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return col(base, [
        testata(p.kicker),
        gap(6),
        row({ gap: s(4) }, [
          brackets(s(14), C.slot),
          col({ border: `1px solid ${C.hair}`, padding: s(5), flexGrow: 1 }, [
            col(
              { color: C.ink },
              lines(p.quote, { fontSize: s(3.9), fontWeight: 500, lineHeight: 1.35, letterSpacing: s(3.9) * -0.015 })
            )
          ])
        ]),
        gap(4),
        rule(),
        row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(2.8), paddingBottom: s(2.8) }, [
          el({ display: 'flex', ...mono(2.1), textTransform: 'uppercase', color: C.soft }, 'Source'),
          el({ display: 'flex', fontSize: s(2.9), fontWeight: 600, color: C.ink }, p.author)
        ]),
        rule(),
        row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(2.8), paddingBottom: s(2.8) }, [
          el({ display: 'flex', ...mono(2.1), textTransform: 'uppercase', color: C.soft }, 'Role'),
          el({ display: 'flex', fontSize: s(2.9), color: C.ink }, p.role)
        ]),
        rule(),
        grow(1),
        footer()
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ flexGrow: 1, padding: C.pad }, [
          testata(p.kicker),
          gap(5),
          titolo(p.headline),
          gap(5),
          righe(p.items),
          grow(1),
          footer()
        ]),
        col({ paddingTop: C.pad, paddingBottom: C.pad, paddingRight: s(4), justifyContent: 'center' }, [
          chevronStack(7, C.slot, s(2.8))
        ])
      ]);
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const maxRows = Math.max(p.a.items.length, p.b.items.length);
      const head = row({ paddingTop: s(2.6), paddingBottom: s(2.6), gap: s(4) }, [
        el(
          { display: 'flex', flexGrow: 1, flexBasis: 0, ...mono(2.1), textTransform: 'uppercase', color: C.soft },
          p.a.label
        ),
        row({ flexGrow: 1, flexBasis: 0, alignItems: 'center', gap: s(1.4) }, [
          el({ display: 'flex', width: s(1), height: s(1), backgroundColor: C.slot }, ''),
          el({ display: 'flex', ...mono(2.1), textTransform: 'uppercase', color: C.slot }, p.b.label)
        ])
      ]);
      const body = Array.from({ length: maxRows }, (_, i) =>
        col({}, [
          rule(),
          row({ paddingTop: s(2.8), paddingBottom: s(2.8), gap: s(4) }, [
            el({ display: 'flex', flexGrow: 1, flexBasis: 0, fontSize: s(2.7), lineHeight: 1.3, color: C.soft }, p.a.items[i] ?? ''),
            el(
              { display: 'flex', flexGrow: 1, flexBasis: 0, fontSize: s(2.7), lineHeight: 1.3, fontWeight: 600, color: C.ink },
              p.b.items[i] ?? ''
            )
          ])
        ])
      );
      return col(base, [testata(p.kicker), gap(5), titolo(p.headline), gap(5), head, ...body, rule(), grow(1), footer()]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return col(base, [
        testata(p.kicker),
        gap(5),
        titolo(p.headline),
        gap(5),
        rule(),
        corpo(p.sub),
        rule(),
        gap(3),
        img(photos.b, contentW, s(46)),
        gap(1.6),
        row({ justifyContent: 'space-between', alignItems: 'center' }, [
          el({ display: 'flex', ...mono(2), color: C.soft }, p.caption),
          barcode(s(18), s(3.5), C.slot)
        ]),
        grow(1),
        footer()
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ paddingTop: C.pad, paddingBottom: C.pad, paddingLeft: C.pad, justifyContent: 'center' }, [
          letterStack('DATA', { fontFamily: f.mono, fontSize: s(2.4), color: C.slot, fontWeight: 600 })
        ]),
        col({ flexGrow: 1, padding: C.pad, paddingLeft: 0 }, [
          testata(p.kicker),
          gap(7),
          row({ alignItems: 'flex-start', gap: s(4) }, [
            el(
              { display: 'flex', fontSize: s(17), fontWeight: 600, letterSpacing: s(17) * -0.04, lineHeight: 0.9, color: C.ink },
              p.stat
            ),
            col({ paddingTop: s(1), color: C.soft, flexShrink: 1 }, lines(p.label, { fontSize: s(2.9), lineHeight: 1.4 }))
          ]),
          gap(6),
          rule(),
          corpo(p.sub),
          grow(1),
          footer()
        ])
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          testata(p.kicker),
          gap(4),
          rule(),
          corpo(p.sub),
          gap(3),
          righe(p.actions, true),
          grow(1),
          rule(),
          row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(3) }, [
            row({ alignItems: 'center', gap: s(2.4) }, [
              el({ display: 'flex', width: s(6), height: s(6), backgroundColor: C.slot, flexShrink: 0 }, ''),
              el({ display: 'flex', fontSize: s(4.4), fontWeight: 600, letterSpacing: s(4.4) * -0.02, color: C.ink }, p.handle)
            ]),
            arrow(C.slot, s(4.5))
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline, {
            fontFamily: f.display,
            fontSize: s(9),
            color: C.ink,
            fontWeight: 600
          }, 'top')
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const sistema: StylePreset = {
  slug: 'sistema',
  name: 'Sistema',
  thesis: {
    it: 'Una scheda tecnica. Tutto poggia su una griglia di filetti e la scala tipografica resta bassa.',
    en: 'A spec sheet. Everything rests on a grid of hairlines and the type scale stays low.'
  },
  suits: {
    it: 'Chi vende precisione: SaaS, B2B, finance, studi tecnici, data.',
    en: 'Brands selling precision: SaaS, B2B, finance, engineering, data.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'bianco clinico', en: 'clinical white' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesque 600', en: 'grotesque 600' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'scheda opaca sopra', en: 'opaque card on top' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'tabella a due colonne', en: 'two-column table' } },
    { label: { it: 'citazione', en: 'quote' }, value: { it: 'fonte e ruolo a campi', en: 'source as labelled fields' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'azioni come righe', en: 'actions as rows' } }
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
