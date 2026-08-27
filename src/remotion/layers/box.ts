import type { CSSProperties } from 'react';
import type { Layer } from '$lib/design/schema';

export function layerBoxStyle(layer: Layer, canvasW: number, canvasH: number): CSSProperties {
  return {
    position: 'absolute',
    left: layer.x * canvasW,
    top: layer.y * canvasH,
    width: layer.w * canvasW,
    height: layer.h * canvasH,
    transform: layer.rotate ? `rotate(${layer.rotate}deg)` : undefined,
    opacity: layer.opacity,
    overflow: 'hidden',
    pointerEvents: layer.locked ? 'none' : undefined
  };
}
