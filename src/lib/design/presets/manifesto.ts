/**
 * MANIFESTO — a poster.
 *
 * The rule: the headline takes half the canvas in condensed caps, a thick bar under it, and
 * everything else shrinks to get out of its way. Black ground, white ink, no third colour.
 *
 * On a photograph it drowns the picture under a flat 58% veil and prints straight over it. Ugly on
 * paper, right here: the veil is a constant, so ANY photograph works — which is the only honest
 * assumption when the photograph is picked by a machine.
 *
 * The closing slide inverts to white. A carousel needs an ending you can feel without reading it.
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
  arrow,
  barcode,
  brackets,
  canvas,
  chevronStack,
  dotGrid,
  letterStack,
  overflowTitle,
  plusMark,
  repeatPhrase,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = { bg: '#0B0B0B', ink: '#FFFFFF', soft: 'rgba(255,255,255,0.55)', pad: s(7.5) };
const ACCENT = '#FFFFFF';

const fonts = { display: 'Anton', body: 'Work Sans', mono: 'Work Sans' };

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const base = { width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, padding: C.pad, fontFamily: f.body };

  const targa = (text: string, bg = '#FFFFFF', fg = C.bg) =>
    el(
      {
        display: 'flex',
        alignSelf: 'flex-start',
        backgroundColor: bg,
        color: fg,
        padding: `${s(1.2)}px ${s(2.8)}px`,
        fontSize: s(2.3),
        fontWeight: 600,
        letterSpacing: s(2.3) * 0.14,
        textTransform: 'uppercase'
      },
      text
    );
  const barra = (color = '#FFFFFF') => el({ display: 'flex', width: '100%', height: s(1.2), backgroundColor: color }, '');
  const titolo = (text: string, pct = 13, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        lineHeight: 0.92,
        letterSpacing: s(pct) * -0.02,
        textTransform: 'uppercase'
      })
    );
  const minuscolo = (text: string, color = C.soft) =>
    el({ display: 'flex', fontSize: s(3), lineHeight: 1.35, color, textTransform: 'uppercase', fontWeight: 500 }, text);
  const footer = (ink = C.ink, soft = C.soft) =>
    row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
      el(
        {
          display: 'flex',
          fontFamily: f.display,
          fontSize: s(4.6),
          color: ink,
          textTransform: 'uppercase',
          letterSpacing: s(4.6) * -0.01
        },
        BRAND_SLOT
      ),
      el({ display: 'flex', fontSize: s(2.5), color: soft }, SITE_SLOT)
    ]);
  const indice = (items: readonly string[], num = C.ink, txt = C.soft) =>
    col(
      { gap: s(1.8) },
      items.map((it, i) =>
        row({ gap: s(2.4), fontSize: s(3), color: txt, textTransform: 'uppercase', fontWeight: 500 }, [
          el({ display: 'flex', width: s(4.4), flexShrink: 0, color: num }, `0${i + 1}`),
          el({ display: 'flex' }, it)
        ])
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          targa(p.kicker),
          grow(1),
          titolo(p.headline, 14),
          gap(3.6),
          barra(),
          gap(3),
          minuscolo(p.sub),
          grow(0.5),
          footer()
        ]),
        undefined,
        [
          overflowTitle(p.headline.split('\n')[0] ?? '', {
            fontFamily: f.display,
            fontSize: s(18),
            color: ACCENT,
            fontWeight: 700,
            opacity: 0.06
          }, 'right'),
          el(
            { display: 'flex', position: 'absolute', bottom: s(22), left: s(5), opacity: 0.07 },
            repeatPhrase('NOW', 3, { fontFamily: f.display, fontSize: s(6), color: ACCENT, fontWeight: 700 })
          )
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'rgba(11,11,11,0.58)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            targa(p.kicker),
            dotGrid(4, 3, 'rgba(255,255,255,0.25)')
          ]),
          grow(1),
          titolo(p.headline, 15),
          gap(4),
          barra(),
          gap(3.4),
          minuscolo(p.sub, 'rgba(255,255,255,0.75)'),
          grow(0.5),
          footer()
        ]),
        C.bg
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return row({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ paddingTop: C.pad, paddingBottom: C.pad, paddingLeft: C.pad, justifyContent: 'center' }, [
          letterStack('SAID', { fontFamily: f.display, fontSize: s(3.6), color: ACCENT, fontWeight: 700 })
        ]),
        col({ flexGrow: 1, padding: C.pad, paddingLeft: 0 }, [
          targa(p.kicker),
          grow(1),
          col(
            { color: C.ink },
            lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(8.6),
              lineHeight: 0.98,
              letterSpacing: s(8.6) * -0.02,
              textTransform: 'uppercase'
            })
          ),
          gap(4),
          barra(),
          gap(3.4),
          row({ alignItems: 'center', gap: s(2.4) }, [
            el({ display: 'flex', width: s(5), height: s(5), borderRadius: s(5), backgroundColor: C.ink, flexShrink: 0 }, ''),
            col({}, [
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(3.8),
                  color: C.ink,
                  textTransform: 'uppercase',
                  letterSpacing: s(3.8) * -0.01
                },
                p.author
              ),
              el({ display: 'flex', fontSize: s(2.5), color: C.soft, textTransform: 'uppercase' }, p.role)
            ])
          ]),
          grow(0.5),
          footer()
        ])
      ]);
    }

    case 'lista': {
      const p = DEMO.lista;
      return col(base, [
        row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
          titolo(p.headline, 11),
          chevronStack(5, ACCENT, s(3.8))
        ]),
        gap(4),
        barra(),
        gap(3.4),
        indice(p.items),
        grow(0.55),
        row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
          targa(p.kicker, C.ink, C.bg),
          footer()
        ])
      ]);
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const meta = (label: string, items: readonly string[], bg: string, ink: string, soft: string) =>
        col({ backgroundColor: bg, padding: C.pad, flexGrow: 1, flexBasis: 0 }, [
          el(
            {
              display: 'flex',
              alignSelf: 'flex-start',
              backgroundColor: ink,
              color: bg,
              padding: `${s(1)}px ${s(2.2)}px`,
              fontSize: s(2.2),
              fontWeight: 600,
              letterSpacing: s(2.2) * 0.14,
              textTransform: 'uppercase'
            },
            label
          ),
          grow(1),
          col(
            { gap: s(1.4) },
            items.map((it) =>
              el(
                { display: 'flex', fontSize: s(3.2), lineHeight: 1.2, color: soft, textTransform: 'uppercase', fontWeight: 500 },
                it
              )
            )
          )
        ]);
      return col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        col({ padding: `${C.pad}px ${C.pad}px 0` }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            titolo(p.headline, 9.4),
            brackets(s(12), ACCENT)
          ])
        ]),
        gap(3),
        meta(p.a.label, p.a.items, C.bg, C.ink, C.soft),
        meta(p.b.label, p.b.items, '#FFFFFF', C.bg, 'rgba(11,11,11,0.72)')
      ]);
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, backgroundColor: C.bg, fontFamily: f.body }, [
        img(photos.b, PRESET_WIDTH, s(48)),
        col({ padding: C.pad, flexGrow: 1 }, [
          tape(p.kicker, ACCENT, C.bg),
          grow(1),
          titolo(p.headline, 10.6),
          gap(3.4),
          barra(),
          gap(3),
          minuscolo(p.sub),
          gap(5),
          footer()
        ])
      ]);
    }

    case 'numero': {
      const p = DEMO.numero;
      return col(base, [
        targa(p.kicker),
        grow(1),
        el(
          { display: 'flex', fontFamily: f.display, fontSize: s(46), lineHeight: 0.82, color: C.ink, letterSpacing: s(46) * -0.03 },
          p.stat
        ),
        gap(3),
        barcode(s(42), s(5), ACCENT),
        gap(3),
        col({ color: C.ink }, lines(p.label, { fontSize: s(4), fontWeight: 600, lineHeight: 1.2, textTransform: 'uppercase' })),
        grow(0.6),
        footer()
      ]);
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        '#FFFFFF',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          targa(p.kicker, C.bg, '#FFFFFF'),
          grow(1),
          titolo(p.headline, 15, C.bg),
          gap(3.6),
          barra(C.bg),
          gap(3),
          minuscolo(p.sub, 'rgba(11,11,11,0.55)'),
          gap(3.4),
          col(
            { gap: s(2) },
            p.actions.map((a) =>
              row({ alignItems: 'center', gap: s(2.4) }, [
                plusMark(C.bg, s(3.6)),
                el({ display: 'flex', fontSize: s(3), color: 'rgba(11,11,11,0.6)', textTransform: 'uppercase', fontWeight: 500 }, a)
              ])
            )
          ),
          grow(0.5),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            row({ alignItems: 'center', gap: s(2.4) }, [
              el({ display: 'flex', width: s(7), height: s(7), borderRadius: s(7), backgroundColor: C.bg, flexShrink: 0 }, ''),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(7),
                  color: C.bg,
                  textTransform: 'uppercase',
                  letterSpacing: s(7) * -0.02
                },
                p.handle
              )
            ]),
            arrow(C.bg, s(5))
          ])
        ]),
        undefined,
        [
          el({ display: 'flex', position: 'absolute', top: s(6), right: s(5) }, [
            brackets(s(14), C.bg)
          ])
        ]
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const manifesto: StylePreset = {
  slug: 'manifesto',
  name: 'Manifesto',
  thesis: {
    it: 'Un cartello. Il titolo occupa metà tela in condensato maiuscolo e ti aggredisce dallo scroll.',
    en: 'A poster. The headline takes half the canvas in condensed caps and ambushes the scroll.'
  },
  suits: {
    it: 'Chi deve fermare il pollice: creator, fitness, eventi, D2C, opinione.',
    en: 'Anyone who has to stop a thumb: creators, fitness, events, D2C, opinion.'
  },
  fonts,
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'nero pieno', en: 'full black' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'condensato heavy', en: 'heavy condensed' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'velo piatto 58%', en: 'flat 58% veil' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'tela divisa in due', en: 'canvas split in two' } },
    { label: { it: 'citazione', en: 'quote' }, value: { it: 'urlata, senza virgolette', en: 'shouted, no quote marks' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'inverte in bianco', en: 'inverts to white' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: ACCENT, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: ACCENT,
    muted: C.soft,
    displayFont: fonts.display,
    bodyFont: fonts.body
  }
};
