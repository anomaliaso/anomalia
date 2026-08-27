/**
 * MOSAICO — pixel mosaic.
 *
 * Virtru-style: cream ground, coloured square pixel clusters (hot pink, red, light pink),
 * photo windows as plates, serif quotes, and a small #handle in the corner. Pixels are the
 * ornament — never the same cluster twice in a row.
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
import { canvas, letterStack } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F7F4EF',
  card: '#FFFFFF',
  ink: '#111111',
  soft: 'rgba(17,17,17,0.55)',
  faint: 'rgba(17,17,17,0.38)',
  hot: '#FF2D6A',
  red: '#E31C3D',
  blush: '#FFB3C7',
  coral: '#FF6B6B',
  pad: s(7)
};

const PIXELS = [C.hot, C.red, C.blush, C.coral, C.hot, C.blush, C.red];

/** Coloured square grid — absolute or flex wrap depending on `absolute`. */
function pixelCluster(
  colors: string[],
  cols: number,
  rows: number,
  cellSize: number,
  opts: { gap?: number; absolute?: Record<string, unknown> } = {}
): El {
  const g = opts.gap ?? Math.max(2, Math.round(cellSize * 0.12));
  const cells: El[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        el(
          {
            display: 'flex',
            width: cellSize,
            height: cellSize,
            backgroundColor: colors[(r * cols + c) % colors.length],
            flexShrink: 0
          },
          ''
        )
      );
    }
  }
  return el(
    {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: cols * cellSize + (cols - 1) * g,
      gap: g,
      ...(opts.absolute ?? {})
    },
    cells
  );
}

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const handle = (color = C.ink) =>
    el(
      {
        display: 'flex',
        fontSize: s(2.4),
        fontWeight: 600,
        color,
        letterSpacing: s(2.4) * 0.04
      },
      DEMO.cta.handle
    );

  const titolo = (
    text: string,
    pct = 8.5,
    color = C.ink,
    align: 'flex-start' | 'center' | 'flex-end' = 'flex-start'
  ) =>
    col(
      { color, alignItems: align, width: '100%' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.02,
        lineHeight: 1.05,
        justifyContent: align === 'center' ? 'center' : align === 'flex-end' ? 'flex-end' : 'flex-start'
      })
    );

  const corpo = (text: string, color = C.soft, pct = 2.9) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.4, fontWeight: 500, color, fontFamily: f.body }, text);

  const textCard = (children: El | El[], w = s(72)): El =>
    col(
      {
        width: w,
        backgroundColor: C.card,
        padding: s(5),
        border: `2px solid ${C.ink}`,
        alignSelf: 'center'
      },
      children
    );

  /** Pixel frame around content — top/bottom bars of squares. */
  const pixelBar = (n: number, cell = s(2.4), colors = PIXELS) =>
    row(
      { gap: Math.max(2, Math.round(cell * 0.12)) },
      Array.from({ length: n }, (_, i) =>
        el(
          {
            display: 'flex',
            width: cell,
            height: cell,
            backgroundColor: colors[i % colors.length],
            flexShrink: 0
          },
          ''
        )
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            justifyContent: 'center',
            alignItems: 'center'
          },
          [
            pixelBar(14, s(2.8), [C.hot, C.blush, C.red, C.coral]),
            gap(2),
            textCard(
              [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.2),
                    fontWeight: 700,
                    color: C.hot,
                    textTransform: 'uppercase',
                    letterSpacing: s(2.2) * 0.12,
                    marginBottom: s(2.4)
                  },
                  p.kicker
                ),
                titolo(p.headline, 8.2, C.ink, 'flex-start'),
                gap(2.4),
                corpo(p.sub, C.soft, 2.7),
                gap(3),
                row({ justifyContent: 'space-between', alignItems: 'center' }, [
                  el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, BRAND_SLOT),
                  handle()
                ])
              ],
              s(74)
            ),
            gap(2),
            pixelBar(14, s(2.8), [C.red, C.hot, C.coral, C.blush])
          ]
        ),
        undefined,
        [
          pixelCluster(PIXELS, 5, 6, s(3.2), {
            absolute: { position: 'absolute', bottom: s(4), left: s(4) }
          })
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(180deg, rgba(0,0,0,0.08) 30%, rgba(0,0,0,0.55) 100%)',
        col(
          {
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            padding: C.pad,
            fontFamily: f.body
          },
          [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              pixelCluster([C.hot, C.blush, C.red], 4, 3, s(2.6)),
              handle('#FFFFFF')
            ]),
            grow(1),
            el(
              {
                display: 'flex',
                fontSize: s(2.2),
                fontWeight: 700,
                color: C.hot,
                textTransform: 'uppercase',
                letterSpacing: s(2.2) * 0.1,
                backgroundColor: C.card,
                padding: `${s(1)}px ${s(2.2)}px`,
                alignSelf: 'flex-start'
              },
              p.kicker
            ),
            gap(2.4),
            titolo(p.headline, 8.4, '#FFFFFF'),
            gap(2),
            corpo(p.sub, 'rgba(255,255,255,0.78)', 2.8),
            gap(3),
            pixelBar(10, s(2.2), [C.hot, C.red, C.blush])
          ]
        ),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            justifyContent: 'center',
            alignItems: 'center'
          },
          [
            pixelBar(16, s(2.4), [C.hot, C.red, C.blush, C.coral, C.hot]),
            gap(2.4),
            textCard(
              [
                col(
                  { color: C.ink },
                  lines(`“${p.quote}”`, {
                    fontFamily: f.display,
                    fontSize: s(4.8),
                    fontWeight: 700,
                    letterSpacing: s(4.8) * -0.015,
                    lineHeight: 1.2
                  })
                ),
                gap(4),
                el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.hot }, p.author),
                gap(0.6),
                el({ display: 'flex', fontSize: s(2.4), fontWeight: 500, color: C.soft }, p.role)
              ],
              s(78)
            ),
            gap(2.4),
            pixelBar(16, s(2.4), [C.blush, C.coral, C.hot, C.red, C.blush]),
            gap(3),
            handle()
          ]
        ),
        undefined,
        [
          pixelCluster([C.hot, C.blush], 3, 3, s(2.8), {
            absolute: { position: 'absolute', top: s(5), left: s(5) }
          }),
          pixelCluster([C.red, C.coral], 3, 3, s(2.8), {
            absolute: { position: 'absolute', bottom: s(5), right: s(5) }
          })
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            col({ gap: s(1.2) }, [
              el(
                {
                  display: 'flex',
                  fontSize: s(2.2),
                  fontWeight: 700,
                  color: C.hot,
                  textTransform: 'uppercase',
                  letterSpacing: s(2.2) * 0.1
                },
                p.kicker
              ),
              titolo(p.headline, 7, C.ink)
            ]),
            pixelCluster([C.hot, C.red, C.blush, C.coral], 4, 4, s(2.8))
          ]),
          gap(5),
          col(
            { gap: s(2.8) },
            p.items.map((it, i) =>
              row({ alignItems: 'center', gap: s(3) }, [
                el(
                  {
                    display: 'flex',
                    width: s(7),
                    height: s(7),
                    backgroundColor: PIXELS[i % PIXELS.length],
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: f.display,
                    fontSize: s(3),
                    fontWeight: 700,
                    color: C.ink,
                    flexShrink: 0
                  },
                  `${i + 1}`
                ),
                el(
                  {
                    display: 'flex',
                    flexGrow: 1,
                    backgroundColor: C.card,
                    padding: `${s(2.4)}px ${s(3)}px`,
                    fontSize: s(3.2),
                    fontWeight: 600,
                    color: C.ink,
                    borderLeft: `4px solid ${PIXELS[i % PIXELS.length]}`
                  },
                  it
                )
              ])
            )
          ),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, BRAND_SLOT),
            handle()
          ])
        ]),
        undefined,
        [
          pixelCluster([C.blush, C.hot], 6, 2, s(2.2), {
            absolute: { position: 'absolute', bottom: s(14), right: s(4) }
          })
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontSize: s(2.2),
                fontWeight: 700,
                color: C.hot,
                textTransform: 'uppercase',
                letterSpacing: s(2.2) * 0.1
              },
              p.kicker
            ),
            pixelBar(8, s(2), [C.hot, C.red, C.blush])
          ]),
          gap(3),
          titolo(p.headline, 6.8),
          gap(4),
          row({ gap: s(3), flexGrow: 1, alignItems: 'stretch' }, [
            col(
              {
                flexGrow: 1,
                backgroundColor: C.card,
                border: `2px solid ${C.ink}`,
                padding: s(3.5),
                gap: s(1.6)
              },
              [
                row({ gap: s(1), marginBottom: s(1.6) }, [
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.red }, ''),
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.hot }, ''),
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.blush }, '')
                ]),
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(3.6),
                    fontWeight: 700,
                    color: C.ink,
                    marginBottom: s(1.2)
                  },
                  p.a.label
                ),
                ...p.a.items.map((it) =>
                  el({ display: 'flex', fontSize: s(2.5), fontWeight: 500, color: C.soft, lineHeight: 1.3 }, it)
                )
              ]
            ),
            col(
              {
                flexGrow: 1,
                backgroundColor: C.hot,
                padding: s(3.5),
                gap: s(1.6)
              },
              [
                row({ gap: s(1), marginBottom: s(1.6) }, [
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.card }, ''),
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.blush }, ''),
                  el({ display: 'flex', width: s(2.2), height: s(2.2), backgroundColor: C.ink }, '')
                ]),
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(3.6),
                    fontWeight: 700,
                    color: C.card,
                    marginBottom: s(1.2)
                  },
                  p.b.label
                ),
                ...p.b.items.map((it) =>
                  el(
                    {
                      display: 'flex',
                      fontSize: s(2.5),
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.92)',
                      lineHeight: 1.3
                    },
                    it
                  )
                )
              ]
            )
          ]),
          gap(3),
          handle()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoW = s(58);
      const photoH = s(58);
      return canvas(
        C.bg,
        row(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            gap: s(4)
          },
          [
            col({ flexGrow: 1, justifyContent: 'space-between' }, [
              col({ gap: s(2) }, [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.2),
                    fontWeight: 700,
                    color: C.hot,
                    textTransform: 'uppercase',
                    letterSpacing: s(2.2) * 0.1
                  },
                  p.kicker
                ),
                titolo(p.headline, 6.8),
                gap(2),
                corpo(p.sub),
                gap(2),
                el({ display: 'flex', fontSize: s(2.2), fontWeight: 500, color: C.faint }, p.caption)
              ]),
              col({ gap: s(2) }, [
                pixelCluster([C.hot, C.blush, C.red, C.coral, C.hot], 5, 3, s(2.6)),
                handle()
              ])
            ]),
            col({ alignItems: 'flex-end', justifyContent: 'center', gap: s(2) }, [
              pixelBar(6, s(2.2), [C.hot, C.red, C.blush]),
              el(
                {
                  display: 'flex',
                  width: photoW,
                  height: photoH,
                  overflow: 'hidden',
                  border: `3px solid ${C.ink}`
                },
                [img(photos.b, photoW, photoH)]
              ),
              pixelBar(6, s(2.2), [C.blush, C.coral, C.hot])
            ])
          ]
        ),
        undefined,
        [
          pixelCluster([C.red, C.hot], 2, 4, s(2.4), {
            absolute: { position: 'absolute', top: s(5), right: s(5) }
          })
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        col(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            alignItems: 'center'
          },
          [
            row({ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }, [
              el(
                {
                  display: 'flex',
                  fontSize: s(2.2),
                  fontWeight: 700,
                  color: C.hot,
                  textTransform: 'uppercase',
                  letterSpacing: s(2.2) * 0.1
                },
                p.kicker
              ),
              handle()
            ]),
            grow(1),
            pixelBar(12, s(3), [C.hot, C.red, C.blush, C.coral]),
            gap(3),
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(32),
                fontWeight: 700,
                lineHeight: 0.85,
                letterSpacing: s(32) * -0.04,
                color: C.ink
              },
              p.stat
            ),
            gap(3),
            pixelBar(12, s(3), [C.coral, C.blush, C.hot, C.red]),
            gap(4),
            col(
              { color: C.ink, alignItems: 'center', maxWidth: s(70) },
              lines(p.label, {
                fontFamily: f.display,
                fontSize: s(3.8),
                fontWeight: 700,
                lineHeight: 1.15,
                justifyContent: 'center'
              })
            ),
            gap(2.4),
            corpo(p.sub, C.soft, 2.6),
            grow(1),
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, BRAND_SLOT)
          ]
        ),
        undefined,
        [
          pixelCluster([C.hot, C.blush, C.red], 3, 5, s(2.6), {
            absolute: { position: 'absolute', left: s(4), top: s(28) }
          }),
          pixelCluster([C.coral, C.hot, C.blush], 3, 5, s(2.6), {
            absolute: { position: 'absolute', right: s(4), bottom: s(22) }
          })
        ]
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT
          },
          [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              pixelCluster([C.hot, C.red, C.blush], 6, 2, s(2.8)),
              letterStack('GO', { fontFamily: f.display, fontSize: s(3.2), color: C.hot, fontWeight: 700 })
            ]),
            grow(1),
            textCard(
              [
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.2),
                    fontWeight: 700,
                    color: C.hot,
                    textTransform: 'uppercase',
                    letterSpacing: s(2.2) * 0.1,
                    marginBottom: s(2)
                  },
                  p.kicker
                ),
                titolo(p.headline, 9, C.ink),
                gap(2.4),
                corpo(p.sub),
                gap(4),
                col(
                  { gap: s(2) },
                  p.actions.map((a, i) =>
                    row({ alignItems: 'center', gap: s(2.2) }, [
                      el(
                        {
                          display: 'flex',
                          width: s(2.4),
                          height: s(2.4),
                          backgroundColor: PIXELS[i % PIXELS.length],
                          flexShrink: 0
                        },
                        ''
                      ),
                      el({ display: 'flex', fontSize: s(3), fontWeight: 600, color: C.ink }, a)
                    ])
                  )
                ),
                gap(4),
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(5.5),
                    fontWeight: 700,
                    color: C.hot,
                    letterSpacing: s(5.5) * -0.02
                  },
                  p.handle
                )
              ],
              s(78)
            ),
            grow(0.6),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, BRAND_SLOT),
              el({ display: 'flex', fontSize: s(2.2), fontWeight: 500, color: C.faint }, SITE_SLOT)
            ]),
            gap(2),
            pixelBar(18, s(2.4), PIXELS)
          ]
        ),
        undefined,
        [
          pixelCluster([C.blush, C.coral, C.hot], 4, 4, s(2.4), {
            absolute: { position: 'absolute', top: s(18), right: s(4) }
          })
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const mosaico: StylePreset = {
  slug: 'mosaico',
  name: 'Mosaico',
  thesis: {
    it: 'Mosaico di pixel colorati su crema: finestre foto, citazioni serif, handle in angolo.',
    en: 'Coloured pixel clusters on cream: photo windows, serif quotes, a small handle in the corner.'
  },
  suits: {
    it: 'SaaS, privacy/tech brand, portfolio creativi, chi vuole energia pixel senza look neon.',
    en: 'SaaS, privacy/tech brands, creative portfolios — pixel energy without a neon look.'
  },
  fonts: { display: 'Libre Baskerville', body: 'Inter', mono: 'Inter' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'crema + card bianca', en: 'cream + white card' } },
    { label: { it: 'pixel', en: 'pixels' }, value: { it: 'rosa / rosso / blush', en: 'hot pink / red / blush' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'serif o sans pulito', en: 'serif or clean sans' } },
    { label: { it: 'cover', en: 'cover' }, value: { it: 'card incorniciata da pixel', en: 'card framed by pixels' } },
    { label: { it: 'citazione', en: 'quote' }, value: { it: 'card in cornice pixel', en: 'card in a pixel frame' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'card + handle hot pink', en: 'card + hot-pink handle' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.hot, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.hot,
    muted: C.soft,
    displayFont: 'Libre Baskerville',
    bodyFont: 'Inter'
  }
};
