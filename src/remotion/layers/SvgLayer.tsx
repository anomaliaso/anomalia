import React from 'react';
import type { Layer } from '$lib/design/schema';
import { layerBoxStyle } from './box';

type SvgLayer = Extract<Layer, { type: 'svg' }>;

export const SvgLayerView: React.FC<{
  layer: SvgLayer;
  canvasW: number;
  canvasH: number;
}> = ({ layer, canvasW, canvasH }) => (
  <div
    style={layerBoxStyle(layer, canvasW, canvasH)}
    dangerouslySetInnerHTML={{ __html: layer.svg }}
  />
);
