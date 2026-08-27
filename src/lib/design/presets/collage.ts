/**
 * COLLAGE — overlapping photo cluster on white air.
 *
 * Reference move: a shuffled deck of photographs in the centre, huge asymmetric titles top-left
 * and bottom-right, and monospace metadata pinned to every corner.
 */
import {
  BRAND_SLOT,
  DEMO,
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
import { brackets, canvas, letterStack, overflowTitle, starMark } from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  bg: '#F4F3F0',
  ink: '#0A0A0A',
  soft: '#6A6660',
  pad: s(6.5)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const mono = (text: string, align: 'flex-start' | 'flex-end' | 'center' = 'flex-start', color = C.soft) =>
    el(
      {
        display: 'flex',
        fontFamily: f.mono,
        fontSize: s(2),
        fontWeight: 500,
        letterSpacing: s(2) * 0.06,
        textTransform: 'uppercase',
        color,
        justifyContent: align === 'flex-end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
      },
      text
    );

  const titolo = (text: string, pct = 9, align: 'flex-start' | 'flex-end' = 'flex-start') =>
    col(
      { color: C.ink, alignItems: align, width: '100%' },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.035,
        lineHeight: 0.92,
        textTransform: 'uppercase',
        justifyContent: align === 'flex-end' ? 'flex-end' : 'flex-start'
      })
    );

  const cluster = (size: 'lg' | 'md' = 'lg'): El => {
    const scale = size === 'lg' ? 1 : 0.82;
    const w1 = Math.round(s(38) * scale);
    const h1 = Math.round(s(48) * scale);
    const w2 = Math.round(s(32) * scale);
    const h2 = Math.round(s(40) * scale);
    const w3 = Math.round(s(28) * scale);
    const h3 = Math.round(s(36) * scale);
    const boxW = s(72);
    const boxH = s(58);
    return el(
      {
        display: 'flex',
        position: 'relative',
        width: boxW,
        height: boxH,
        alignSelf: 'center'
      },
      [
        el({ display: 'flex', position: 'absolute', left: 0, top: s(6), width: w1, height: h1, overflow: 'hidden' }, [
          img(photos.a, w1, h1)
        ]),
        el(
          {
            display: 'flex',
            position: 'absolute',
            right: 0,
            top: 0,
            width: w2,
            height: h2,
            overflow: 'hidden',
            border: `3px solid ${C.bg}`
          },
          [img(photos.b, w2, h2)]
        ),
        el(
          {
            display: 'flex',
            position: 'absolute',
            left: s(18),
            bottom: 0,
            width: w3,
            height: h3,
            overflow: 'hidden',
            border: `3px solid ${C.bg}`
          },
          [img(photos.c, w3, h3)]
        )
      ]
    );
  };

  const topBar = (left: string, right = '//2026') =>
    row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [mono(left), mono(right, 'flex-end')]);

  const bottomBar = () =>
    row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
      mono(`DESIGNED FOR / ${BRAND_SLOT}`),
      mono(SITE_SLOT, 'flex-end')
    ]);

  switch (kind) {
    case 'cover': {
      const p = DEMO.cover;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          topBar('SERVICES / SOCIAL MEDIA DESIGNS'),
          gap(3),
          titolo('CLIENT\n SOCIAL', 9.5),
          grow(1),
          cluster('lg'),
          grow(1),
          titolo('FINAL\nRESULTS', 9.5, 'flex-end'),
          gap(3),
          bottomBar()
        ])
      );
    }

    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          topBar(`SERVICES / ${p.kicker}`),
          gap(3),
          titolo(p.headline, 8),
          grow(1),
          cluster('lg'),
          grow(1),
          titolo(p.sub.replace(/\./g, ''), 6.4, 'flex-end'),
          gap(3),
          bottomBar()
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.ink,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          topBar(p.kicker, p.author.toUpperCase()),
          grow(1),
          starMark('#FFFFFF', s(8)),
          gap(4),
          col(
            { color: '#FFFFFF', alignItems: 'center', maxWidth: s(82) },
            lines(`"${p.quote}"`, {
              fontFamily: f.display,
              fontSize: s(4.4),
              fontWeight: 700,
              lineHeight: 1.15,
              justifyContent: 'center'
            })
          ),
          gap(2.4),
          mono(`${p.author} — ${p.role}`, 'center', '#FFFFFF'),
          grow(1),
          bottomBar()
        ])
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        row({ padding: C.pad, fontFamily: f.body }, [
          col({ flexGrow: 1, paddingRight: s(4) }, [
            topBar(p.kicker),
            gap(4),
            col(
              { gap: s(1.8) },
              p.items.map((it, i) => mono(`0${i + 1}  ${it}`, 'flex-start', C.ink))
            ),
            grow(1),
            bottomBar()
          ]),
          col({ justifyContent: 'center' }, [
            letterStack('STEP', { fontFamily: f.display, fontSize: s(3.4), color: C.ink, fontWeight: 700 })
          ])
        ]),
        undefined,
        [
          overflowTitle(p.headline.split('\n')[0] ?? 'WORK', {
            fontFamily: f.display,
            fontSize: s(16),
            color: C.ink,
            fontWeight: 700,
            opacity: 0.07
          }, 'bottom')
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          topBar(p.kicker),
          gap(3),
          row({ gap: s(3), justifyContent: 'center' }, [
            el({ display: 'flex', width: s(34), height: s(44), overflow: 'hidden' }, [img(photos.b, s(34), s(44))]),
            el({ display: 'flex', width: s(34), height: s(44), overflow: 'hidden' }, [img(photos.c, s(34), s(44))])
          ]),
          gap(3),
          row({ justifyContent: 'space-between' }, [
            col({ gap: s(1.2), flexGrow: 1 }, [
              mono(p.a.label, 'flex-start', C.ink),
              ...p.a.items.map((it) => mono(it))
            ]),
            col({ gap: s(1.2), flexGrow: 1, alignItems: 'flex-end' }, [
              mono(p.b.label, 'flex-end', C.ink),
              ...p.b.items.map((it) => mono(it, 'flex-end'))
            ])
          ]),
          grow(0.4),
          titolo(p.headline, 6.5, 'flex-end'),
          gap(3),
          bottomBar()
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body }, [
          topBar(p.kicker),
          grow(1),
          cluster('md'),
          gap(4),
          row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
            titolo(p.headline, 7),
            brackets(s(14), C.ink)
          ]),
          gap(2),
          mono(p.sub.toUpperCase()),
          grow(1),
          titolo('FINAL\nRESULTS', 7, 'flex-end'),
          gap(3),
          bottomBar()
        ])
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.bg,
        col({ padding: C.pad, fontFamily: f.body, alignItems: 'center' }, [
          topBar(p.kicker),
          grow(1),
          titolo(p.stat, 26),
          gap(2),
          cluster('md'),
          gap(3),
          titolo(p.label, 4),
          grow(1),
          bottomBar()
        ])
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.ink,
        col({ padding: C.pad, fontFamily: f.body }, [
          topBar(p.kicker, 'END'),
          gap(3),
          titolo(p.headline, 9, 'flex-start'),
          grow(1),
          cluster('md'),
          grow(1),
          col(
            { gap: s(1.8), alignItems: 'flex-end', width: '100%' },
            p.actions.map((a) => mono(`→ ${a}`, 'flex-end', '#FFFFFF'))
          ),
          gap(3),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontFamily: f.display, fontSize: s(4.6), fontWeight: 700, color: '#FFFFFF' }, p.handle),
            mono(SITE_SLOT, 'flex-end', 'rgba(255,255,255,0.65)')
          ])
        ])
      );
    }

    default:
      return build('cover', f, photos);
  }
}

export const collage: StylePreset = {
  slug: 'collage',
  name: 'Collage',
  thesis: {
    it: 'Un mazzo di foto sovrapposte al centro, titoli asimmetrici, meta mono agli angoli.',
    en: 'A shuffled photo deck in the centre, asymmetric titles, monospace meta in every corner.'
  },
  suits: {
    it: 'Fashion, streetwear, case study, portfolio agency — chi mostra un feed, non una slide.',
    en: 'Fashion, streetwear, case studies, agency portfolios — anyone showing a feed, not a slide.'
  },
  fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'bianco aria', en: 'white air' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'caps asimmetrici', en: 'asymmetric caps' } },
    { label: { it: 'firma', en: 'signature' }, value: { it: 'cluster sovrapposto', en: 'overlapping cluster' } },
    { label: { it: 'meta', en: 'meta' }, value: { it: 'mono agli angoli', en: 'mono in corners' } },
    { label: { it: 'foto', en: 'photo' }, value: { it: 'mai sotto al testo', en: 'never under type' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'azioni a destra', en: 'actions right-aligned' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.ink, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.ink,
    muted: C.soft,
    displayFont: 'Inter',
    bodyFont: 'Inter'
  }
};
