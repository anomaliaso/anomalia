import React from 'react';
import { Img } from 'remotion';
import type { Layer } from '$lib/design/schema';
import { layerBoxStyle } from './box';

type ImageLayer = Extract<Layer, { type: 'image' }>;

export const ImageLayerView: React.FC<{
  layer: ImageLayer;
  canvasW: number;
  canvasH: number;
}> = ({ layer, canvasW, canvasH }) => {
  const filter = layer.filters
    ? [
        layer.filters.brightness != null ? `brightness(${layer.filters.brightness})` : null,
        layer.filters.contrast != null ? `contrast(${layer.filters.contrast})` : null,
        layer.filters.saturate != null ? `saturate(${layer.filters.saturate})` : null,
        layer.filters.blur != null ? `blur(${layer.filters.blur}px)` : null
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  return (
    <div style={layerBoxStyle(layer, canvasW, canvasH)}>
      <Img
        src={layer.src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: layer.fit ?? 'cover',
          filter: filter || undefined
        }}
      />
    </div>
  );
};
