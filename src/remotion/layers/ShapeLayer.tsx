import React from 'react';
import type { Layer } from '$lib/design/schema';
import { layerBoxStyle } from './box';

type ShapeLayer = Extract<Layer, { type: 'shape' }>;

export const ShapeLayerView: React.FC<{
  layer: ShapeLayer;
  canvasW: number;
  canvasH: number;
}> = ({ layer, canvasW, canvasH }) => {
  const box = layerBoxStyle(layer, canvasW, canvasH);
  const w = layer.w * canvasW;
  const h = layer.h * canvasH;

  if (layer.shape === 'line') {
    return (
      <div style={box}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            width: '100%',
            height: Math.max(1, layer.strokeWidth ?? 2),
            background: layer.stroke || layer.fill || '#000',
            transform: 'translateY(-50%)'
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...box,
        background: layer.fill,
        border:
          (layer.strokeWidth ?? 0) > 0
            ? `${layer.strokeWidth}px solid ${layer.stroke || '#000'}`
            : undefined,
        borderRadius: layer.shape === 'ellipse' ? '50%' : (layer.radius ?? 0),
        width: w,
        height: h
      }}
    />
  );
};
