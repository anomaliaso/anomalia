/**
 * VISTO — blue grid, brown type, VS.
 *
 * Reference move: a dusty blue field with a white modular grid, chocolate grotesque type that
 * talks across the grid ("what we saw" vs "what we designed"), and small black meta in the corners.
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
import { arrow, canvas, letterStack, overflowTitle } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#A5C3D6',
  ink: '#3D1F15',
  black: '#0A0A0A',
  grid: 'rgba(255,255,255,0.85)',
  pad: s(6),
  cols: 4,
  rows: 5
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const innerW = PRESET_WIDTH - C.pad * 2;
  const innerH = PRESET_HEIGHT - C.pad * 2;
  const cellW = Math.floor(innerW / C.cols);
  const cellH = Math.floor(innerH / C.rows);

  const gridLines = (): El[] => {
    const out: El[] = [];
    for (let c = 0; c <= C.cols; c++) {
      out.push(
        el(
          {
            display: 'flex',
            position: 'absolute',
            left: C.pad + c * cellW,
            top: C.pad,
            width: 1,
            height: innerH,
            backgroundColor: C.grid
          },
          ''
        )
      );
    }
    for (let r = 0; r <= C.rows; r++) {
      out.push(
        el(
          {
            display: 'flex',
            position: 'absolute',
            left: C.pad,
            top: C.pad + r * cellH,
            width: innerW,
            height: 1,
            backgroundColor: C.grid
          },
          ''
        )
      );
    }
    return out;
  };

  const shell = (children: El[], extras: El[] = []) =>
    canvas(C.bg, col({ position: 'relative', width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, children), undefined, [
      ...gridLines(),
      ...extras
    ]);

  const meta = (left: string, right: string) =>
    row({ justifyContent: 'space-between' }, [
      el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.black }, left),
      el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.black }, right)
    ]);

  const titolo = (text: string, pct = 9.5) =>
    col(
      { color: C.ink },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.03,
        lineHeight: 0.96
      })
    );

  const small = (text: string) =>
    col(
      { gap: s(0.8) },
      text.split('\n').map((l) => el({ display: 'flex', fontSize: s(2.5), fontWeight: 500, color: C.black }, l))
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return shell([
        meta(BRAND_SLOT, '©2026'),
        grow(0.7),
        titolo('What we\nSaw', 10),
        gap(2),
        row({ justifyContent: 'flex-end', width: '100%' }, [
          el({ display: 'flex', fontFamily: f.display, fontSize: s(8), fontWeight: 700, color: C.ink }, 'VS  →')
        ]),
        gap(2),
        small('Branding\nDigital Marketing\nGraphic Design'),
        grow(0.5),
        row({ justifyContent: 'flex-end', width: '100%' }, [titolo('What we\nDesigned', 10)]),
        grow(0.3)
      ]);
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const photo = el(
        {
          display: 'flex',
          position: 'absolute',
          left: C.pad + cellW * 2,
          top: C.pad + cellH,
          width: cellW * 2,
          height: cellH * 2,
          overflow: 'hidden'
        },
        [img(photos.a, cellW * 2, cellH * 2)]
      );
      return shell(
        [
          meta(BRAND_SLOT, '©2026'),
          grow(1),
          titolo(p.headline, 8.4),
          gap(3),
          small(p.sub),
          grow(0.5),
          meta(SITE_SLOT, '→')
        ],
        [photo]
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return shell([
        meta(p.kicker, '©2026'),
        grow(1),
        titolo(p.quote, 5.8),
        gap(4),
        small(`${p.author}\n${p.role}`),
        grow(0.5),
        letterStack('SAW', { fontFamily: f.display, fontSize: s(3.2), color: C.ink, fontWeight: 700 })
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return shell(
        [
          meta(p.kicker, '©2026'),
          grow(1),
          col({ gap: s(2.4), paddingLeft: s(14) }, p.items.map((it, i) => small(`${i + 1}. ${it}`))),
          grow(0.5),
          meta(SITE_SLOT, '→')
        ],
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'STEPS', {
            fontFamily: f.display,
            fontSize: s(13),
            color: C.ink,
            fontWeight: 700
          }, 'left')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return shell([
        meta(BRAND_SLOT, '©2026'),
        grow(0.6),
        titolo(`What we\n${p.a.label}`, 9),
        gap(2),
        row({ justifyContent: 'flex-end', width: '100%' }, [
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(8),
              fontWeight: 700,
              color: C.ink,
              letterSpacing: s(8) * -0.03
            },
            'VS  →'
          )
        ]),
        gap(2),
        small(p.a.items.join('\n')),
        grow(0.4),
        row({ justifyContent: 'flex-end', width: '100%' }, [titolo(`What we\n${p.b.label}`, 9)]),
        gap(2),
        row({ justifyContent: 'flex-end', width: '100%' }, [small(p.b.items.join('\n'))]),
        grow(0.3)
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photo = el(
        {
          display: 'flex',
          position: 'absolute',
          left: C.pad,
          top: C.pad + cellH * 2,
          width: cellW * 2,
          height: cellH * 2,
          overflow: 'hidden'
        },
        [img(photos.b, cellW * 2, cellH * 2)]
      );
      return shell(
        [
          meta(p.kicker, '©2026'),
          grow(1),
          row({ justifyContent: 'flex-end', width: '100%' }, [titolo(p.headline, 7.4)]),
          gap(2.4),
          row({ justifyContent: 'flex-end', width: '100%' }, [small(p.sub)]),
          grow(0.4)
        ],
        [photo]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return shell([
        meta(p.kicker, '©2026'),
        grow(1),
        el(
          {
            display: 'flex',
            fontFamily: f.display,
            fontSize: s(30),
            fontWeight: 700,
            lineHeight: 0.85,
            letterSpacing: s(30) * -0.04,
            color: C.ink,
            alignSelf: 'center'
          },
          p.stat
        ),
        gap(3),
        titolo(p.label, 4.2),
        grow(0.5),
        meta(SITE_SLOT, '→')
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.ink,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.bg }, p.kicker),
            el({ display: 'flex', fontSize: s(2.3), fontWeight: 700, color: C.bg }, '©2026')
          ]),
          grow(1),
          col(
            { color: C.bg },
            lines(p.headline, {
              fontFamily: f.display,
              fontSize: s(10),
              fontWeight: 700,
              letterSpacing: s(10) * -0.03,
              lineHeight: 0.96
            })
          ),
          gap(3),
          el({ display: 'flex', fontSize: s(2.5), fontWeight: 500, color: 'rgba(165,195,214,0.9)' }, p.sub),
          gap(4),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2) }, [
                arrow(C.bg, s(3.2)),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.bg }, a)
              ])
            )
          ),
          grow(0.4),
          el({ display: 'flex', fontSize: s(4.4), fontWeight: 700, color: C.bg }, p.handle)
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const visto: StylePreset = {
  slug: 'visto',
  name: 'Visto',
  thesis: {
    it: 'Griglia bianca su blu polvere, tipo cioccolato, dialogo SAW vs DESIGNED attraverso la tela.',
    en: 'White grid on dusty blue, chocolate type, a SAW vs DESIGNED dialogue across the canvas.'
  },
  suits: {
    it: 'Studi creativi, case study before/after, branding agency, workshop.',
    en: 'Creative studios, before/after case studies, branding agencies, workshops.'
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'blu polvere + griglia', en: 'dusty blue + grid' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesque cioccolato', en: 'chocolate grotesque' } },
    { label: { it: 'firma', en: 'signature' }, value: { it: 'VS attraverso la griglia', en: 'VS across the grid' } },
    { label: { it: 'foto', en: 'photo' }, value: { it: 'lastra in un modulo', en: 'plate in one module' } },
    { label: { it: 'meta', en: 'meta' }, value: { it: 'angoli neri', en: 'black corners' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'azioni con →', en: 'actions with →' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.ink, soft: 'rgba(61,31,21,0.55)' }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.ink,
    muted: 'rgba(61,31,21,0.55)',
    displayFont: 'Inter',
    bodyFont: 'Inter'
  }
};
