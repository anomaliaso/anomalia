import React from 'react';
import type { Layer } from '$lib/design/schema';
import { layerBoxStyle } from './box';

type GradientLayer = Extract<Layer, { type: 'gradient' }>;

export const GradientLayerView: React.FC<{
  layer: GradientLayer;
  canvasW: number;
  canvasH: number;
}> = ({ layer, canvasW, canvasH }) => (
  <div
    style={{
      ...layerBoxStyle(layer, canvasW, canvasH),
      background: `linear-gradient(${layer.angle}deg, ${layer.from}, ${layer.to})`
    }}
  />
);
