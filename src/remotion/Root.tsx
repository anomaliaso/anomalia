import React from 'react';
import { Composition } from 'remotion';
import { DesignComposition, type DesignCompositionProps } from './Design';
import {
  MOTION_AD_DURATION,
  MOTION_AD_FPS,
  MOTION_AD_SIZE,
  MotionAd,
  defaultMotionAdProps,
  type MotionAdProps
} from './MotionAd';
import { canvasSize, parseDesign } from '$lib/design/schema';

const EMPTY_DOC = parseDesign({
  v: 1,
  aspect: '4:5',
  slides: [{ background: '#ffffff', layers: [] }]
});

/** Remotion Studio root — not required for Player/web-renderer, but keeps the tree discoverable. */
export const RemotionRoot: React.FC = () => {
  const size = canvasSize('4:5');
  return (
    <>
      <Composition
        id="Design"
        component={DesignComposition}
        durationInFrames={1}
        fps={30}
        width={size.width}
        height={size.height}
        defaultProps={{ doc: EMPTY_DOC, slide: 0 } satisfies DesignCompositionProps}
        calculateMetadata={({ props }) => {
          const dim = canvasSize(props.doc.aspect);
          return { width: dim.width, height: dim.height, durationInFrames: 1, fps: 30 };
        }}
      />
      <Composition
        id="MotionAd"
        component={MotionAd}
        durationInFrames={MOTION_AD_DURATION}
        fps={MOTION_AD_FPS}
        width={MOTION_AD_SIZE.width}
        height={MOTION_AD_SIZE.height}
        defaultProps={defaultMotionAdProps() satisfies MotionAdProps}
      />
    </>
  );
};
