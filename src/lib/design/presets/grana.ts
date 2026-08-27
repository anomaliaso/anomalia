/**
 * GRANA — grit, glow, centred shout.
 *
 * Reference move: a dark industrial field with a hot vertical glow, white mono type dead-centre,
 * and small corner metadata. Satori cannot print real film grain, so the glow + vignette do the work.
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
import { arrow, barcode, canvas, dotGrid, letterStack, overflowTitle, repeatPhrase } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#0A0A0A',
  glow: '#E23A12',
  ink: '#FFFFFF',
  soft: 'rgba(255,255,255,0.62)',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const field = (children: El[], extras: El[] = []): El =>
    canvas(
      C.bg,
      col({ position: 'relative', width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, children),
      undefined,
      [
        el(
          {
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            backgroundImage: `linear-gradient(90deg, #050505 0%, ${C.glow} 48%, #120806 52%, #050505 100%)`
          },
          ''
        ),
        el(
          {
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            backgroundImage:
              'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.45) 100%)'
          },
          ''
        ),
        ...extras
      ]
    );

  const corner = (text: string, align: 'flex-start' | 'flex-end' = 'flex-start') =>
    col(
      { alignItems: align },
      lines(text, {
        fontFamily: f.mono,
        fontSize: s(2.1),
        fontWeight: 500,
        letterSpacing: s(2.1) * 0.08,
        textTransform: 'uppercase',
        color: C.ink,
        justifyContent: align === 'flex-end' ? 'flex-end' : 'flex-start'
      })
    );

  const titolo = (text: string, pct = 7.2) =>
    col(
      { color: C.ink, alignItems: 'center', width: '100%' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.02,
        lineHeight: 1.05,
        textTransform: 'uppercase',
        justifyContent: 'center'
      })
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return field(
        [
          row({ justifyContent: 'space-between' }, [
            corner(`${BRAND_SLOT}\n/ BRAND`),
            corner('SAVE\nFOR LATER', 'flex-end')
          ]),
          grow(1),
          titolo(p.headline.replace(/\n/g, ' →\n'), 7.4),
          grow(1),
          corner('TILL LAST\n/ SAVE FOR LATER')
        ],
        [
          letterStack('GRIT', {
            fontFamily: f.display,
            fontSize: s(3.4),
            color: C.glow,
            fontWeight: 700,
            position: 'absolute',
            left: C.pad,
            top: s(22)
          })
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(90deg, rgba(5,5,5,0.88) 0%, rgba(226,58,18,0.55) 50%, rgba(5,5,5,0.88) 100%)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between' }, [corner(`${BRAND_SLOT}\n/ BRAND`), corner('SAVE\nFOR LATER', 'flex-end')]),
          grow(1),
          titolo(p.headline, 8.4),
          gap(2.4),
          arrow(C.ink, s(4)),
          gap(2.4),
          titolo(p.sub, 4.2),
          grow(1),
          corner(`${SITE_SLOT}`)
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return field([
        corner(`${p.author}\n/ ${p.role}`),
        grow(1),
        titolo(p.quote, 5.2),
        grow(1),
        barcode(s(32), s(4), C.ink)
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return field(
        [
          corner(p.kicker),
          grow(1),
          col(
            { gap: s(2.2), width: '100%', paddingLeft: s(16) },
            p.items.map((it, i) =>
              el(
                { display: 'flex', fontFamily: f.mono, fontSize: s(3.2), textTransform: 'uppercase', color: C.ink },
                `0${i + 1} → ${it}`
              )
            )
          ),
          grow(1),
          corner('TILL LAST\n/ SAVE FOR LATER')
        ],
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'STEPS', {
            fontFamily: f.display,
            fontSize: s(14),
            color: C.glow,
            fontWeight: 700
          }, 'right')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return field([
        corner(p.kicker),
        grow(1),
        titolo(`${p.a.label} → ${p.b.label}`, 8),
        gap(4),
        row({ width: '100%', justifyContent: 'space-between' }, [
          col(
            { gap: s(1.6), flexGrow: 1 },
            p.a.items.map((it) =>
              el({ display: 'flex', fontFamily: f.mono, fontSize: s(2.4), textTransform: 'uppercase', color: C.soft }, it)
            )
          ),
          col(
            { gap: s(1.6), flexGrow: 1, alignItems: 'flex-end' },
            p.b.items.map((it) =>
              el({ display: 'flex', fontFamily: f.mono, fontSize: s(2.4), textTransform: 'uppercase', color: C.ink }, it)
            )
          )
        ]),
        grow(1),
        corner('TILL LAST\n/ SAVE FOR LATER')
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return field([
        corner(p.kicker),
        grow(1),
        repeatPhrase('BEFORE', 3, { fontFamily: f.mono, fontSize: s(3), color: C.glow, fontWeight: 700 }),
        gap(3),
        titolo(p.headline, 7.4),
        gap(3),
        el(
          {
            display: 'flex',
            fontFamily: f.mono,
            fontSize: s(2.8),
            textTransform: 'uppercase',
            color: C.soft,
            justifyContent: 'center',
            width: '100%'
          },
          p.sub
        ),
        grow(1),
        corner(p.caption.toUpperCase())
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return field([
        corner(p.kicker),
        grow(1),
        titolo(p.stat, 28),
        gap(2),
        arrow(C.glow, s(5)),
        gap(3),
        titolo(p.label, 3.8),
        grow(1),
        corner('TILL LAST\n/ SAVE FOR LATER')
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return field(
        [
          corner(p.kicker),
          grow(1),
          dotGrid(6, 4, C.glow, { gap: s(1.4), size: s(0.9), absolute: { position: 'absolute', right: C.pad, top: s(18) } }),
          titolo(p.headline, 10),
          gap(3),
          arrow(C.ink, s(4)),
          gap(4),
          col(
            { gap: s(2), alignItems: 'center', width: '100%' },
            p.actions.map((a) =>
              el({ display: 'flex', fontFamily: f.mono, fontSize: s(3), textTransform: 'uppercase', color: C.ink }, `→  ${a}`)
            )
          ),
          grow(1),
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontFamily: f.mono, fontSize: s(3.4), textTransform: 'uppercase', color: C.ink }, p.handle),
            el({ display: 'flex', fontFamily: f.mono, fontSize: s(2.3), color: C.soft }, SITE_SLOT)
          ])
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const grana: StylePreset = {
  slug: 'grana',
  name: 'Grana',
  thesis: {
    it: 'Grit e glow: tipo mono bianco al centro, meta agli angoli, bruciatura arancio sul nero.',
    en: 'Grit and glow: white mono type dead-centre, meta in the corners, an orange burn on black.'
  },
  suits: {
    it: 'Designers, streetwear, music, portfolio personali — chi vende texture e attitude.',
    en: 'Designers, streetwear, music, personal portfolios — anyone selling texture and attitude.'
  },
  fonts: { display: 'IBM Plex Mono', body: 'IBM Plex Mono', mono: 'IBM Plex Mono' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'nero + glow arancio', en: 'black + orange glow' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'mono caps centrato', en: 'centred mono caps' } },
    { label: { it: 'meta', en: 'meta' }, value: { it: 'angoli tecnici', en: 'technical corners' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'velo + glow', en: 'veil + glow' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'frecce →', en: 'arrows →' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'lista con frecce', en: 'arrowed list' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.glow, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.glow,
    muted: C.soft,
    displayFont: 'IBM Plex Mono',
    bodyFont: 'IBM Plex Mono'
  }
};
