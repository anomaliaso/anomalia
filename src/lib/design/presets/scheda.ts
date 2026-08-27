/**
 * SCHEDA — project / agency white.
 *
 * Reference move: Vinc Media "About Project / Project Details" — pure white, left-aligned
 * column, small kicker top-left, huge bold title with → arrow, "About" + body, brand tiny.
 * Clean left axis, generous right air. No rotate.
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
import { arrow, canvas } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#FFFFFF',
  ink: '#0A0A0A',
  soft: '#555555',
  faint: 'rgba(10,10,10,0.38)',
  pad: s(8)
};

const fonts = { display: 'Inter', body: 'Inter', mono: 'Inter' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const contentW = PRESET_WIDTH - C.pad * 2;
  const leftCol = s(72);

  const kicker = (text: string, color = C.soft) =>
    el(
      {
        display: 'flex',
        fontSize: s(2.2),
        fontWeight: 500,
        color,
        textTransform: 'uppercase',
        letterSpacing: s(2.2) * 0.12
      },
      text
    );

  const titolo = (text: string, pct = 11, color = C.ink) =>
    col(
      { color, maxWidth: leftCol },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.04,
        lineHeight: 0.92
      })
    );

  const corpo = (text: string, color = C.soft, pct = 2.9) =>
    el(
      {
        display: 'flex',
        fontSize: s(pct),
        lineHeight: 1.45,
        fontWeight: 400,
        color,
        maxWidth: s(58)
      },
      text
    );

  const brandTiny = (ink = C.ink, muted = C.faint) =>
    row({ justifyContent: 'space-between', alignItems: 'center' }, [
      el({ display: 'flex', fontSize: s(2.2), fontWeight: 500, color: ink }, BRAND_SLOT),
      el({ display: 'flex', fontSize: s(2), fontWeight: 400, color: muted }, SITE_SLOT)
    ]);

  const titleWithArrow = (text: string, pct = 11) =>
    row({ alignItems: 'flex-start', gap: s(2.4), maxWidth: leftCol }, [
      titolo(text, pct),
      el({ display: 'flex', paddingTop: s(1.2) }, [arrow(C.ink, s(pct * 0.55))])
    ]);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, flexGrow: 1 }, [
          kicker(p.kicker),
          grow(1),
          titleWithArrow(p.headline, 12),
          gap(5),
          kicker('About', C.ink),
          gap(1.6),
          corpo(p.sub),
          grow(0.55),
          brandTiny()
        ])
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const stripH = s(42);
      return canvas(
        C.bg,
        col({ fontFamily: f.body }, [
          el(
            {
              display: 'flex',
              width: PRESET_WIDTH,
              height: PRESET_HEIGHT - stripH,
              overflow: 'hidden',
              flexShrink: 0
            },
            [img(photos.a, PRESET_WIDTH, PRESET_HEIGHT - stripH)]
          ),
          col(
            {
              width: PRESET_WIDTH,
              height: stripH,
              backgroundColor: C.bg,
              padding: `${s(4)}px ${C.pad}px`,
              justifyContent: 'center'
            },
            [
              kicker(p.kicker),
              gap(1.4),
              titolo(p.headline, 6.4),
              gap(1.2),
              corpo(p.sub, C.soft, 2.5),
              gap(2),
              brandTiny()
            ]
          )
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(1),
          row({ alignItems: 'flex-start', gap: s(2) }, [
            arrow(C.ink, s(6)),
            col(
              { color: C.ink, maxWidth: s(70), flexGrow: 1 },
              lines(p.quote, {
                fontFamily: f.display,
                fontSize: s(5.2),
                fontWeight: 600,
                letterSpacing: s(5.2) * -0.025,
                lineHeight: 1.15
              })
            )
          ]),
          gap(5),
          el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.ink }, p.author),
          gap(0.6),
          el({ display: 'flex', fontSize: s(2.4), fontWeight: 400, color: C.soft }, p.role),
          grow(0.5),
          brandTiny()
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(4),
          titleWithArrow(p.headline, 9),
          gap(6),
          col(
            { gap: s(3.2), maxWidth: leftCol },
            p.items.map((it, i) =>
              row({ alignItems: 'flex-start', gap: s(2.8) }, [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.4),
                    fontWeight: 700,
                    color: C.ink,
                    width: s(5),
                    flexShrink: 0
                  },
                  `0${i + 1}`
                ),
                el({ display: 'flex', fontSize: s(3.4), fontWeight: 500, color: C.ink, lineHeight: 1.25 }, it)
              ])
            )
          ),
          grow(1),
          brandTiny()
        ])
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const side = (label: string, items: readonly string[], strong: boolean) =>
        col({ flexGrow: 1, flexBasis: 0, maxWidth: s(42) }, [
          row({ alignItems: 'center', gap: s(1.6) }, [
            arrow(strong ? C.ink : C.soft, s(3.2)),
            el(
              {
                display: 'flex',
                fontSize: s(2.4),
                fontWeight: 700,
                color: strong ? C.ink : C.soft,
                textTransform: 'uppercase',
                letterSpacing: s(2.4) * 0.08
              },
              label
            )
          ]),
          gap(2.8),
          ...items.map((it) =>
            el(
              {
                display: 'flex',
                fontSize: s(2.7),
                fontWeight: strong ? 600 : 400,
                color: strong ? C.ink : C.soft,
                lineHeight: 1.35,
                paddingBottom: s(1.6)
              },
              it
            )
          )
        ]);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(4),
          titolo(p.headline, 8.5),
          gap(6),
          row({ gap: s(6), alignItems: 'flex-start' }, [side(p.a.label, p.a.items, false), side(p.b.label, p.b.items, true)]),
          grow(1),
          brandTiny()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoH = s(52);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          gap(3.2),
          titleWithArrow(p.headline, 7.5),
          gap(2.4),
          corpo(p.sub),
          grow(1),
          img(photos.b, contentW, photoH),
          gap(1.6),
          el({ display: 'flex', fontSize: s(2.2), fontWeight: 400, color: C.soft }, p.caption),
          gap(3),
          brandTiny()
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
          row({ alignItems: 'flex-start', gap: s(2.4) }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(28),
                fontWeight: 700,
                lineHeight: 0.85,
                letterSpacing: s(28) * -0.05,
                color: C.ink
              },
              p.stat
            ),
            el({ display: 'flex', paddingTop: s(2) }, [arrow(C.ink, s(7))])
          ]),
          gap(4),
          col({ color: C.ink, maxWidth: leftCol }, lines(p.label, { fontSize: s(3.6), fontWeight: 600, lineHeight: 1.2 })),
          gap(2.4),
          corpo(p.sub),
          grow(0.55),
          brandTiny()
        ])
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          kicker(p.kicker),
          grow(1),
          titleWithArrow(p.headline, 12),
          gap(3.2),
          corpo(p.sub),
          gap(5),
          col(
            { gap: s(2.6), maxWidth: leftCol },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.2) }, [
                arrow(C.ink, s(3.4)),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 500, color: C.ink }, a)
              ])
            )
          ),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(4.8),
                fontWeight: 700,
                color: C.ink,
                letterSpacing: s(4.8) * -0.02
              },
              p.handle
            ),
            el({ display: 'flex', fontSize: s(2), fontWeight: 400, color: C.faint }, BRAND_SLOT)
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const scheda: StylePreset = {
  slug: 'scheda',
  name: 'Scheda',
  thesis: {
    it: 'Scheda progetto su bianco puro. Asse sinistro pulito, titolo enorme con freccia, aria a destra.',
    en: 'A project sheet on pure white. Clean left axis, huge title with arrow, air on the right.'
  },
  suits: {
    it: 'Agenzie, studi, portfolio, case study, chi presenta un progetto con chiarezza.',
    en: 'Agencies, studios, portfolios, case studies — anyone presenting a project with clarity.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'bianco puro', en: 'pure white' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'Inter bold + freccia', en: 'Inter bold + arrow' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'foto + striscia bianca', en: 'photo + white type strip' } },
    { label: { it: 'asse', en: 'axis' }, value: { it: 'sinistra, aria a destra', en: 'left lock, right air' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'freccia →', en: 'arrow →' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'azioni con freccia', en: 'actions with arrow' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.ink, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.ink,
    muted: C.soft,
    displayFont: fonts.display,
    bodyFont: fonts.body
  }
};
