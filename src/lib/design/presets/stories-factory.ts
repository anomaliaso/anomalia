/**
 * Default 9:16 story trio for a style. Same palette/voice; three distinct compositions
 * (claim+ornament / photo+type / invert+stat). Presets can replace any variant.
 */
import {
  BRAND_SLOT,
  DEMO,
  SITE_SLOT,
  STORY_HEIGHT,
  STORY_WIDTH,
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
  type PresetBuild,
  type PresetFonts,
  type PresetPhotos,
  type StoryVariant
} from './shared';
import {
  STORY_SIZE,
  arrow,
  barcode,
  canvas,
  dotGrid,
  letterStack,
  overflowTitle,
  starMark,
  tape
} from './ornaments';

export type StoryPalette = {
  bg: string;
  ink: string;
  accent: string;
  soft: string;
};

const pad = s(8);

function titolo(text: string, f: PresetFonts, pct: number, color: string): El {
  return col(
    { color },
    lines(text, {
      fontFamily: f.display,
      fontSize: s(pct),
      fontWeight: 700,
      letterSpacing: s(pct) * -0.035,
      lineHeight: 0.95
    })
  );
}

export function makeStories(p: StoryPalette): Record<StoryVariant, PresetBuild> {
  return {
    /** A — tall claim with overflow + dots */
    a: (f) => {
      const copy = DEMO.cover;
      return canvas(
        p.bg,
        col(
          {
            position: 'relative',
            width: STORY_WIDTH,
            height: STORY_HEIGHT,
            padding: pad,
            fontFamily: f.body
          },
          [
            row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
              tape(copy.kicker, p.accent, p.bg),
              dotGrid(4, 4, p.accent)
            ]),
            grow(1),
            titolo(copy.headline, f, 11, p.ink),
            gap(3),
            el({ display: 'flex', fontSize: s(3.2), lineHeight: 1.4, color: p.soft, maxWidth: s(70) }, copy.sub),
            grow(0.6),
            row({ justifyContent: 'space-between', alignItems: 'center' }, [
              el({ display: 'flex', fontSize: s(2.6), fontWeight: 700, color: p.ink }, BRAND_SLOT),
              arrow(p.accent, s(5))
            ])
          ]
        ),
        STORY_SIZE,
        [
          overflowTitle(copy.headline.split('\n')[0] ?? 'NOW', {
            fontFamily: f.display,
            fontSize: s(22),
            color: p.accent,
            fontWeight: 700
          }, 'bottom')
        ]
      );
    },

    /** B — full-bleed photo, type low */
    b: (f, photos) => {
      const copy = DEMO.fotopiena;
      return fullBleed(
        photos.a,
        'linear-gradient(180deg, rgba(0,0,0,0.15) 20%, rgba(0,0,0,0.82) 100%)',
        col(
          {
            width: STORY_WIDTH,
            height: STORY_HEIGHT,
            padding: pad,
            fontFamily: f.body
          },
          [
            tape(copy.kicker, '#FFFFFF', p.bg),
            grow(1),
            titolo(copy.headline, f, 10, '#FFFFFF'),
            gap(2.4),
            el({ display: 'flex', fontSize: s(3), color: 'rgba(255,255,255,0.75)' }, copy.sub),
            gap(4),
            barcode(s(36), s(5), '#FFFFFF'),
            gap(3),
            el({ display: 'flex', fontSize: s(2.5), color: 'rgba(255,255,255,0.6)' }, SITE_SLOT)
          ]
        ),
        p.bg,
        STORY_SIZE
      );
    },

    /** C — inverted accent field, vertical stack + stat */
    c: (f, photos) => {
      const copy = DEMO.numero;
      return canvas(
        p.accent,
        row(
          {
            width: STORY_WIDTH,
            height: STORY_HEIGHT,
            padding: pad,
            fontFamily: f.body
          },
          [
            col({ justifyContent: 'center', paddingRight: s(3) }, [
              letterStack('STORY', { fontFamily: f.display, fontSize: s(4), color: p.bg, fontWeight: 700 })
            ]),
            col({ flexGrow: 1 }, [
              el({ display: 'flex', fontSize: s(2.4), fontWeight: 700, color: p.bg, textTransform: 'uppercase' }, copy.kicker),
              grow(1),
              el(
                {
                  display: 'flex',
                  width: s(42),
                  height: s(42),
                  borderRadius: s(42),
                  overflow: 'hidden',
                  border: `4px solid ${p.bg}`,
                  alignSelf: 'center'
                },
                [img(photos.b, s(42), s(42))]
              ),
              gap(5),
              el(
                {
                  display: 'flex',
                  fontFamily: f.display,
                  fontSize: s(28),
                  fontWeight: 700,
                  color: p.bg,
                  lineHeight: 0.85,
                  letterSpacing: s(28) * -0.05
                },
                copy.stat
              ),
              gap(2.4),
              titolo(copy.label, f, 4, p.bg),
              grow(1),
              row({ justifyContent: 'space-between', alignItems: 'center' }, [
                starMark(p.bg, s(6)),
                el({ display: 'flex', fontSize: s(2.5), fontWeight: 700, color: p.bg }, BRAND_SLOT)
              ])
            ])
          ]
        ),
        STORY_SIZE
      );
    }
  };
}
