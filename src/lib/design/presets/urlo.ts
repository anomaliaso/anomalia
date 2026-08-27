/**
 * URLO — a shout on a primary colour.
 *
 * The Social Hub energy without being a copy: saturated ground, contemporary heavy type that
 * fills the canvas, and a stamp for the kicker. Where Manifesto is black-and-white aggression,
 * this one is colour volume — the kind of post that reads as a community brand, not a poster.
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
  bg: '#FFE14A',
  ink: '#111111',
  soft: 'rgba(17,17,17,0.62)',
  faint: 'rgba(17,17,17,0.42)',
  slot: '#FF2E63',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const stamp = (text: string, bg = C.slot, fg = '#FFFFFF') => tape(text, bg, fg);
  const titolo = (text: string, pct = 11.5, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.045,
        lineHeight: 0.92
      })
    );
  const corpo = (text: string, color = C.soft, pct = 3.2) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.35, fontWeight: 600, color }, text);
  const hub = (size = s(5.5), color = C.ink) =>
    el({ display: 'flex', width: size, height: size, borderRadius: size, backgroundColor: color, flexShrink: 0 }, '');
  const footer = (ink = C.ink, faint = C.faint) =>
    row({ justifyContent: 'space-between', alignItems: 'center' }, [
      row({ alignItems: 'center', gap: s(2) }, [
        hub(s(4.2), C.slot),
        el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: ink }, BRAND_SLOT)
      ]),
      el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: faint }, SITE_SLOT)
    ]);
  const lista = (items: readonly string[]) =>
    col(
      { gap: s(2.2) },
      items.map((it, i) =>
        row({ alignItems: 'center', gap: s(2.6) }, [
          el(
            {
              display: 'flex',
              width: s(6.2),
              height: s(6.2),
              borderRadius: s(6.2),
              backgroundColor: C.ink,
              color: C.bg,
              fontSize: s(2.6),
              fontWeight: 700,
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            },
            `0${i + 1}`
          ),
          el({ display: 'flex', fontSize: s(3.4), fontWeight: 700, color: C.ink, lineHeight: 1.2 }, it)
        ])
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, flexGrow: 1 }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            stamp(p.kicker),
            dotGrid(5, 4, C.slot, { gap: s(1.4), size: s(1) })
          ]),
          grow(1),
          titolo(p.headline, 12),
          gap(3.6),
          corpo(p.sub, C.ink),
          grow(0.5),
          footer()
        ]),
        undefined,
        [
          overflowTitle('READ', { fontFamily: f.display, fontSize: s(24), color: C.slot, fontWeight: 700 }, 'right')
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'rgba(255,225,74,0.78)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          stamp(p.kicker),
          grow(1),
          titolo(p.headline, 11),
          gap(3.2),
          corpo(p.sub, C.ink),
          grow(0.45),
          footer()
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.slot,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          starMark('#FFFFFF', s(9)),
          grow(1),
          col(
            { color: '#FFFFFF', alignItems: 'center', maxWidth: s(82) },
            lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(5.4),
              fontWeight: 700,
              letterSpacing: s(5.4) * -0.03,
              lineHeight: 1.1,
              justifyContent: 'center'
            })
          ),
          gap(4),
          el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: '#FFFFFF' }, p.author),
          gap(0.6),
          el({ display: 'flex', fontSize: s(2.7), fontWeight: 600, color: 'rgba(255,255,255,0.75)' }, p.role),
          grow(0.5),
          footer('#FFFFFF', 'rgba(255,255,255,0.65)')
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body, height: '100%' }, [
          col({ flexGrow: 1, paddingRight: s(4) }, [
            stamp(p.kicker, C.ink, C.bg),
            gap(4),
            lista(p.items),
            grow(1),
            barcode(s(40), s(5), C.ink)
          ]),
          col({ justifyContent: 'center', paddingTop: s(12) }, [
            letterStack('HOW', { fontFamily: f.display, fontSize: s(4.2), color: C.slot, fontWeight: 700 })
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'STEPS', {
            fontFamily: f.display,
            fontSize: s(16),
            color: C.ink,
            fontWeight: 700,
            opacity: 0.12
          }, 'bottom')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ fontFamily: f.body }, [
          col({ backgroundColor: C.ink, padding: C.pad, flexGrow: 1 }, [
            stamp(p.kicker, C.bg, C.ink),
            gap(3),
            titolo(p.a.label, 7, C.bg),
            gap(2.4),
            ...p.a.items.map((it) => el({ display: 'flex', fontSize: s(2.8), fontWeight: 600, color: C.soft }, it))
          ]),
          col({ padding: C.pad, flexGrow: 1 }, [
            titolo(p.b.label, 7, C.slot),
            gap(2.4),
            ...p.b.items.map((it) => el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.ink }, it)),
            grow(1),
            footer()
          ])
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const contentW = PRESET_WIDTH - C.pad * 2;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          stamp(p.kicker, C.ink, C.bg),
          gap(3.4),
          titolo(p.headline, 8.2),
          gap(2.6),
          corpo(p.sub),
          grow(1),
          img(photos.b, contentW, s(48), { borderRadius: s(4) }),
          gap(2),
          el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.soft }, p.caption),
          gap(3),
          footer()
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body }, [
          col({ flexGrow: 1 }, [
            stamp(p.kicker),
            grow(1),
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(42),
                fontWeight: 700,
                lineHeight: 0.82,
                letterSpacing: s(42) * -0.05,
                color: C.ink
              },
              p.stat
            ),
            gap(3.4),
            col({ color: C.ink }, lines(p.label, { fontSize: s(4), fontWeight: 700, lineHeight: 1.15 })),
            grow(0.55),
            footer()
          ]),
          col({ justifyContent: 'center', paddingLeft: s(2) }, [
            letterStack('STAT', { fontFamily: f.display, fontSize: s(3.6), color: C.slot, fontWeight: 700 })
          ])
        ]),
        undefined,
        [barcode(s(28), s(52), C.ink)]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.slot,
        col({ padding: C.pad, fontFamily: f.body }, [
          stamp(p.kicker, C.bg, C.ink),
          grow(1),
          titolo(p.headline, 12, '#FFFFFF'),
          gap(3.2),
          corpo(p.sub, 'rgba(255,255,255,0.82)'),
          gap(4),
          lista(p.actions),
          grow(0.45),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            row({ alignItems: 'center', gap: s(2.2) }, [
              hub(s(6), C.bg),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(5.4),
                  fontWeight: 700,
                  color: '#FFFFFF',
                  letterSpacing: s(5.4) * -0.03
                },
                p.handle
              )
            ]),
            chevronStack(3, C.bg, s(4.5))
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const urlo: StylePreset = {
  slug: 'urlo',
  name: 'Urlo',
  thesis: {
    it: 'Un urlo su un colore primario. Tipografia pesante, francobollo colorato, zero aria morta.',
    en: 'A shout on a primary colour. Heavy type, a coloured stamp, no dead air.'
  },
  suits: {
    it: 'Community brand, hospitality, eventi, education, D2C giovane — chi comunica come The Social Hub.',
    en: 'Community brands, hospitality, events, education, young D2C — anyone who communicates like The Social Hub.'
  },
  fonts: { display: 'Syne', body: 'Syne', mono: 'Syne' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'giallo elettrico', en: 'electric yellow' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'geometrico 800', en: 'geometric 800' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'wash del colore di fondo', en: 'washed in the ground colour' } },
    { label: { it: 'marchio', en: 'mark' }, value: { it: 'cerchio hub + stamp', en: 'hub circle + stamp' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'due schede invertite', en: 'two inverted panels' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'inverte sul rosa stamp', en: 'inverts to stamp pink' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.slot, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.slot,
    muted: C.soft,
    displayFont: 'Syne',
    bodyFont: 'Syne'
  }
};
