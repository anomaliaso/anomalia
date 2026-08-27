/**
 * VETRINA — a shop window.
 *
 * The rule that no other preset follows: EVERY slide carries a photograph. Not because each one
 * needs it, but because a feed built this way reads as a catalogue rather than as a set of posters,
 * and that is what a brand selling objects actually wants. Type is the caption layer: small, plain,
 * subordinate to the picture, with a chip doing the work a price tag does in a window.
 *
 * Its answer to type over a photograph is the inverse of everyone else's: it LIGHTENS the image and
 * sets dark type on it. Editoriale fades to dark, Manifesto floods to dark, Sistema refuses and
 * lands a card — this one veils toward white, which is the lookbook move and the only one that
 * keeps a bright product bright.
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
  starMark,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#FFFFFF',
  ink: '#17150F',
  soft: '#6C6862',
  faint: '#9A958C',
  hair: '#E9E5DD',
  /** SLOT: the brand's colour lands here. */
  slot: '#3D3A34',
  pad: s(7)
};

const fonts = { display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', mono: 'Plus Jakarta Sans' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const contentW = PRESET_WIDTH - C.pad * 2;

  const chip = (text: string, bg = C.ink, fg = '#FFFFFF') =>
    el(
      {
        display: 'flex',
        alignSelf: 'flex-start',
        backgroundColor: bg,
        color: fg,
        padding: `${s(1)}px ${s(2.2)}px`,
        borderRadius: s(0.6),
        fontSize: s(2.1),
        fontWeight: 600,
        letterSpacing: s(2.1) * 0.1,
        textTransform: 'uppercase'
      },
      text
    );
  const titolo = (text: string, pct = 5.6, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 600,
        letterSpacing: s(pct) * -0.03,
        lineHeight: 1.1
      })
    );
  const corpo = (text: string, color = C.soft, pct = 2.8) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.45, color }, text);
  const footer = () =>
    col({}, [
      el({ display: 'flex', width: '100%', height: 1, backgroundColor: C.hair }, ''),
      row({ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(2.6) }, [
        row({ alignItems: 'center', gap: s(1.6) }, [
          el({ display: 'flex', width: s(2.2), height: s(2.2), borderRadius: s(0.5), backgroundColor: C.slot, flexShrink: 0 }, ''),
          el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, color: C.ink }, BRAND_SLOT)
        ]),
        el({ display: 'flex', fontSize: s(2.4), color: C.faint }, SITE_SLOT)
      ])
    ]);

  const banda = (src: string, hPct: number, label: string, body: El[]) =>
    col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
      el({ display: 'flex', position: 'relative', width: PRESET_WIDTH, height: s(hPct) }, [
        img(src, PRESET_WIDTH, s(hPct), { position: 'absolute', top: 0, left: 0 }),
        col({ position: 'absolute', left: C.pad, bottom: s(2.6) }, [chip(label)])
      ]),
      col({ padding: C.pad, flexGrow: 1 }, [...body, grow(1), footer()])
    ]);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
          col({ padding: C.pad, flexGrow: 1 }, [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              chip(p.kicker),
              starMark(C.slot, s(4.5))
            ]),
            gap(4),
            titolo(p.headline, 7.4),
            gap(3),
            corpo(p.sub, C.soft, 3),
            grow(1),
            footer()
          ]),
          img(photos.a, PRESET_WIDTH, s(46))
        ]),
        undefined,
        [dotGrid(5, 3, C.hair, { absolute: { position: 'absolute', top: C.pad, right: C.pad } })]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(to bottom, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.9) 58%, rgba(255,255,255,0.96) 100%)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          tape(p.kicker, C.ink, '#FFFFFF'),
          grow(1),
          titolo(p.headline, 8.6),
          gap(3),
          corpo(p.sub, C.soft, 3.1),
          gap(3),
          barcode(s(30), s(4), C.ink),
          grow(0.5),
          footer()
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return banda(photos.c, 44, p.kicker, [
        row({ gap: s(3) }, [
          brackets(s(10), C.slot),
          col({ color: C.ink, flexGrow: 1 }, lines(p.quote, { fontSize: s(3.8), fontWeight: 500, lineHeight: 1.34, letterSpacing: s(3.8) * -0.02 }))
        ]),
        gap(3.4),
        row({ alignItems: 'center', gap: s(2) }, [
          el({ display: 'flex', width: s(4.6), height: s(4.6), borderRadius: s(4.6), backgroundColor: C.slot, flexShrink: 0 }, ''),
          col({}, [
            el({ display: 'flex', fontSize: s(2.8), fontWeight: 600, color: C.ink }, p.author),
            el({ display: 'flex', fontSize: s(2.4), color: C.faint }, p.role)
          ])
        ])
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        el({ display: 'flex', position: 'relative', width: PRESET_WIDTH, height: s(38) }, [
          img(photos.b, PRESET_WIDTH, s(38), { position: 'absolute', top: 0, left: 0 }),
          col({ position: 'absolute', left: C.pad, bottom: s(2.4) }, [chip(p.kicker)])
        ]),
        col({ padding: C.pad, flexGrow: 1 }, [
          row({ alignItems: 'flex-start', gap: s(4) }, [
            col({ flexGrow: 1 }, [
              titolo(p.headline, 5.4),
              gap(3),
              col(
                {},
                p.items.map((it, i) =>
                  col({}, [
                    i === 0 ? el({ display: 'flex', width: '100%', height: 1, backgroundColor: C.hair }, '') : el({ display: 'flex' }, ''),
                    row({ alignItems: 'center', gap: s(2.6), paddingTop: s(2.4), paddingBottom: s(2.4) }, [
                      el({ display: 'flex', fontSize: s(2.4), fontWeight: 600, color: C.faint, width: s(4), flexShrink: 0 }, String(i + 1).padStart(2, '0')),
                      el({ display: 'flex', fontSize: s(2.8), color: C.ink }, it)
                    ]),
                    el({ display: 'flex', width: '100%', height: 1, backgroundColor: C.hair }, '')
                  ])
                )
              )
            ]),
            col({ paddingTop: s(2) }, [chevronStack(5, C.slot, s(3))])
          ]),
          grow(1),
          footer()
        ])
      ]);
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const meta = (src: string, label: string, items: readonly string[], accent: boolean) =>
        col({ flexGrow: 1, flexBasis: 0, gap: s(2) }, [
          el({ display: 'flex', position: 'relative', width: (contentW - s(3)) / 2, height: s(34) }, [
            img(src, (contentW - s(3)) / 2, s(34), { position: 'absolute', top: 0, left: 0, borderRadius: s(1) }),
            col({ position: 'absolute', left: s(1.6), bottom: s(1.6) }, [
              chip(label, accent ? C.slot : '#FFFFFF', accent ? '#FFFFFF' : C.ink)
            ])
          ]),
          ...items.map((it) =>
            el(
              {
                display: 'flex',
                fontSize: s(2.5),
                lineHeight: 1.35,
                color: accent ? C.ink : C.soft,
                fontWeight: accent ? 500 : 400
              },
              it
            )
          )
        ]);
      return col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, padding: C.pad, fontFamily: f.body }, [
        chip(p.kicker),
        gap(4),
        titolo(p.headline, 6.4),
        gap(5),
        row({ gap: s(3) }, [meta(photos.b, p.a.label, p.a.items, false), meta(photos.c, p.b.label, p.b.items, true)]),
        grow(1),
        footer()
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return banda(photos.b, 62, p.kicker, [
        titolo(p.headline, 6),
        gap(2.6),
        row({ alignItems: 'center', gap: s(2) }, [
          arrow(C.slot, s(3.5)),
          corpo(p.sub)
        ]),
        gap(2),
        el({ display: 'flex', fontSize: s(2.3), color: C.faint }, p.caption)
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ paddingTop: C.pad, paddingBottom: C.pad, paddingLeft: C.pad, justifyContent: 'center' }, [
          letterStack('STAT', { fontFamily: f.display, fontSize: s(2.8), color: C.slot, fontWeight: 600 })
        ]),
        col({ flexGrow: 1 }, [
          el({ display: 'flex', position: 'relative', width: contentW + C.pad, height: s(42) }, [
            img(photos.a, contentW + C.pad, s(42), { position: 'absolute', top: 0, left: 0 }),
            col({ position: 'absolute', left: 0, bottom: s(2.4) }, [chip(p.kicker)])
          ]),
          col({ padding: C.pad, paddingLeft: 0, flexGrow: 1 }, [
            row({ alignItems: 'flex-end', gap: s(3) }, [
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(16),
                  fontWeight: 600,
                  lineHeight: 0.86,
                  letterSpacing: s(16) * -0.045,
                  color: C.ink
                },
                p.stat
              ),
              col({ paddingBottom: s(1), color: C.soft, flexShrink: 1 }, lines(p.label, { fontSize: s(2.6), lineHeight: 1.35 }))
            ]),
            gap(3.4),
            corpo(p.sub, C.faint, 2.6),
            grow(1),
            footer()
          ])
        ])
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        banda(photos.c, 46, p.kicker, [
          col(
            { gap: s(1.8) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2) }, [
                el({ display: 'flex', width: s(1.4), height: s(1.4), borderRadius: s(1.4), backgroundColor: C.slot, flexShrink: 0 }, ''),
                el({ display: 'flex', fontSize: s(2.7), color: C.ink }, a)
              ])
            )
          ),
          gap(3.4),
          row({ alignItems: 'center', gap: s(2) }, [
            el({ display: 'flex', width: s(5), height: s(5), borderRadius: s(5), backgroundColor: C.slot, flexShrink: 0 }, ''),
            el({ display: 'flex', fontFamily: f.display, fontSize: s(4.2), fontWeight: 600, color: C.ink }, p.handle)
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

export const vetrina: StylePreset = {
  slug: 'vetrina',
  name: 'Vetrina',
  thesis: {
    it: 'Un catalogo. Ogni singola slide porta una fotografia e il testo fa la didascalia, mai il protagonista.',
    en: 'A catalogue. Every single slide carries a photograph and the type stays a caption, never the lead.'
  },
  suits: {
    it: 'Chi vende cose che si guardano: ecommerce, arredo, food, artigianato, immobiliare.',
    en: 'Brands selling things people look at: ecommerce, interiors, food, craft, real estate.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'bianco, foto ovunque', en: 'white, photos throughout' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'sans 600, contenuto', en: 'restrained sans 600' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'velo verso il bianco', en: 'veiled toward white' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'due foto affiancate', en: 'two photos side by side' } },
    { label: { it: 'marchiatura', en: 'tagging' }, value: { it: 'chip da cartellino', en: 'price-tag chip' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'foto + blocco azioni', en: 'photo + action block' } }
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
