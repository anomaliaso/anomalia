/**
 * MORBIDO — everything lives in a card.
 *
 * The other four presets set type directly on the ground. This one never does: every element sits
 * inside a white rounded panel floating on a soft coloured field, with a lot of padding and a lot
 * of line-height. Structurally it is the only container-based preset in the library, which is why
 * it reads differently even at thumbnail size.
 *
 * Its answer to a photograph follows the same rule and is the fifth distinct one: the picture is
 * never full-bleed. It becomes a rounded panel with the ground showing as a frame around it, and
 * the type stays outside, on its own card. Nothing ever has to be legible over an image.
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
import {
  arrow,
  barcode,
  brackets,
  canvas,
  chevronStack,
  dotGrid,
  overflowTitle,
  plusMark,
  starMark,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#E7EFEB',
  card: '#FFFFFF',
  ink: '#15211C',
  soft: '#586962',
  faint: '#8A9A93',
  /** SLOT: the brand's colour lands here. */
  slot: '#3E7A64',
  pad: s(5.5),
  radius: s(4)
};

const fonts = { display: 'Outfit', body: 'Figtree', mono: 'Figtree' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const contentW = PRESET_WIDTH - C.pad * 2;

  const shell = (children: El[]) =>
    col(
      {
        width: PRESET_WIDTH,
        height: PRESET_HEIGHT,
        backgroundColor: C.bg,
        padding: C.pad,
        gap: s(2.4),
        fontFamily: f.body
      },
      children
    );
  const card = (children: El[], extra: Record<string, unknown> = {}) =>
    col(
      { backgroundColor: C.card, borderRadius: C.radius, padding: s(5.4), ...extra },
      children
    );
  const pill = (text: string, bg = C.slot, fg = '#FFFFFF') =>
    el(
      {
        display: 'flex',
        alignSelf: 'flex-start',
        backgroundColor: bg,
        color: fg,
        padding: `${s(1.2)}px ${s(2.8)}px`,
        borderRadius: s(10),
        fontSize: s(2.2),
        fontWeight: 600,
        letterSpacing: s(2.2) * 0.06
      },
      text
    );
  const titolo = (text: string, pct = 6.2, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 500,
        letterSpacing: s(pct) * -0.02,
        lineHeight: 1.14
      })
    );
  const corpo = (text: string, color = C.soft, pct = 2.9) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.55, color }, text);
  const footer = () =>
    card(
      [
        row({ justifyContent: 'space-between', alignItems: 'center' }, [
          row({ alignItems: 'center', gap: s(1.8) }, [
            el({ display: 'flex', width: s(3), height: s(3), borderRadius: s(3), backgroundColor: C.slot, flexShrink: 0 }, ''),
            el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, color: C.ink }, BRAND_SLOT)
          ]),
          el({ display: 'flex', fontSize: s(2.4), color: C.faint }, SITE_SLOT)
        ])
      ],
      { paddingTop: s(3.2), paddingBottom: s(3.2) }
    );
  const foto = (src: string, hPct: number) =>
    img(src, contentW, s(hPct), { borderRadius: C.radius, flexShrink: 0 });

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        shell([
          card(
            [
              row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
                pill(p.kicker),
                starMark(C.slot, s(5))
              ]),
              gap(3),
              titolo(p.headline, 7.2),
              grow(1),
              corpo(p.sub, C.soft, 3.1)
            ],
            { flexGrow: 1 }
          ),
          footer()
        ]),
        undefined,
        [dotGrid(4, 5, C.slot, { absolute: { position: 'absolute', bottom: s(18), right: s(6), opacity: 0.15 } })]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return shell([
        foto(photos.a, 74),
        card([tape(p.kicker, C.slot, '#FFFFFF'), gap(2.6), titolo(p.headline, 6.6), gap(2.2), corpo(p.sub)], { flexGrow: 1 }),
        footer()
      ]);
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return shell([
        card([pill(p.kicker)], { paddingTop: s(3.2), paddingBottom: s(3.2) }),
        card(
          [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              brackets(s(10), C.slot),
              chevronStack(3, C.faint, s(2.8))
            ]),
            gap(3),
            col({ color: C.ink }, lines(p.quote, { fontSize: s(4.4), fontWeight: 500, lineHeight: 1.36, letterSpacing: s(4.4) * -0.015 })),
            grow(1),
            row({ alignItems: 'center', gap: s(2.2) }, [
              el({ display: 'flex', width: s(6), height: s(6), borderRadius: s(6), backgroundColor: C.bg, flexShrink: 0 }, ''),
              col({}, [
                el({ display: 'flex', fontSize: s(3), fontWeight: 600, color: C.ink }, p.author),
                el({ display: 'flex', fontSize: s(2.5), color: C.faint }, p.role)
              ])
            ])
          ],
          { flexGrow: 1 }
        ),
        footer()
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return shell([
        row({ gap: s(2.4) }, [
          card([pill(p.kicker)], { paddingTop: s(3.2), paddingBottom: s(3.2), flexShrink: 0 }),
          card([titolo(p.headline, 5.4)], { flexGrow: 1 })
        ]),
        col(
          { gap: s(2.4) },
          p.items.map((it, i) =>
            card(
              [
                row({ alignItems: 'center', gap: s(2.6) }, [
                  el(
                    {
                      display: 'flex',
                      width: s(5.4),
                      height: s(5.4),
                      borderRadius: s(5.4),
                      backgroundColor: C.bg,
                      color: C.slot,
                      fontSize: s(2.6),
                      fontWeight: 600,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    },
                    String(i + 1)
                  ),
                  el({ display: 'flex', fontSize: s(3), lineHeight: 1.35, color: C.ink, flexGrow: 1 }, it),
                  arrow(C.slot, s(3.5))
                ])
              ],
              { paddingTop: s(3.6), paddingBottom: s(3.6) }
            )
          )
        ),
        footer()
      ]);
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const blocco = (label: string, items: readonly string[], accent: boolean) =>
        card(
          [
            pill(label, accent ? C.slot : C.bg, accent ? '#FFFFFF' : C.soft),
            gap(2.6),
            col(
              { gap: s(1.6) },
              items.map((t) =>
                el({ display: 'flex', fontSize: s(2.9), lineHeight: 1.4, color: accent ? C.ink : C.soft }, t)
              )
            )
          ],
          { flexGrow: 1 }
        );
      return shell([
        card([pill(p.kicker), gap(2.4), titolo(p.headline, 5.6)]),
        blocco(p.a.label, p.a.items, false),
        blocco(p.b.label, p.b.items, true),
        footer()
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return shell([
        card([pill(p.kicker), gap(2.4), titolo(p.headline, 5.8), gap(2.2), corpo(p.sub)]),
        foto(photos.b, 46),
        card(
          [
            row({ alignItems: 'center', gap: s(2) }, [
              barcode(s(20), s(3), C.slot),
              el({ display: 'flex', fontSize: s(2.5), color: C.faint }, p.caption)
            ])
          ],
          { paddingTop: s(3), paddingBottom: s(3), flexGrow: 1 }
        ),
        footer()
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return shell([
        card([pill(p.kicker)], { paddingTop: s(3.2), paddingBottom: s(3.2) }),
        card(
          [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(22),
                  fontWeight: 500,
                  lineHeight: 0.92,
                  letterSpacing: s(22) * -0.04,
                  color: C.slot
                },
                p.stat
              ),
              plusMark(C.slot, s(5))
            ]),
            gap(2.4),
            col({ color: C.ink }, lines(p.label, { fontSize: s(3.2), lineHeight: 1.4 })),
            grow(1),
            corpo(p.sub, C.faint, 2.6)
          ],
          { flexGrow: 1 }
        ),
        footer()
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        shell([
          card(
            [
              col(
                { gap: s(2.4) },
                p.actions.map((a) =>
                  row({ alignItems: 'center', gap: s(2.4), fontSize: s(3), color: C.ink }, [
                    el(
                      {
                        display: 'flex',
                        width: s(3.4),
                        height: s(3.4),
                        borderRadius: s(3.4),
                        backgroundColor: C.bg,
                        flexShrink: 0
                      },
                      ''
                    ),
                    el({ display: 'flex' }, a)
                  ])
                )
              ),
              grow(1),
              row({ alignItems: 'center', gap: s(2.2) }, [
                el({ display: 'flex', width: s(6), height: s(6), borderRadius: s(6), backgroundColor: C.slot, flexShrink: 0 }, ''),
                el({ display: 'flex', fontFamily: f.display, fontSize: s(4.6), fontWeight: 500, color: C.ink }, p.handle)
              ])
            ],
            { flexGrow: 1 }
          ),
          footer()
        ]),
        undefined,
        [
          overflowTitle(p.headline, {
            fontFamily: f.display,
            fontSize: s(10),
            color: C.ink,
            fontWeight: 500
          }, 'right')
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const morbido: StylePreset = {
  slug: 'morbido',
  name: 'Morbido',
  thesis: {
    it: 'Tutto vive dentro schede bianche arrotondate che galleggiano su un fondo colorato. Niente tocca mai il bordo.',
    en: 'Everything lives inside rounded white cards floating on a coloured field. Nothing ever touches the edge.'
  },
  suits: {
    it: 'Chi deve risultare avvicinabile: benessere, salute, scuole, servizi locali, community.',
    en: 'Anyone who needs to feel approachable: wellness, health, schools, local services, community.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'campo tenue + schede', en: 'soft field + cards' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'geometrico 500', en: 'geometric 500' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'pannello con cornice', en: 'panel with a frame' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'due schede impilate', en: 'two stacked cards' } },
    { label: { it: 'testo su foto', en: 'type on photo' }, value: { it: 'mai', en: 'never' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'azioni a pallini', en: 'actions as dots' } }
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
