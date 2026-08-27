/**
 * MODULO — Swiss grid as ornament.
 *
 * Reference move: a visible modular grid (coral lines on cream), solid blocks filling cells,
 * and black grotesque type locked to the modules. The grid is not a guide — it is the picture.
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
import { canvas, dotGrid, letterStack, overflowTitle, plusMark } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F7F4EF',
  ink: '#0A0A0A',
  soft: '#5A5550',
  grid: '#FF4C4C',
  pad: s(6),
  cols: 4,
  rows: 6
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const innerW = PRESET_WIDTH - C.pad * 2;
  const innerH = PRESET_HEIGHT - C.pad * 2;
  const cellW = Math.floor(innerW / C.cols);
  const cellH = Math.floor(innerH / C.rows);

  const block = (colIdx: number, rowIdx: number, colSpan = 1, rowSpan = 1) =>
    el(
      {
        display: 'flex',
        position: 'absolute',
        left: C.pad + colIdx * cellW,
        top: C.pad + rowIdx * cellH,
        width: cellW * colSpan,
        height: cellH * rowSpan,
        backgroundColor: C.grid
      },
      ''
    );

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

  const badge = () =>
    el(
      {
        display: 'flex',
        alignSelf: 'flex-start',
        backgroundColor: C.ink,
        color: '#FFFFFF',
        borderRadius: s(1.2),
        padding: `${s(1.2)}px ${s(2.2)}px`,
        fontSize: s(2),
        fontWeight: 600
      },
      BRAND_SLOT.toLowerCase()
    );

  const titolo = (text: string, pct = 11) =>
    col(
      { color: C.ink },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.035,
        lineHeight: 0.95
      })
    );

  const corpo = (text: string) =>
    el({ display: 'flex', fontSize: s(2.9), lineHeight: 1.35, color: C.soft, fontWeight: 500 }, text);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return shell(
        [
          badge(),
          grow(1),
          titolo(p.headline, 10.5),
          grow(1),
          row({ justifyContent: 'flex-end' }, [
            el({ display: 'flex', fontSize: s(3), fontWeight: 500, color: C.ink, maxWidth: s(42), textAlign: 'right' }, p.sub)
          ]),
          gap(3),
          row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
            el({ display: 'flex', fontSize: s(2.3), fontWeight: 600, color: C.ink }, SITE_SLOT),
            el({ display: 'flex', width: s(3), height: s(3.6), backgroundColor: C.ink }, '')
          ])
        ],
        [block(3, 0), block(0, 4, 1, 2), block(1, 5, 1, 1)]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const photo = el(
        {
          display: 'flex',
          position: 'absolute',
          left: C.pad + cellW,
          top: C.pad + cellH,
          width: cellW * 2,
          height: cellH * 3,
          overflow: 'hidden'
        },
        [img(photos.a, cellW * 2, cellH * 3)]
      );
      return shell(
        [
          badge(),
          grow(1),
          titolo(p.headline, 9),
          gap(2.4),
          corpo(p.sub),
          grow(0.4),
          row({ justifyContent: 'space-between' }, [
            el({ display: 'flex', fontSize: s(2.3), fontWeight: 600, color: C.ink }, SITE_SLOT),
            el({ display: 'flex', width: s(3), height: s(3.6), backgroundColor: C.ink }, '')
          ])
        ],
        [block(3, 0), photo]
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return shell(
        [
          plusMark(C.grid, s(7)),
          grow(1),
          titolo(`"${p.quote}"`, 5.6),
          gap(4),
          el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.ink }, p.author),
          gap(0.6),
          corpo(p.role),
          grow(0.5)
        ],
        [block(3, 0), block(0, 4, 2, 2)]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return shell(
        [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            badge(),
            letterStack('HOW', { fontFamily: f.display, fontSize: s(3.2), color: C.grid, fontWeight: 700 })
          ]),
          gap(4),
          col(
            { gap: s(2.4) },
            p.items.map((it, i) =>
              row({ alignItems: 'baseline', gap: s(2.4) }, [
                el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.grid }, `0${i + 1}`),
                el({ display: 'flex', fontSize: s(3.2), fontWeight: 600, color: C.ink }, it)
              ])
            )
          ),
          grow(1),
          dotGrid(5, 2, C.grid, { gap: s(1.2), size: s(0.8) })
        ],
        [block(0, 5, 2, 1)]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return shell(
        [
          badge(),
          gap(4),
          row({ gap: s(4), alignItems: 'flex-start' }, [
            col({ flexGrow: 1, gap: s(1.6), backgroundColor: C.grid, padding: s(3) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }, p.a.label),
              ...p.a.items.map((it) => el({ display: 'flex', fontSize: s(2.6), color: 'rgba(255,255,255,0.85)' }, it))
            ]),
            col({ flexGrow: 1, gap: s(1.6), padding: s(3) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, p.b.label),
              ...p.b.items.map((it) => el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, color: C.ink }, it))
            ])
          ]),
          grow(0.4)
        ],
        [block(3, 0), block(0, 0, 1, 2)]
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photo = el(
        {
          display: 'flex',
          position: 'absolute',
          left: C.pad + cellW * 2,
          top: C.pad + cellH * 2,
          width: cellW * 2,
          height: cellH * 3,
          overflow: 'hidden'
        },
        [img(photos.b, cellW * 2, cellH * 3)]
      );
      return shell(
        [
          badge(),
          gap(5),
          titolo(p.headline, 8.4),
          gap(2.4),
          corpo(p.sub),
          grow(1),
          el({ display: 'flex', fontSize: s(2.3), color: C.soft }, p.caption)
        ],
        [block(3, 0), photo]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return shell(
        [
          badge(),
          grow(1),
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(32),
              fontWeight: 700,
              lineHeight: 0.85,
              letterSpacing: s(32) * -0.04,
              color: C.ink,
              alignSelf: 'center'
            },
            p.stat
          ),
          gap(3),
          titolo(p.label, 4),
          grow(0.5)
        ],
        [block(3, 0), block(0, 4, 1, 2), block(1, 5, 1, 1)]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return shell(
        [
          badge(),
          grow(1),
          titolo(p.headline, 10),
          gap(3),
          corpo(p.sub),
          gap(4),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2) }, [
                el({ display: 'flex', width: cellW * 0.35, height: s(1.2), backgroundColor: C.grid }, ''),
                el({ display: 'flex', fontSize: s(3), fontWeight: 600, color: C.ink }, a)
              ])
            )
          ),
          grow(0.4),
          el({ display: 'flex', fontSize: s(4), fontWeight: 700, color: C.ink }, p.handle)
        ],
        [
          block(0, 5, 2, 1),
          overflowTitle(p.headline.split('\n')[0] ?? 'HERE', {
            fontFamily: f.display,
            fontSize: s(14),
            color: C.grid,
            fontWeight: 700
          }, 'right')
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const modulo: StylePreset = {
  slug: 'modulo',
  name: 'Modulo',
  thesis: {
    it: 'Griglia svizzera a vista: filetti coral, blocchi pieni, tipo nero agganciato ai moduli.',
    en: 'A visible Swiss grid: coral rules, solid filled cells, black type locked to the modules.'
  },
  suits: {
    it: 'Design education, branding studios, product design, chi insegna struttura.',
    en: 'Design education, branding studios, product design — anyone teaching structure.'
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'crema + griglia coral', en: 'cream + coral grid' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesque black', en: 'black grotesque' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'celle piene', en: 'filled cells' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'lastra in griglia', en: 'plate inside the grid' } },
    { label: { it: 'badge', en: 'badge' }, value: { it: 'pill nero brand', en: 'black brand pill' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'righe con filetto', en: 'rows with a rule' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.grid, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.grid,
    muted: C.soft,
    displayFont: 'Inter',
    bodyFont: 'Inter'
  }
};
