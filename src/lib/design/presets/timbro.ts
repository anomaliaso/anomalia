/**
 * TIMBRO — stamps, circles, colour blocks.
 *
 * The second bold answer, closer to The Social Hub's Dumbar identity: a warm paper ground,
 * overlapping colour stamps, and photographs cut into hub circles rather than written over.
 */
import {
  BRAND_SLOT,
  DEMO,
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
import { brackets, canvas, dotGrid, letterStack, overflowTitle, plusMark, tape } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F3EEE4',
  ink: '#0E0E0E',
  soft: '#4A4540',
  faint: '#8A837A',
  slot: '#FF4D00',
  blue: '#2B5BFF',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const contentW = PRESET_WIDTH - C.pad * 2;

  const stamp = (text: string, bg = C.slot, fg = '#FFFFFF') => tape(text, bg, fg, { borderRadius: s(10) });
  const hubDot = (size: number, color: string) =>
    el({ display: 'flex', width: size, height: size, borderRadius: size, backgroundColor: color, flexShrink: 0 }, '');
  const hubPhoto = (src: string, size: number) => img(src, size, size, { borderRadius: size, flexShrink: 0 });
  const titolo = (text: string, pct = 8.4, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.035,
        lineHeight: 0.98
      })
    );
  const corpo = (text: string, color = C.soft, pct = 3) =>
    el({ display: 'flex', fontSize: s(pct), lineHeight: 1.4, fontWeight: 500, color }, text);
  const footer = () =>
    row({ justifyContent: 'space-between', alignItems: 'center' }, [
      row({ alignItems: 'center', gap: s(2) }, [
        hubDot(s(4.4), C.slot),
        el({ display: 'flex', fontSize: s(2.8), fontWeight: 700, color: C.ink }, BRAND_SLOT)
      ]),
      el({ display: 'flex', fontSize: s(2.4), fontWeight: 600, color: C.faint }, SITE_SLOT)
    ]);
  const chipRow = (items: readonly string[], accent = C.slot, ink = C.ink) =>
    col(
      { gap: s(2) },
      items.map((it) =>
        row({ alignItems: 'center', gap: s(2.2) }, [
          hubDot(s(2.4), accent),
          el({ display: 'flex', fontSize: s(3.1), fontWeight: 600, color: ink, lineHeight: 1.25 }, it)
        ])
      )
    );

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ gap: s(2), alignItems: 'center' }, [
            hubDot(s(8), C.slot),
            hubDot(s(5.5), C.blue),
            hubDot(s(3.5), C.ink)
          ]),
          gap(4),
          stamp(p.kicker),
          grow(1),
          titolo(p.headline, 9.4),
          gap(3.2),
          corpo(p.sub, C.ink, 3.2),
          grow(0.5),
          footer()
        ]),
        undefined,
        [
          overflowTitle('HUB', { fontFamily: f.display, fontSize: s(20), color: C.blue, fontWeight: 700 }, 'left')
        ]
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      const dia = s(78);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          stamp(p.kicker),
          grow(1),
          hubPhoto(photos.a, dia),
          grow(1),
          titolo(p.headline, 7.6),
          gap(2.4),
          corpo(p.sub),
          gap(4),
          footer()
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.blue,
        col({ padding: C.pad, fontFamily: f.body }, [
          row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
            stamp(p.kicker, C.slot),
            plusMark('#FFFFFF', s(7))
          ]),
          grow(1),
          col(
            { color: '#FFFFFF' },
            lines(p.quote, {
              fontFamily: f.display,
              fontSize: s(5.2),
              fontWeight: 700,
              letterSpacing: s(5.2) * -0.025,
              lineHeight: 1.12
            })
          ),
          gap(5),
          row({ alignItems: 'center', gap: s(2.6) }, [
            hubPhoto(photos.c, s(12)),
            col({}, [
              el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: '#FFFFFF' }, p.author),
              gap(0.6),
              el({ display: 'flex', fontSize: s(2.6), fontWeight: 500, color: 'rgba(255,255,255,0.75)' }, p.role)
            ])
          ]),
          grow(0.5),
          footer()
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body }, [
          col({ justifyContent: 'center', paddingRight: s(3) }, [
            letterStack('STEP', { fontFamily: f.display, fontSize: s(3.8), color: C.slot, fontWeight: 700 })
          ]),
          col({ flexGrow: 1 }, [
            stamp(p.kicker, C.blue),
            gap(4),
            chipRow(p.items, C.slot),
            grow(1),
            dotGrid(3, 3, C.faint, { gap: s(1.2), size: s(0.9) })
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'PLAN', {
            fontFamily: f.display,
            fontSize: s(14),
            color: C.ink,
            fontWeight: 700
          }, 'bottom')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      const pane = (label: string, items: readonly string[], stampBg: string, photo: string) =>
        col({ flexGrow: 1, flexBasis: 0, gap: s(2.4), alignItems: 'center' }, [
          hubPhoto(photo, (contentW - s(3)) / 2),
          stamp(label, stampBg),
          ...items.map((it) =>
            el({ display: 'flex', fontSize: s(2.6), fontWeight: 600, lineHeight: 1.3, color: C.soft, textAlign: 'center' }, it)
          )
        ]);
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          stamp(p.kicker, C.ink),
          gap(3.4),
          titolo(p.headline, 7),
          gap(4),
          row({ gap: s(3) }, [
            pane(p.a.label, p.a.items, C.faint, photos.b),
            pane(p.b.label, p.b.items, C.slot, photos.c)
          ]),
          grow(1),
          footer()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      const dia = s(42);
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body, alignItems: 'center', gap: s(4) }, [
          hubPhoto(photos.b, dia),
          col({ flexGrow: 1, flexBasis: 0 }, [
            stamp(p.kicker, C.blue),
            gap(3),
            titolo(p.headline, 6.2),
            gap(2.4),
            corpo(p.sub, C.soft, 2.8),
            gap(2),
            el({ display: 'flex', fontSize: s(2.3), fontWeight: 600, color: C.faint }, p.caption),
            grow(1),
            footer()
          ])
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          row({ width: '100%', justifyContent: 'space-between', alignItems: 'center' }, [
            stamp(p.kicker),
            brackets(s(12), C.slot)
          ]),
          grow(1),
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(36),
              fontWeight: 700,
              lineHeight: 0.85,
              letterSpacing: s(36) * -0.045,
              color: C.ink
            },
            p.stat
          ),
          gap(3),
          col({ color: C.ink, alignItems: 'center' }, lines(p.label, { fontSize: s(3.8), fontWeight: 700, lineHeight: 1.2, justifyContent: 'center' })),
          gap(2.4),
          corpo(p.sub, C.soft, 2.9),
          grow(0.5),
          footer()
        ])
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.blue,
        col({ padding: C.pad, fontFamily: f.body }, [
          stamp(p.kicker, C.slot),
          grow(1),
          hubDot(s(18), '#FFFFFF'),
          gap(5),
          titolo(p.headline, 10, '#FFFFFF'),
          gap(3),
          corpo(p.sub, 'rgba(255,255,255,0.8)', 3.1),
          gap(4.5),
          chipRow(p.actions, C.slot, '#FFFFFF'),
          grow(0.45),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el(
              {
                display: 'flex',
                fontFamily: f.display,
                fontSize: s(5.2),
                fontWeight: 700,
                color: '#FFFFFF',
                letterSpacing: s(5.2) * -0.02
              },
              p.handle
            ),
            el({ display: 'flex', fontSize: s(2.5), fontWeight: 600, color: 'rgba(255,255,255,0.7)' }, SITE_SLOT)
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const timbro: StylePreset = {
  slug: 'timbro',
  name: 'Timbro',
  thesis: {
    it: 'Francobolli, cerchi hub e blocchi di colore primario. La foto non si scrive sopra: diventa un cerchio.',
    en: 'Stamps, hub circles and primary colour blocks. Type never sits on a photo — the photo becomes a circle.'
  },
  suits: {
    it: 'Hospitality, community, education, coworking, brand culturali — comunicazione inclusiva e vivace.',
    en: 'Hospitality, community, education, coworking, cultural brands — buoyant inclusive communication.'
  },
  fonts: { display: 'Bricolage Grotesque', body: 'DM Sans', mono: 'DM Sans' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'carta calda', en: 'warm paper' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'grotesque 700', en: 'grotesque 700' } },
    { label: { it: 'foto piena', en: 'full photo' }, value: { it: 'cerchio hub gigante', en: 'giant hub circle' } },
    { label: { it: 'ornamento', en: 'ornament' }, value: { it: 'cerchi + stamp colorati', en: 'circles + colour stamps' } },
    { label: { it: 'confronto', en: 'comparison' }, value: { it: 'due cerchi affiancati', en: 'two circles side by side' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'blocco cobalto', en: 'cobalt block' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.slot, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.slot,
    muted: C.soft,
    displayFont: 'Bricolage Grotesque',
    bodyFont: 'DM Sans'
  }
};
