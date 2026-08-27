import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Player } from '@remotion/player';
import { resolveFontFamily } from './fonts';
import {
  STYLE_REEL_DURATION,
  STYLE_REEL_FPS,
  StyleReel,
  styleReelSize,
  type StyleReelProps
} from './StyleReel';

export type MountStyleReelHandle = {
  unmount: () => void;
};

export type MountStyleReelOptions = {
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  /** Fill a sized parent (grid thumbs) instead of intrinsic aspect box. */
  fill?: boolean;
};

async function withResolvedFonts(props: StyleReelProps): Promise<StyleReelProps> {
  const [display, body] = await Promise.all([
    resolveFontFamily(props.displayFont),
    resolveFontFamily(props.bodyFont)
  ]);
  return {
    ...props,
    displayFont: display.fontFamily,
    bodyFont: body.fontFamily
  };
}

/** Mount an animated style reel Player into a DOM node. */
export async function mountStyleReelPlayer(
  el: HTMLElement,
  props: StyleReelProps,
  opts: MountStyleReelOptions = {}
): Promise<MountStyleReelHandle> {
  const resolved = await withResolvedFonts(props);
  const root: Root = createRoot(el);
  const size = styleReelSize(resolved.aspect);
  const controls = opts.controls ?? true;
  const fill = opts.fill ?? false;

  root.render(
    React.createElement(Player, {
      component: StyleReel as unknown as React.ComponentType<Record<string, unknown>>,
      inputProps: resolved as unknown as Record<string, unknown>,
      durationInFrames: STYLE_REEL_DURATION,
      fps: STYLE_REEL_FPS,
      compositionWidth: size.width,
      compositionHeight: size.height,
      style: fill
        ? { width: '100%', height: '100%' }
        : { width: '100%', height: 'auto', aspectRatio: `${size.width} / ${size.height}` },
      controls,
      loop: opts.loop ?? true,
      autoPlay: opts.autoPlay ?? true,
      clickToPlay: controls,
      doubleClickToFullscreen: false,
      spaceKeyToPlayOrPause: controls,
      moveToBeginningWhenEnded: true
    })
  );

  return { unmount: () => root.unmount() };
}

export async function renderStyleReelBlob(props: StyleReelProps): Promise<Blob> {
  const { renderMediaOnWeb } = await import('@remotion/web-renderer');
  const resolved = await withResolvedFonts(props);
  const size = styleReelSize(resolved.aspect);
  const result = await renderMediaOnWeb({
    composition: {
      id: 'StyleReel',
      component: StyleReel,
      width: size.width,
      height: size.height,
      fps: STYLE_REEL_FPS,
      durationInFrames: STYLE_REEL_DURATION,
      defaultProps: resolved
    },
    inputProps: resolved,
    delayRenderTimeoutInMilliseconds: 60_000
  });
  return result.getBlob();
}

export function styleReelPropsFromPreset(
  reel: {
    bg: string;
    ink: string;
    accent: string;
    muted: string;
    displayFont: string;
    bodyFont: string;
  },
  aspect: '3:4' | '9:16',
  opts?: { headline?: string; sub?: string; handle?: string; brand?: string }
): StyleReelProps {
  return {
    aspect,
    bg: reel.bg,
    ink: reel.ink,
    accent: reel.accent,
    muted: reel.muted,
    displayFont: reel.displayFont,
    bodyFont: reel.bodyFont,
    headline: opts?.headline ?? 'Most content\nnever gets\nread',
    sub: opts?.sub ?? 'And almost always the reason is not the writing.',
    handle: opts?.handle ?? '@yourbrand',
    brand: opts?.brand ?? 'Your brand'
  };
}
