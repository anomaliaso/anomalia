/**
 * PROTESTA — activist red / black / cream.
 *
 * Guerrilla poster logic: giant NO, lists crossed by a red X made of two bars, one word in red on
 * cream air. No soft corners. The brand reads like a campaign, not a carousel template.
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
  brackets,
  canvas,
  letterStack,
  overflowTitle,
  POST_SIZE,
  repeatPhrase,
  tape
} from './ornaments';
import { makeStories } from './stories-factory';

const C = {
  red: '#E10600',
  bg: '#F3EFE6',
  ink: '#0A0A0A',
  soft: '#4A4540',
  pad: s(7)
};

function build(kind: PresetSlide, f: PresetFonts, photos: PresetPhotos): El {
  const titolo = (text: string, pct = 10, color = C.ink) =>
    col(
      { color },
      lines(text, {
        fontFamily: f.display,
        fontSize: s(pct),
        fontWeight: 700,
        letterSpacing: s(pct) * -0.03,
        lineHeight: 0.95,
        textTransform: 'uppercase'
      })
    );

  const bigX = (size = s(50)) =>
    el(
      {
        display: 'flex',
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: f.display,
        fontSize: size * 0.95,
        fontWeight: 700,
        color: C.red,
        lineHeight: 1,
        opacity: 0.85
      },
      '✕'
    );

  switch (kind) {
    case 'fotopiena': {
      const p = DEMO.fotopiena;
      return canvas(
        C.ink,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, '#FFFFFF'),
          gap(3),
          el({ display: 'flex', width: '100%', height: s(55), overflow: 'hidden' }, [
            img(photos.a, PRESET_WIDTH - C.pad * 2, s(55))
          ]),
          gap(3),
          titolo(p.headline, 8, '#FFFFFF'),
          gap(2),
          el({ display: 'flex', fontSize: s(2.8), color: 'rgba(255,255,255,0.65)' }, p.sub),
          grow(1),
          row({ justifyContent: 'space-between', alignItems: 'center' }, [
            el({ display: 'flex', fontSize: s(2.5), color: C.red }, BRAND_SLOT),
            brackets(s(10), C.red)
          ])
        ])
      );
    }

    case 'citazione': {
      const p = DEMO.citazione;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, C.bg),
          grow(1),
          titolo(`"${p.quote}"`, 5.6),
          gap(3),
          arrow(C.red, s(5)),
          gap(2),
          el({ display: 'flex', fontSize: s(3), fontWeight: 700, color: C.ink }, p.author),
          grow(0.5),
          repeatPhrase('RESIST', 2, {
            fontFamily: f.display,
            fontSize: s(4),
            color: C.red,
            fontWeight: 700
          })
        ]),
        POST_SIZE,
        [
          letterStack('VOICE', {
            fontFamily: f.display,
            fontSize: s(3.2),
            color: C.red,
            fontWeight: 700,
            position: 'absolute',
            right: C.pad,
            top: s(14)
          })
        ]
      );
    }

    case 'confronto': {
      const p = DEMO.confronto;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, C.bg),
          gap(4),
          el(
            { display: 'flex', position: 'relative', width: '100%', flexGrow: 1 },
            [
              col({ gap: s(2.4), position: 'relative', width: '100%' }, [
                titolo(`${p.a.label}\n${p.a.items.join('\n')}`, 4.6, C.soft),
                gap(3),
                titolo(`${p.b.label}\n${p.b.items.join('\n')}`, 4.6, C.ink)
              ]),
              el({ display: 'flex', position: 'absolute', right: s(2), top: s(8) }, [bigX(s(42))])
            ]
          ),
          gap(2),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ])
      );
    }

    case 'fotoparziale': {
      const p = DEMO.fotoparziale;
      return canvas(
        C.red,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.bg, C.red),
          titolo(p.headline, 8, '#FFFFFF'),
          grow(1),
          row({ alignItems: 'center', gap: s(3) }, [
            el({ display: 'flex', width: s(40), height: s(50), overflow: 'hidden' }, [img(photos.b, s(40), s(50))]),
            col({ flexGrow: 1, gap: s(2) }, [
              el({ display: 'flex', fontSize: s(2.8), color: 'rgba(255,255,255,0.75)' }, p.sub),
              arrow('#FFFFFF', s(5))
            ])
          ]),
          grow(0.4)
        ]),
        POST_SIZE,
        [
          overflowTitle('BEFORE', {
            fontFamily: f.display,
            fontSize: s(16),
            color: C.bg,
            fontWeight: 700,
            opacity: 0.25
          }, 'right')
        ]
      );
    }

    case 'numero': {
      const p = DEMO.numero;
      return canvas(
        C.red,
        row(
          { padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body },
          [
            col({ justifyContent: 'center' }, [
              letterStack('NO', { fontFamily: f.display, fontSize: s(4), color: C.bg, fontWeight: 700 })
            ]),
            col({ flexGrow: 1, paddingLeft: s(3) }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }, p.kicker),
              grow(1),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(40),
                  fontWeight: 700,
                  color: '#FFFFFF',
                  lineHeight: 0.85,
                  letterSpacing: s(40) * -0.05
                },
                'NO'
              ),
              gap(2),
              titolo(p.stat, 12, C.ink),
              gap(2),
              titolo(p.label, 3.8, '#FFFFFF'),
              grow(0.4)
            ])
          ]
        )
      );
    }

    case 'cta': {
      const p = DEMO.cta;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          grow(1),
          titolo(p.headline, 10),
          gap(2),
          row({ alignItems: 'center', gap: s(2) }, [
            el({ display: 'flex', fontSize: s(3.2), color: C.soft }, p.sub.split(' ').slice(0, 3).join(' ')),
            el({ display: 'flex', fontSize: s(3.2), fontWeight: 700, color: C.red }, p.sub.split(' ').slice(3).join(' ') || 'now'),
            arrow(C.red, s(4))
          ]),
          gap(5),
          col(
            { gap: s(2.4) },
            p.actions.map((a) =>
              el({ display: 'flex', fontSize: s(3.4), fontWeight: 700, color: C.ink, textTransform: 'uppercase' }, `→  ${a}`)
            )
          ),
          grow(0.5),
          el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: C.red }, BRAND_SLOT)
        ]),
        POST_SIZE,
        [
          overflowTitle('ACT', {
            fontFamily: f.display,
            fontSize: s(22),
            color: C.red,
            fontWeight: 700,
            opacity: 0.2
          }, 'top')
        ]
      );
    }

    case 'lista': {
      const p = DEMO.lista;
      return canvas(
        C.bg,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(p.kicker, C.red, C.bg),
          gap(4),
          el(
            { display: 'flex', position: 'relative', width: '100%', flexGrow: 1 },
            [
              col(
                { gap: s(3), width: '100%' },
                p.items.map((it, i) =>
                  row({ gap: s(3), alignItems: 'baseline' }, [
                    el({ display: 'flex', fontSize: s(4), fontWeight: 700, color: C.ink }, `0${i + 1}`),
                    el({ display: 'flex', fontSize: s(3.6), fontWeight: 600, color: C.ink }, it)
                  ])
                )
              ),
              el({ display: 'flex', position: 'absolute', right: 0, top: s(4) }, [bigX(s(48))])
            ]
          ),
          gap(2),
          el({ display: 'flex', fontSize: s(2.4), color: C.soft }, SITE_SLOT)
        ])
      );
    }

    case 'cover':
    default: {
      const p = DEMO.cover;
      return canvas(
        C.red,
        col({ padding: C.pad, width: PRESET_WIDTH, height: PRESET_HEIGHT, fontFamily: f.body }, [
          tape(BRAND_SLOT, C.bg, C.red),
          grow(1),
          el(
            {
              display: 'flex',
              fontFamily: f.display,
              fontSize: s(36),
              fontWeight: 700,
              color: '#FFFFFF',
              lineHeight: 0.85,
              letterSpacing: s(36) * -0.04
            },
            'NO'
          ),
          gap(2),
          titolo(p.headline, 7.4, C.ink),
          gap(2.4),
          el({ display: 'flex', fontSize: s(3), color: 'rgba(10,10,10,0.75)' }, p.sub),
          grow(0.4),
          row({ justifyContent: 'space-between' }, [
            arrow(C.ink, s(5)),
            el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: C.ink }, SITE_SLOT)
          ])
        ]),
        POST_SIZE,
        [
          overflowTitle('NO', {
            fontFamily: f.display,
            fontSize: s(24),
            color: C.bg,
            fontWeight: 700,
            opacity: 0.2
          }, 'bottom')
        ]
      );
    }
  }
}

export const protesta: StylePreset = {
  slug: 'protesta',
  name: 'Protesta',
  thesis: {
    it: 'Rosso da campagna, NO gigante, liste barrate da una X. Manifesto di strada, non template soft.',
    en: 'Campaign red, a giant NO, lists crossed by an X. A street manifesto, not a soft template.'
  },
  suits: {
    it: 'Attivismo, civic brand, nonprofit, cause-driven, chi deve provocare.',
    en: 'Activism, civic brands, nonprofits, cause-driven — anyone who needs to provoke.'
  },
  fonts: { display: 'Archivo', body: 'Archivo', mono: 'Archivo' },
  spec: [
    { label: { it: 'fondo', en: 'ground' }, value: { it: 'rosso / crema / nero', en: 'red / cream / black' } },
    { label: { it: 'titolo', en: 'display' }, value: { it: 'caps da manifesto', en: 'manifesto caps' } },
    { label: { it: 'firma', en: 'signature' }, value: { it: 'NO + X', en: 'NO + X' } },
    { label: { it: 'lista', en: 'list' }, value: { it: 'barrata dalla X', en: 'crossed by an X' } },
    { label: { it: 'CTA', en: 'CTA' }, value: { it: 'parola in rosso', en: 'one word in red' } },
    { label: { it: 'freccia', en: 'arrow' }, value: { it: '→ grezza', en: 'raw →' } }
  ],
  build,
  stories: makeStories({ bg: C.bg, ink: C.ink, accent: C.red, soft: C.soft }),
  reel: {
    bg: C.bg,
    ink: C.ink,
    accent: C.red,
    muted: C.soft,
    displayFont: 'Archivo',
    bodyFont: 'Archivo'
  }
};
