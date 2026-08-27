/**
 * PRESSA — stamp / letterpress.
 *
 * Off-white paper, a centred orange rectangular block with stacked serif ink inside, and a small
 * sans footer (date / brand / handle). The stamp is the composition — not a badge on the side.
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
import { canvas, letterStack, tape } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F0EDE8',
  stamp: '#FF4A1A',
  ink: '#121212',
  soft: 'rgba(18,18,18,0.58)',
  faint: 'rgba(18,18,18,0.4)',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const stampBlock = (
    children: El | El[],
    opts: { w?: number; h?: number; pad?: number; color?: string } = {}
  ): El =>
    col(
      {
        width: opts.w ?? s(78),
        ...(opts.h ? { height: opts.h } : {}),
        backgroundColor: opts.color ?? C.stamp,
        padding: opts.pad ?? s(5),
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center'
      },
      children
    );

  const titolo = (
    text: string,
    pct = 9,
    color = C.ink,
    align: 'flex-start' | 'center' | 'flex-end' = 'center'
  ) =>
    col(
      { color, alignItems: align, width: '100%' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.02,
        lineHeight: 1.02,
        justifyContent: align === 'center' ? 'center' : align === 'flex-end' ? 'flex-end' : 'flex-start'
      })
    );

  const corpo = (text: string, color = C.soft, pct = 2.9) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.4, fontWeight: 500, color, fontFamily: f.body }, text);

  const metaRow = (left: string, mid: string, right: string, color = C.ink) =>
    row({ justifyContent: 'space-between', alignItems: 'center', width: '100%' }, [
      el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color, letterSpacing: s(2.2) * 0.06 }, left),
      el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color, letterSpacing: s(2.2) * 0.06 }, mid),
      el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color, letterSpacing: s(2.2) * 0.06 }, right)
    ]);

  const tapeStrip = (text: string, bg = C.ink, fg = C.bg) => tape(text, bg, fg, { fontFamily: f.body });

  const cornerTape = (text: string, pos: Record<string, unknown>) =>
    el(
      {
        display: 'flex',
        position: 'absolute',
        backgroundColor: C.stamp,
        color: '#FFFFFF',
        padding: `${s(1)}px ${s(2.4)}px`,
        fontSize: s(2),
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: s(2) * 0.1,
        fontFamily: f.body,
        ...pos
      },
      text
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
            grow(1),
            stampBlock(
              [
                titolo(p.headline, 8.4, C.ink, 'center'),
                gap(2.4),
                el(
                  {
                    display: 'flex',
                    fontSize: s(2.6),
                    fontWeight: 500,
                    color: 'rgba(18,18,18,0.72)',
                    textAlign: 'center',
                    maxWidth: s(62),
                    lineHeight: 1.35
                  },
                  p.sub
                )
              ],
              { w: s(82), pad: s(6) }
            ),
            grow(1),
            metaRow('12.03.26', BRAND_SLOT, DEMO.cta.handle)
          ]
        )
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'rgba(18,18,18,0.28)',
        col(
          {
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT,
            fontFamily: f.body,
            justifyContent: 'flex-end'
          },
          [
            grow(1),
            col(
              {
                backgroundColor: C.stamp,
                padding: `${s(5)}px ${C.pad}px`,
                width: PRESET_WIDTH
              },
              [
                tapeStrip(p.kicker, C.ink, '#FFFFFF'),
                gap(2.4),
                titolo(p.headline, 7.6, C.ink, 'flex-start'),
                gap(2),
                corpo(p.sub, 'rgba(18,18,18,0.75)', 2.8),
                gap(3),
                metaRow(BRAND_SLOT, '—', DEMO.cta.handle, C.ink)
              ]
            )
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
            tapeStrip(p.kicker, C.ink, C.bg),
            gap(4),
            stampBlock(
              [
                col(
                  { color: C.ink, alignItems: 'center', maxWidth: s(68) },
                  lines(`“${p.quote}”`, {
                    fontFamily: f.display,
                    fontSize: s(4.6),
                    fontWeight: 700,
                    letterSpacing: s(4.6) * -0.015,
                    lineHeight: 1.18,
                    justifyContent: 'center'
                  })
                ),
                gap(4),
                el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.ink }, p.author),
                gap(0.6),
                el({ display: 'flex', fontSize: s(2.4), fontWeight: 500, color: 'rgba(18,18,18,0.65)' }, p.role)
              ],
              { w: s(84), pad: s(6) }
            ),
            grow(0.3),
            metaRow(BRAND_SLOT, SITE_SLOT, DEMO.cta.handle)
          ]
        )
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            tapeStrip(p.kicker, C.stamp, '#FFFFFF'),
            letterStack('LIST', { fontFamily: f.display, fontSize: s(3), color: C.stamp, fontWeight: 700 })
          ]),
          gap(5),
          titolo(p.headline, 7.2, C.ink, 'flex-start'),
          gap(5),
          col(
            { gap: s(2.6) },
            p.items.map((it, i) =>
              row({ alignItems: 'stretch', gap: s(2.4) }, [
                el(
                  {
                    display: 'flex',
                    width: s(8),
                    backgroundColor: C.stamp,
                    color: C.ink,
                    fontFamily: f.display,
                    fontSize: s(3.4),
                    fontWeight: 700,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  },
                  `0${i + 1}`
                ),
                el(
                  {
                    display: 'flex',
                    flexGrow: 1,
                    backgroundColor: '#FFFFFF',
                    border: `2px solid ${C.ink}`,
                    padding: `${s(2.2)}px ${s(3)}px`,
                    fontSize: s(3.2),
                    fontWeight: 600,
                    color: C.ink,
                    alignItems: 'center'
                  },
                  it
                )
              ])
            )
          ),
          grow(1),
          metaRow('12.03.26', BRAND_SLOT, DEMO.cta.handle)
        ]),
        undefined,
        [
          cornerTape('PRESS', { top: s(18), right: -s(1) }),
          cornerTape('PROOF', { bottom: s(22), left: -s(1) })
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ fontFamily: f.body }, [
          col({ padding: C.pad, paddingBottom: s(3) }, [
            tapeStrip(p.kicker, C.ink, C.bg),
            gap(2.4),
            titolo(p.headline, 6.4, C.ink, 'flex-start')
          ]),
          row({ flexGrow: 1, paddingLeft: C.pad, paddingRight: C.pad, paddingBottom: C.pad, gap: s(3) }, [
            col(
              {
                flexGrow: 1,
                backgroundColor: C.ink,
                padding: s(4),
                justifyContent: 'flex-start'
              },
              [
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(4.2),
                    fontWeight: 700,
                    color: C.bg,
                    marginBottom: s(2.4)
                  },
                  p.a.label
                ),
                ...p.a.items.map((it) =>
                  el(
                    {
                      display: 'flex',
                      fontSize: s(2.6),
                      fontWeight: 500,
                      color: 'rgba(240,237,232,0.78)',
                      marginBottom: s(1.6),
                      lineHeight: 1.3
                    },
                    it
                  )
                )
              ]
            ),
            col(
              {
                flexGrow: 1,
                backgroundColor: C.stamp,
                padding: s(4),
                justifyContent: 'flex-start'
              },
              [
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(4.2),
                    fontWeight: 700,
                    color: C.ink,
                    marginBottom: s(2.4)
                  },
                  p.b.label
                ),
                ...p.b.items.map((it) =>
                  el(
                    {
                      display: 'flex',
                      fontSize: s(2.6),
                      fontWeight: 600,
                      color: C.ink,
                      marginBottom: s(1.6),
                      lineHeight: 1.3
                    },
                    it
                  )
                )
              ]
            )
          ])
        ]),
        undefined,
        [cornerTape('A / B', { top: s(4), right: C.pad })]
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const photoW = PRESET_WIDTH - C.pad * 2;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            tapeStrip(p.kicker, C.stamp, '#FFFFFF'),
            el({ display: 'flex', fontSize: s(2.2), fontWeight: 600, color: C.faint }, p.caption)
          ]),
          gap(4),
          titolo(p.headline, 7.4, C.ink, 'flex-start'),
          gap(2.4),
          corpo(p.sub),
          grow(1),
          el(
            {
              display: 'flex',
              position: 'relative',
              width: photoW,
              height: s(52),
              overflow: 'hidden'
            },
            [
              img(photos.b, photoW, s(52)),
              el(
                {
                  display: 'flex',
                  position: 'absolute',
                  bottom: s(3),
                  left: s(3),
                  backgroundColor: C.stamp,
                  padding: `${s(1.4)}px ${s(2.8)}px`
                },
                [
                  el(
                    {
                      display: 'flex',
                      fontFamily: f.display,
                      fontSize: s(2.8),
                      fontWeight: 700,
                      color: C.ink
                    },
                    'HALF FRAME'
                  )
                ]
              )
            ]
          ),
          gap(3),
          metaRow(BRAND_SLOT, SITE_SLOT, DEMO.cta.handle)
        ]),
        undefined,
        [cornerTape('TAPE', { top: s(28), right: -s(2) })]
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
            alignItems: 'center',
            justifyContent: 'center'
          },
          [
            tapeStrip(p.kicker, C.ink, C.bg),
            gap(4),
            stampBlock(
              [
                el(
                  {
                    display: 'flex',
                    fontFamily: f.display,
                    fontSize: s(28),
                    fontWeight: 700,
                    lineHeight: 0.85,
                    letterSpacing: s(28) * -0.04,
                    color: C.ink
                  },
                  p.stat
                ),
                gap(3),
                col(
                  { color: C.ink, alignItems: 'center', maxWidth: s(58) },
                  lines(p.label, {
                    fontFamily: f.body,
                    fontSize: s(3.2),
                    fontWeight: 600,
                    lineHeight: 1.25,
                    justifyContent: 'center'
                  })
                )
              ],
              { w: s(80), pad: s(6) }
            ),
            gap(4),
            corpo(p.sub, C.soft, 2.7),
            grow(0.4),
            metaRow('12.03.26', BRAND_SLOT, DEMO.cta.handle)
          ]
        )
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.stamp,
        col(
          {
            padding: C.pad,
            fontFamily: f.body,
            width: PRESET_WIDTH,
            height: PRESET_HEIGHT
          },
          [
            tapeStrip(p.kicker, C.ink, '#FFFFFF'),
            grow(1),
            titolo(p.headline, 11, C.ink, 'center'),
            gap(3),
            el(
              {
                display: 'flex',
                fontSize: s(3),
                fontWeight: 500,
                color: 'rgba(18,18,18,0.72)',
                textAlign: 'center',
                maxWidth: s(70),
                alignSelf: 'center',
                lineHeight: 1.4
              },
              p.sub
            ),
            gap(5),
            col(
              { gap: s(2), width: '100%', alignItems: 'center' },
              p.actions.map((a) =>
                el(
                  {
                    display: 'flex',
                    backgroundColor: C.ink,
                    color: C.bg,
                    padding: `${s(2)}px ${s(4)}px`,
                    fontSize: s(2.8),
                    fontWeight: 700,
                    letterSpacing: s(2.8) * 0.04
                  },
                  a
                )
              )
            ),
            grow(1),
            el(
              {
                display: 'flex',
                alignSelf: 'center',
                fontFamily: f.display,
                fontSize: s(6.5),
                fontWeight: 700,
                color: C.ink,
                letterSpacing: s(6.5) * -0.02
              },
              p.handle
            ),
            gap(2),
            metaRow(BRAND_SLOT, '—', SITE_SLOT, C.ink)
          ]
        )
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const pressa: StylePreset = {
  slug: 'pressa',
  name: 'Pressa',
  thesis: {
    it: 'Carta da stampa e blocco arancio: serif nera dentro il francobollo, meta sans in piede.',
    en: 'Letterpress paper and an orange stamp block: black serif ink inside, small sans meta in the footer.'
  },
  suits: {
    it: 'Editoria, brand culturali, D2C con voce editoriale, chi parla come un manifesto stampato.',
    en: 'Publishing, cultural brands, editorial D2C — anyone who speaks like a printed manifesto.'
  },
  fonts: { display: 'Libre Baskerville', body: 'DM Sans', mono: 'DM Sans' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'carta off-white', en: 'off-white paper' } },
    { label: { it: 'timbro', en: 'stamp' }, value: { it: 'blocco #FF4A1A', en: '#FF4A1A block' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'serif stacked', en: 'stacked serif' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'striscia stamp in basso', en: 'stamp strip at the bottom' } },
    { label: { it: 'numero', en: 'number' }, value: { it: 'cifra sul blocco arancio', en: 'figure on the orange block' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'campo stamp + handle', en: 'full stamp field + handle' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.stamp, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.stamp,
    muted: C.soft,
    displayFont: 'Libre Baskerville',
    bodyFont: 'DM Sans'
  }
};
