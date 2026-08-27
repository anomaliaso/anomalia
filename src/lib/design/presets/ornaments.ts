/**
 * Shared graphic ornaments for style presets.
 *
 * Palette and typeface stay constant across a preset's slides; these primitives are what CHANGE
 * from slide to slide (dot grid on cover, barcode on numero, overflow title on cta — never the
 * same set twice in a row). Plain satori trees: no transform:rotate (unreliable) — vertical type
 * is a letter stack.
 */
import {
  PRESET_HEIGHT,
  PRESET_WIDTH,
  STORY_HEIGHT,
  STORY_WIDTH,
  col,
  el,
  gap,
  lines,
  row,
  s,
  type El
} from './shared';

type Style = Record<string, unknown>;

export type CanvasSize = { width: number; height: number };

export const POST_SIZE: CanvasSize = { width: PRESET_WIDTH, height: PRESET_HEIGHT };
export const STORY_SIZE: CanvasSize = { width: STORY_WIDTH, height: STORY_HEIGHT };

/** Full canvas wrapper — relative + overflow hidden so absolute ornaments / overflow titles clip. */
export const canvas = (
  bg: string,
  children: El | El[],
  size: CanvasSize = POST_SIZE,
  extras: El[] = []
): El =>
  el(
    {
      display: 'flex',
      position: 'relative',
      width: size.width,
      height: size.height,
      backgroundColor: bg,
      overflow: 'hidden'
    },
    [...extras, ...(Array.isArray(children) ? children : [children])]
  );

/** Scale helper relative to an arbitrary canvas width (stories use 1080 too, so s() still works). */
export const sx = (pct: number, width = PRESET_WIDTH) => Math.round((width * pct) / 100);

export const dotGrid = (
  cols: number,
  rows: number,
  color: string,
  opts: { gap?: number; size?: number; absolute?: Style } = {}
): El => {
  const cellGap = opts.gap ?? s(1.6);
  const dot = opts.size ?? s(1.1);
  return el(
    {
      display: 'flex',
      flexDirection: 'column',
      gap: cellGap,
      ...(opts.absolute ?? {})
    },
    Array.from({ length: rows }, () =>
      row(
        { gap: cellGap },
        Array.from({ length: cols }, () =>
          el(
            {
              display: 'flex',
              width: dot,
              height: dot,
              borderRadius: dot,
              backgroundColor: color,
              flexShrink: 0
            },
            ''
          )
        )
      )
    )
  );
};

export const barcode = (w: number, h: number, color = '#FFFFFF'): El =>
  row(
    { width: w, height: h, gap: 2, alignItems: 'stretch', overflow: 'hidden' },
    [3, 1, 2, 1, 4, 1, 1, 3, 1, 2, 1, 5, 1, 2, 1, 3, 1, 1, 4, 1, 2, 1, 3].map((bw) =>
      el({ display: 'flex', width: bw * 2, backgroundColor: color, flexShrink: 0 }, '')
    )
  );

/** Vertical word without rotate — one glyph per line. */
export const letterStack = (word: string, style: Style = {}): El =>
  col(
    { gap: 0, alignItems: 'center', ...style },
    word.split('').map((ch) =>
      el(
        {
          display: 'flex',
          fontSize: style.fontSize ?? s(3.2),
          fontWeight: style.fontWeight ?? 700,
          fontFamily: style.fontFamily,
          color: style.color ?? '#FFFFFF',
          lineHeight: 1,
          textTransform: 'uppercase',
          ...(typeof style.letterSpacing === 'number' ? { letterSpacing: style.letterSpacing } : {})
        },
        ch === ' ' ? '·' : ch
      )
    )
  );

export const chevronStack = (n: number, color: string, fontSize = s(4)): El =>
  col(
    { gap: 0 },
    Array.from({ length: n }, () =>
      el({ display: 'flex', fontSize, fontWeight: 700, color, lineHeight: 0.85 }, '›')
    )
  );

export const arrow = (color: string, fontSize = s(5)): El =>
  el({ display: 'flex', fontSize, fontWeight: 700, color, lineHeight: 1 }, '→');

/**
 * Title that intentionally bleeds off the canvas. Place inside a `canvas()` so overflow clips.
 * `edge` chooses which side hangs outside.
 */
export const overflowTitle = (
  text: string,
  style: Style,
  edge: 'top' | 'bottom' | 'left' | 'right' = 'right'
): El => {
  const shift =
    edge === 'top'
      ? { top: -s(4), left: s(7) }
      : edge === 'bottom'
        ? { bottom: -s(3), left: s(7) }
        : edge === 'left'
          ? { left: -s(6), top: s(20) }
          : { right: -s(8), top: s(18) };
  return col(
    {
      position: 'absolute',
      ...shift,
      color: style.color ?? '#FFFFFF',
      maxWidth: s(95)
    },
    lines(text, {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize ?? s(12),
      fontWeight: style.fontWeight ?? 700,
      letterSpacing: style.letterSpacing ?? s(12) * -0.04,
      lineHeight: style.lineHeight ?? 0.9,
      textTransform: (style.textTransform as string) ?? 'uppercase'
    })
  );
};

export const tape = (text: string, bg: string, fg: string, extra: Style = {}): El =>
  el(
    {
      display: 'flex',
      alignSelf: 'flex-start',
      backgroundColor: bg,
      color: fg,
      padding: `${s(1.2)}px ${s(2.6)}px`,
      fontSize: s(2.2),
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: s(2.2) * 0.08,
      ...extra
    },
    text
  );

/** L-shaped corner brackets (two bars). */
export const brackets = (size: number, color: string, thick = 3): El =>
  el(
    { display: 'flex', position: 'relative', width: size, height: size },
    [
      el({ display: 'flex', position: 'absolute', top: 0, left: 0, width: size * 0.35, height: thick, backgroundColor: color }, ''),
      el({ display: 'flex', position: 'absolute', top: 0, left: 0, width: thick, height: size * 0.35, backgroundColor: color }, ''),
      el({ display: 'flex', position: 'absolute', bottom: 0, right: 0, width: size * 0.35, height: thick, backgroundColor: color }, ''),
      el({ display: 'flex', position: 'absolute', bottom: 0, right: 0, width: thick, height: size * 0.35, backgroundColor: color }, '')
    ]
  );

export const starMark = (color: string, fontSize = s(8)): El =>
  el({ display: 'flex', fontSize, fontWeight: 700, color, lineHeight: 1 }, '✦');

export const plusMark = (color: string, fontSize = s(8)): El =>
  el({ display: 'flex', fontSize, fontWeight: 700, color, lineHeight: 1 }, '+');

export const repeatPhrase = (phrase: string, n: number, style: Style): El =>
  col(
    { gap: style.gap ?? 0 },
    Array.from({ length: n }, () =>
      el(
        {
          display: 'flex',
          fontFamily: style.fontFamily,
          fontSize: style.fontSize ?? s(3.6),
          fontWeight: style.fontWeight ?? 700,
          color: style.color ?? '#FFFFFF',
          textTransform: 'uppercase',
          letterSpacing: style.letterSpacing ?? s(3.6) * -0.02,
          lineHeight: style.lineHeight ?? 1.05
        },
        phrase
      )
    )
  );

/** Story-sized padding helper (9:16 is taller — keep side pad similar, use more vertical air). */
export const storyPad = () => s(8);
