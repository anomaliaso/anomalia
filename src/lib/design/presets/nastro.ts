/**
 * NASTRO — type sandwich with a photo strip.
 *
 * Reference move: two massive title blocks with a continuous row of square thumbnails between
 * them. The strip IS the ornament; everything else is black grotesque on off-white air.
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
import { arrow, barcode, canvas, letterStack, overflowTitle, repeatPhrase } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#EFEFEF',
  ink: '#0A0A0A',
  soft: 'rgba(10,10,10,0.55)',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const meta = (left: string, right: string, color = C.ink) =>
    row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
      el(
        {
          display: 'flex',
          fontSize: s(2.2),
          fontWeight: 600,
          letterSpacing: s(2.2) * 0.18,
          textTransform: 'uppercase',
          color
        },
        left
      ),
      col(
        { alignItems: 'flex-end' },
        lines(right, {
          fontSize: s(2),
          fontWeight: 600,
          letterSpacing: s(2) * 0.14,
          textTransform: 'uppercase',
          color,
          justifyContent: 'flex-end'
        })
      )
    ]);

  const titolo = (text: string, pct = 12.5, color = C.ink, align: 'flex-start' | 'center' | 'flex-end' = 'center') =>
    col(
      { color, alignItems: align, width: '100%' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.04,
        lineHeight: 0.9,
        textTransform: 'uppercase',
        justifyContent: align === 'flex-end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
      })
    );

  const nastro = (srcs: string[], tile = s(14)) =>
    row(
      { width: PRESET_WIDTH, marginLeft: -C.pad, gap: 0, overflow: 'hidden' },
      srcs.map((src) => img(src, tile, tile, { flexShrink: 0 }))
    );

  const stripSrcs = (ph: PresetPhotos) => [ph.a, ph.b, ph.c, ph.a, ph.b, ph.c, ph.a, ph.b];

  const footer = (color = C.ink) =>
    row({ justifyContent: 'space-between', alignItems: 'center' }, [
      el({ display: 'flex', fontSize: s(2.6), fontWeight: 700, textTransform: 'uppercase', color }, BRAND_SLOT),
      el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
    ]);

  const lista = (items: readonly string[], color = C.ink) =>
    col(
      { gap: s(2), width: '100%' },
      items.map((it, i) =>
        el(
          {
            display: 'flex',
            fontSize: s(3.2),
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: s(3.2) * -0.01,
            color
          },
          `0${i + 1}  ${it}`
        )
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          meta(BRAND_SLOT, 'FUTURE\nIS HERE'),
          gap(4),
          titolo(p.headline, 11, C.ink, 'flex-start'),
          grow(1),
          nastro(stripSrcs(photos), s(14)),
          grow(1),
          row({ justifyContent: 'flex-end', width: '100%' }, [
            titolo('S—01\nSOCIAL', 10, C.ink, 'flex-end')
          ]),
          gap(3),
          footer()
        ])
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'rgba(10,10,10,0.55)',
        col({ width: PRESET_WIDTH, height: PRESET_HEIGHT, padding: C.pad, fontFamily: f.body }, [
          meta(BRAND_SLOT, 'FUTURE\nIS HERE', '#FFFFFF'),
          grow(1),
          titolo(p.headline, 11, '#FFFFFF'),
          gap(4),
          nastro(stripSrcs(photos), s(13)),
          gap(4),
          titolo(p.sub.replace(/\./g, ''), 8, '#FFFFFF'),
          grow(1),
          footer('#FFFFFF')
        ]),
        C.ink
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.ink,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          meta(p.kicker, p.author.toUpperCase(), '#FFFFFF'),
          grow(1),
          col(
            { color: '#FFFFFF', alignItems: 'center', maxWidth: s(85) },
            lines(`"${p.quote}"`, {
              fontFamily: f.display,
              fontSize: s(5),
              fontWeight: 700,
              lineHeight: 1.12,
              justifyContent: 'center'
            })
          ),
          gap(4),
          nastro(stripSrcs(photos), s(10)),
          grow(1),
          footer('#FFFFFF')
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body }, [
          col({ flexGrow: 1, paddingRight: s(3) }, [
            meta(p.kicker, 'STEPS'),
            gap(4),
            lista(p.items),
            grow(1),
            barcode(s(36), s(4.5), C.ink)
          ]),
          col({ justifyContent: 'center' }, [
            letterStack('HOW', { fontFamily: f.display, fontSize: s(3.6), color: C.ink, fontWeight: 700 })
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'WORK', {
            fontFamily: f.display,
            fontSize: s(18),
            color: C.ink,
            fontWeight: 700,
            opacity: 0.08
          }, 'top')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          meta(p.kicker, `${p.a.label} / ${p.b.label}`),
          gap(3),
          nastro([photos.b, photos.c, photos.b, photos.c, photos.b, photos.c, photos.b, photos.c], s(16)),
          gap(4),
          row({ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }, [
            col({ flexGrow: 1, gap: s(1.4) }, [
              titolo(p.a.label, 5.5, C.soft, 'flex-start'),
              ...p.a.items.map((it) =>
                el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, textTransform: 'uppercase', color: C.soft }, it)
              )
            ]),
            col({ flexGrow: 1, gap: s(1.4), alignItems: 'flex-end' }, [
              titolo(p.b.label, 5.5, C.ink, 'flex-end'),
              ...p.b.items.map((it) =>
                el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, textTransform: 'uppercase', color: C.ink }, it)
              )
            ])
          ]),
          grow(1),
          footer()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
            titolo(p.headline, 9.4, C.ink, 'flex-start'),
            meta(p.kicker, p.caption.toUpperCase())
          ]),
          gap(4),
          nastro(stripSrcs(photos), s(18)),
          grow(1),
          el(
            {
              display: 'flex',
              fontSize: s(3),
              fontWeight: 600,
              textTransform: 'uppercase',
              color: C.soft,
              maxWidth: s(60)
            },
            p.sub
          ),
          gap(3),
          footer()
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          meta(p.kicker, 'METRIC'),
          grow(1),
          titolo(p.stat, 28),
          gap(3),
          repeatPhrase('METRIC', 4, { fontFamily: f.mono, fontSize: s(2.4), color: C.soft, fontWeight: 600 }),
          gap(3.4),
          titolo(p.label, 4.2),
          grow(1),
          footer()
        ])
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.ink,
        col({ padding: C.pad, fontFamily: f.body }, [
          meta(p.kicker, 'END', '#FFFFFF'),
          grow(1),
          titolo(p.headline, 12, '#FFFFFF'),
          gap(4),
          nastro(stripSrcs(photos), s(12)),
          gap(4),
          lista(p.actions, '#FFFFFF'),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(5.4),
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#FFFFFF'
              },
              p.handle
            ),
            arrow('#FFFFFF', s(5))
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const nastro: StylePreset = {
  slug: 'nastro',
  name: 'Nastro',
  thesis: {
    it: 'Due titoli enormi con un nastro di foto quadrate in mezzo. Il strip è l\'unico ornamento.',
    en: 'Two giant titles with a strip of square photos between them. The strip is the only ornament.'
  },
  suits: {
    it: 'Agency, creator, fashion, portfolio — chi vende un flusso di lavoro, non un prodotto solo.',
    en: 'Agencies, creators, fashion, portfolios — anyone selling a workflow, not a single product.'
  },
  fonts: { display: 'Archivo', body: 'Archivo', mono: 'Archivo' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'grigio chiaro', en: 'light grey' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesque black caps', en: 'black grotesque caps' } },
    { label: { it: 'firma', en: 'signature' }, value: { it: 'nastro di thumbnail', en: 'thumbnail strip' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'velo scuro + strip', en: 'dark veil + strip' } },
    { label: { it: 'meta', en: 'meta' }, value: { it: 'angoli in caps', en: 'corner caps' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'strip + azioni', en: 'strip + actions' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.ink, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.ink,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Archivo'
  }
};
