/**
 * PRISMA — atmospheric gradient, centred type.
 *
 * Reference move: a vertically streaked, grainy colour field with a small year above a tight
 * centred title. No stamps, no grid — atmosphere does the work.
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
  lines,
  row,
  s,
  type El,
  type PresetFonts,
  type PresetPhotos,
  type PresetSlide,
  type StylePreset
} from './shared';
import { canvas, letterStack, overflowTitle, starMark } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#2A1040',
  ink: '#FFFFFF',
  mute: '#C4A574',
  soft: 'rgba(255,255,255,0.72)',
  accent: '#C43B8C',
  pad: s(8)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const bands: El[] = [
    { color: '#6B1FA0', left: 0, w: 18 },
    { color: '#C43B8C', left: 14, w: 16 },
    { color: '#4A1A7A', left: 28, w: 14 },
    { color: '#E85A4F', left: 40, w: 12 },
    { color: '#7B2CBF', left: 50, w: 18 },
    { color: '#3D1560', left: 66, w: 16 },
    { color: '#D4567A', left: 80, w: 20 }
  ].map((b) =>
    el(
      {
        display: 'flex',
        position: 'absolute',
        top: 0,
        left: s(b.left),
        width: s(b.w),
        height: PRESET_HEIGHT,
        backgroundImage: `linear-gradient(180deg, ${b.color}00 0%, ${b.color} 45%, ${b.color}88 100%)`,
        opacity: 0.85
      },
      ''
    )
  );

  const field = (children: El[], extras: El[] = []): El =>
    canvas(
      C.bg,
      col(
        {
          position: 'relative',
          width: PRESET_WIDTH,
          height: PRESET_HEIGHT,
          padding: C.pad,
          alignItems: 'center',
          fontFamily: f.body
        },
        children
      ),
      undefined,
      [
        ...bands,
        el(
          {
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            backgroundImage: 'linear-gradient(180deg, rgba(20,8,30,0.25) 0%, rgba(20,8,30,0.55) 100%)'
          },
          ''
        ),
        ...extras
      ]
    );

  const year = (text: string) =>
    el(
      {
        display: 'flex',
        fontSize: s(2.8),
        fontWeight: 600,
        letterSpacing: s(2.8) * 0.14,
        textTransform: 'uppercase',
        color: C.mute
      },
      text
    );

  const titolo = (text: string, pct = 10) =>
    col(
      { color: C.ink, alignItems: 'center' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.03,
        lineHeight: 0.98,
        justifyContent: 'center'
      })
    );

  const corpo = (text: string) =>
    el(
      {
        display: 'flex',
        fontSize: s(3),
        lineHeight: 1.4,
        color: C.soft,
        textAlign: 'center',
        justifyContent: 'center',
        maxWidth: s(70)
      },
      text
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return field(
        [grow(1), year('2026'), gap(2.4), titolo(p.headline, 9.5), gap(2.4), corpo(p.sub), grow(1), row({ width: '100%', justifyContent: 'space-between' }, [
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, BRAND_SLOT),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ])],
        [
          letterStack('MOOD', {
            fontFamily: f.display,
            fontSize: s(3.6),
            color: C.accent,
            fontWeight: 700,
            position: 'absolute',
            left: C.pad,
            top: s(20)
          })
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(180deg, rgba(42,16,64,0.55) 0%, rgba(196,59,140,0.45) 50%, rgba(42,16,64,0.75) 100%)',
        col(
          { width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, alignItems: 'center', fontFamily: f.body },
          [grow(1), year(p.kicker), gap(2.4), titolo(p.headline, 9.4), gap(2.4), corpo(p.sub), grow(1)]
        ),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return field([
        starMark(C.accent, s(8)),
        grow(1),
        year(p.kicker),
        gap(3),
        titolo(`"${p.quote}"`, 5.2),
        gap(3.4),
        el({ display: 'flex', fontSize: s(2.8), fontWeight: 600, color: C.mute }, `${p.author} — ${p.role}`),
        grow(1)
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return field(
        [
          year(p.kicker),
          gap(3),
          col(
            { gap: s(2.4), alignItems: 'flex-start', width: '100%', paddingLeft: s(12) },
            p.items.map((it, i) =>
              el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.ink }, `${i + 1}.  ${it}`)
            )
          ),
          grow(1),
          row({ width: '100%', justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.4), color: C.soft }, BRAND_SLOT),
            el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
          ])
        ],
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'STEPS', {
            fontFamily: f.display,
            fontSize: s(15),
            color: C.accent,
            fontWeight: 700
          }, 'right')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return field([
        grow(1),
        year(p.kicker),
        gap(3),
        row({ width: '100%', justifyContent: 'space-between', paddingLeft: s(2), paddingRight: s(2) }, [
          col(
            { flexGrow: 1, gap: s(1.6), alignItems: 'flex-start' },
            [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.mute, textTransform: 'uppercase' }, p.a.label),
              ...p.a.items.map((it) => el({ display: 'flex', fontSize: s(2.6), color: C.soft }, it))
            ]
          ),
          col(
            { flexGrow: 1, gap: s(1.6), alignItems: 'flex-end' },
            [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, p.b.label),
              ...p.b.items.map((it) => el({ display: 'flex', fontSize: s(2.6), color: C.ink }, it))
            ]
          )
        ]),
        grow(1),
        titolo(p.headline, 6.5)
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return field([
        grow(1),
        year(p.kicker),
        gap(2.4),
        titolo(p.headline, 8),
        gap(2.4),
        corpo(p.sub),
        grow(1),
        letterStack('VIEW', { fontFamily: f.display, fontSize: s(3.2), color: C.mute, fontWeight: 700 })
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return field([
        grow(1),
        year(p.kicker),
        gap(2),
        titolo(p.stat, 28),
        gap(2.4),
        titolo(p.label, 4),
        grow(1)
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.accent,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          grow(1),
          year(p.kicker),
          gap(2.4),
          col(
            { color: C.bg, alignItems: 'center' },
            lines(p.headline, {
              fontFamily: f.display,
              fontSize: s(10),
              fontWeight: 700,
              letterSpacing: s(10) * -0.03,
              lineHeight: 0.98,
              justifyContent: 'center'
            })
          ),
          gap(3),
          el(
            {
              display: 'flex',
              fontSize: s(3),
              lineHeight: 1.4,
              color: 'rgba(42,16,64,0.85)',
              textAlign: 'center',
              justifyContent: 'center',
              maxWidth: s(70)
            },
            p.sub
          ),
          gap(4),
          col(
            { gap: s(2), alignItems: 'center' },
            p.actions.map((a) => el({ display: 'flex', fontSize: s(3), fontWeight: 600, color: C.bg }, a))
          ),
          grow(1),
          el({ display: 'flex', fontSize: s(4.2), fontWeight: 700, color: C.bg }, p.handle)
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const prisma: StylePreset = {
  slug: 'prisma',
  name: 'Prisma',
  thesis: {
    it: 'Atmosfera a strisce verticali, titolo centrato, quasi nessun ornamento. Solo luce e tipo.',
    en: 'Vertical streak atmosphere, centred title, almost no ornament. Just light and type.'
  },
  suits: {
    it: 'Trend report, culture brand, nightlife, beauty, chi vende un mood prima di un claim.',
    en: 'Trend reports, culture brands, nightlife, beauty — anyone selling a mood before a claim.'
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'striae viola/magenta', en: 'violet/magenta streaks' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'sans centrato', en: 'centred sans' } },
    { label: { it: 'meta', en: 'meta' }, value: { it: 'anno in oro spento', en: 'muted gold year' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'velo colorato', en: 'coloured veil' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'nessuno', en: 'none' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'lista centrata', en: 'centred list' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.accent, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.accent,
    muted: C.soft,
    displayFont: 'Inter',
    bodyFont: 'Inter'
  }
};
