import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Design } from '$lib/design/schema';
import { canvasSize } from '$lib/design/schema';
import { ImageLayerView } from './layers/ImageLayer';
import { TextLayerView } from './layers/TextLayer';
import { ShapeLayerView } from './layers/ShapeLayer';
import { SvgLayerView } from './layers/SvgLayer';
import { GradientLayerView } from './layers/GradientLayer';

export type DesignCompositionProps = {
  doc: Design;
  slide?: number;
};

export const DesignComposition: React.FC<DesignCompositionProps> = ({ doc, slide = 0 }) => {
  const { width, height } = canvasSize(doc.aspect);
  const s = doc.slides[Math.min(Math.max(0, slide), doc.slides.length - 1)];

  return (
    <AbsoluteFill style={{ backgroundColor: s.background, width, height }}>
      {s.layers.map((layer) => {
        switch (layer.type) {
          case 'image':
            return (
              <ImageLayerView key={layer.id} layer={layer} canvasW={width} canvasH={height} />
            );
          case 'text':
            return <TextLayerView key={layer.id} layer={layer} canvasW={width} canvasH={height} />;
          case 'shape':
            return (
              <ShapeLayerView key={layer.id} layer={layer} canvasW={width} canvasH={height} />
            );
          case 'svg':
            return <SvgLayerView key={layer.id} layer={layer} canvasW={width} canvasH={height} />;
          case 'gradient':
            return (
              <GradientLayerView key={layer.id} layer={layer} canvasW={width} canvasH={height} />
            );
          default:
            return null;
        }
      })}
    </AbsoluteFill>
  );
};
