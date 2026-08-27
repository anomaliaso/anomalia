import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Player } from '@remotion/player';
import { DesignComposition } from './Design';
import { canvasSize, type Design } from '$lib/design/schema';

export type MountPlayerHandle = {
  root: Root;
  update: (doc: Design, slide?: number) => void;
  unmount: () => void;
};

/** Mount Remotion <Player> into a DOM node. Caller must unmount on destroy. */
export function mountDesignPlayer(
  el: HTMLElement,
  doc: Design,
  slide = 0
): MountPlayerHandle {
  const root = createRoot(el);

  const render = (next: Design, nextSlide = 0) => {
    const size = canvasSize(next.aspect);
    // Player generics expect Record<string, unknown>; DesignComposition props are narrower.
    root.render(
      React.createElement(Player, {
        component: DesignComposition as unknown as React.ComponentType<Record<string, unknown>>,
        inputProps: { doc: next, slide: nextSlide },
        durationInFrames: 1,
        fps: 30,
        compositionWidth: size.width,
        compositionHeight: size.height,
        style: { width: '100%', height: 'auto', aspectRatio: `${size.width} / ${size.height}` },
        controls: false
      })
    );
  };

  render(doc, slide);

  return {
    root,
    update: render,
    unmount: () => root.unmount()
  };
}
