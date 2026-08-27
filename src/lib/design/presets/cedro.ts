/**
 * CEDRO — orange corporate.
 *
 * Reference: Cedar Equity / FOREMARK — cream ground, vibrant orange accent, charcoal type.
 * Checker blocks, orange squares with brand, bold sans headlines. Gradient simulated as stacked
 * orange→cream bands. No rotate.
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
import { canvas } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  cream: '#F5EDE4',
  orange: '#FF5A00',
  ink: '#1A1A1A',
  soft: 'rgba(26,26,26,0.62)',
  white: '#FFFFFF',
  pad: s(7)
};

const fonts = { display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', mono: 'Plus Jakarta Sans' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 10, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.035,
        lineHeight: 0.94
      })
    );

  const corpo = (text: string, color = C.soft, pct = 2.9) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.4, fontWeight: 500, color }, text);

  const kicker = (text: string, color = C.orange) =>
    el(
      {
        display: 'flex',
        fontSize: s(2.2),
        fontWeight: 700,
        color,
        textTransform: 'uppercase',
        letterSpacing: s(2.2) * 0.1
      },
      text
    );

  const brandBar = (bg = C.orange, fg = C.white) =>
    row(
      {
        width: '100%',
        backgroundColor: bg,
        padding: `${s(2.4)}px ${C.pad}px`,
        justifyContent: 'space-between',
        alignItems: 'center'
      },
      [
        el({ display: 'flex', fontSize: s(2.6), fontWeight: 700, color: fg }, BRAND_SLOT),
        el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color: fg }, SITE_SLOT)
      ]
    );

  /** 2×2 checker — one cell holds brand name on orange. */
  const checker = (cell = s(14)) => {
    const sq = (bg: string, label?: string) =>
      el(
        {
          display: 'flex',
          width: cell,
          height: cell,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        },
        label
          ? el(
              {
                display: 'flex',
                fontSize: s(1.8),
                fontWeight: 700,
                color: C.white,
                textTransform: 'uppercase',
                letterSpacing: s(1.8) * 0.04
              },
              label
            )
          : ''
      );
    return col({ gap: 0 }, [
      row({ gap: 0 }, [sq(C.cream), sq(C.orange, BRAND_SLOT.split(' ')[0] ?? 'BRAND')]),
      row({ gap: 0 }, [sq(C.orange), sq(C.cream)])
    ]);
  };

  /** Stacked orange→cream bands (gradient stand-in without CSS gradient on type). */
  const orangeBands = (h = s(18)): El =>
    col(
      { width: PRESET_WIDTH, height: h, flexShrink: 0 },
      [
        el({ display: 'flex', flexGrow: 1, backgroundColor: C.orange }, ''),
        el({ display: 'flex', flexGrow: 1, backgroundColor: '#FF7A33' }, ''),
        el({ display: 'flex', flexGrow: 1, backgroundColor: '#FFB380' }, ''),
        el({ display: 'flex', flexGrow: 1, backgroundColor: C.cream }, '')
      ]
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.cream,
        col({ padding: C.pad, fontFamily: f.body, flexGrow: 1 }, [
          kicker(p.kicker),
          grow(1),
          titolo(p.headline, 11.5),
          gap(3.6),
          corpo(p.sub, C.soft, 3),
          grow(0.6),
          row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 600, color: C.ink }, SITE_SLOT),
            checker(s(13))
          ])
        ])
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const photoH = Math.round(PRESET_HEIGHT * 0.55);
      const barH = PRESET_HEIGHT - photoH;
      return canvas(
        C.cream,
        col({ fontFamily: f.body }, [
          el(
            { display: 'flex', width: PRESET_WIDTH, height: photoH, overflow: 'hidden', flexShrink: 0 },
            [img(photos.a, PRESET_WIDTH, photoH)]
          ),
          col(
            {
              width: PRESET_WIDTH,
              height: barH,
              backgroundColor: C.orange,
              padding: C.pad,
              justifyContent: 'center'
            },
            [
              kicker(p.kicker, C.white),
              gap(2),
              titolo(p.headline, 7.5, C.white),
              gap(2),
              corpo(p.sub, 'rgba(255,255,255,0.85)', 2.6),
              gap(3),
              el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: C.white }, BRAND_SLOT)
            ]
          )
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.orange,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker, C.white),
          grow(1),
          col(
            { color: C.white, maxWidth: s(82) },
            lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(5.6),
              fontWeight: 700,
              letterSpacing: s(5.6) * -0.03,
              lineHeight: 1.12
            })
          ),
          gap(4),
          el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: C.white }, p.author),
          gap(0.6),
          el({ display: 'flex', fontSize: s(2.5), fontWeight: 500, color: 'rgba(255,255,255,0.78)' }, p.role),
          grow(0.45),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.white }, BRAND_SLOT),
            el({ display: 'flex', width: s(5), height: s(5), backgroundColor: C.cream }, '')
          ])
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.cream,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(3.5),
          titolo(p.headline, 9),
          gap(5),
          col(
            { gap: s(3) },
            p.items.map((it) =>
              row({ alignItems: 'flex-start', gap: s(2.6) }, [
                el(
                  {
                    display: 'flex',
                    width: s(2.4),
                    height: s(2.4),
                    backgroundColor: C.orange,
                    marginTop: s(0.8),
                    flexShrink: 0
                  },
                  ''
                ),
                el({ display: 'flex', fontSize: s(3.4), fontWeight: 600, color: C.ink, lineHeight: 1.25 }, it)
              ])
            )
          ),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, BRAND_SLOT),
            checker(s(10))
          ])
        ])
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.cream,
        col({ fontFamily: f.body }, [
          col({ padding: C.pad, paddingBottom: s(4) }, [
            kicker(p.kicker),
            gap(2.4),
            titolo(p.headline, 7.5)
          ]),
          row({ flexGrow: 1 }, [
            col(
              {
                flexGrow: 1,
                flexBasis: 0,
                backgroundColor: C.ink,
                padding: C.pad,
                gap: s(1.8)
              },
              [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.4),
                    fontWeight: 700,
                    color: C.orange,
                    textTransform: 'uppercase'
                  },
                  p.a.label
                ),
                gap(1.2),
                ...p.a.items.map((it) =>
                  el({ display: 'flex', fontSize: s(2.6), fontWeight: 500, color: 'rgba(255,255,255,0.78)', lineHeight: 1.3 }, it)
                )
              ]
            ),
            col(
              {
                flexGrow: 1,
                flexBasis: 0,
                backgroundColor: C.orange,
                padding: C.pad,
                gap: s(1.8)
              },
              [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.4),
                    fontWeight: 700,
                    color: C.white,
                    textTransform: 'uppercase'
                  },
                  p.b.label
                ),
                gap(1.2),
                ...p.b.items.map((it) =>
                  el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, color: C.white, lineHeight: 1.3 }, it)
                )
              ]
            )
          ])
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoW = s(52);
      return canvas(
        C.cream,
        row({ fontFamily: f.body, height: '100%' }, [
          el(
            {
              display: 'flex',
              width: photoW,
              height: PRESET_HEIGHT,
              overflow: 'hidden',
              flexShrink: 0
            },
            [img(photos.b, photoW, PRESET_HEIGHT)]
          ),
          col(
            {
              flexGrow: 1,
              backgroundColor: C.orange,
              padding: C.pad,
              justifyContent: 'center'
            },
            [
              kicker(p.kicker, C.white),
              gap(3),
              titolo(p.headline, 6.5, C.white),
              gap(2.4),
              corpo(p.sub, 'rgba(255,255,255,0.85)', 2.6),
              gap(4),
              el({ display: 'flex', fontSize: s(2.2), fontWeight: 500, color: 'rgba(255,255,255,0.7)' }, p.caption),
              grow(0.3),
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.white }, BRAND_SLOT)
            ]
          )
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.cream,
        col({ fontFamily: f.body }, [
          col({ padding: C.pad, flexGrow: 1 }, [
            kicker(p.kicker),
            grow(1),
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(36),
                fontWeight: 700,
                lineHeight: 0.85,
                letterSpacing: s(36) * -0.05,
                color: C.ink
              },
              p.stat
            ),
            gap(2),
            el({ display: 'flex', width: s(28), height: s(1.4), backgroundColor: C.orange }, ''),
            gap(3.2),
            col({ color: C.ink, maxWidth: s(70) }, lines(p.label, { fontSize: s(3.6), fontWeight: 700, lineHeight: 1.2 })),
            gap(2),
            corpo(p.sub),
            grow(0.4)
          ]),
          brandBar(C.orange, C.white)
        ])
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.orange,
        col({ fontFamily: f.body }, [
          orangeBands(s(14)),
          col({ padding: C.pad, flexGrow: 1 }, [
            kicker(p.kicker, C.white),
            grow(1),
            titolo(p.headline, 12, C.white),
            gap(3),
            corpo(p.sub, 'rgba(255,255,255,0.85)', 3),
            gap(4),
            col(
              { gap: s(2.2) },
              p.actions.map((a) =>
                row({ alignItems: 'center', gap: s(2) }, [
                  el({ display: 'flex', width: s(2), height: s(2), backgroundColor: C.cream, flexShrink: 0 }, ''),
                  el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.white }, a)
                ])
              )
            ),
            grow(0.45),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(5),
                  fontWeight: 700,
                  color: C.white,
                  letterSpacing: s(5) * -0.02
                },
                p.handle
              ),
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.cream }, BRAND_SLOT)
            ])
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const cedro: StylePreset = {
  slug: 'cedro',
  name: 'Cedro',
  thesis: {
    it: 'Corporate arancione su crema. Checker, barre brand, sans bold — energia da equity house.',
    en: 'Orange corporate on cream. Checkers, brand bars, bold sans — equity-house energy.'
  },
  suits: {
    it: 'Real estate, finance, corporate brand, hospitality premium, chi vuole calore e autorità.',
    en: 'Real estate, finance, corporate brands, premium hospitality — warmth with authority.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'crema #F5EDE4', en: 'cream #F5EDE4' } },
    { label: { it: 'accento', en: 'accent' }, value: { it: 'arancio #FF5A00', en: 'orange #FF5A00' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'Jakarta / Inter bold', en: 'Jakarta / Inter bold' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'foto + barra arancio', en: 'photo + orange bar' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'checker 2×2', en: '2×2 checker' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'full-bleed arancio', en: 'orange full bleed' } }
  ],
  build,
  stories: makeStories({ bg: C.cream, ink: C.ink, accent: C.orange, soft: C.soft }),
  reel: {
    bg: C.cream,
    ink: C.ink,
    accent: C.orange,
    muted: C.soft,
    displayFont: fonts.display,
    bodyFont: fonts.body
  }
};
