import React, { useEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import { computeAutoFitSize, type Layer } from '$lib/design/schema';
import { resolveFontFamily } from '../fonts';
import { layerBoxStyle } from './box';

type TextLayer = Extract<Layer, { type: 'text' }>;

function measureWrappedText(
  text: string,
  fontFamily: string,
  weight: number,
  size: number,
  lineHeight: number,
  letterSpacing: number,
  maxWidth: number,
  maxLines?: number
): { width: number; height: number } {
  if (typeof document === 'undefined') {
    return { width: text.length * size * 0.55, height: size * lineHeight };
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: text.length * size * 0.55, height: size * lineHeight };
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const w = ctx.measureText(next).width + Math.max(0, next.length - 1) * letterSpacing;
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const used = maxLines != null ? lines.slice(0, maxLines) : lines;
  const width = Math.min(
    maxWidth,
    Math.max(
      0,
      ...used.map((line) => ctx.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing)
    )
  );
  return { width, height: used.length * size * lineHeight };
}

export const TextLayerView: React.FC<{
  layer: TextLayer;
  canvasW: number;
  canvasH: number;
}> = ({ layer, canvasW, canvasH }) => {
  const boxW = layer.w * canvasW;
  const boxH = layer.h * canvasH;
  const [fontFamily, setFontFamily] = useState(layer.font);
  const [size, setSize] = useState(layer.size);
  const [ready, setReady] = useState(false);

  // delayRender must be called DURING RENDER, not from inside the effect, or the renderer may
  // already have snapshotted the frame. Later effect runs (only possible while editing in the
  // Player) take a fresh handle each, so cleanup can release its own without touching another's.
  const [initialHandle] = useState(() => delayRender(`text-layer:${layer.id}`));
  const firstRun = useRef(true);

  useEffect(() => {
    const handle = firstRun.current ? initialHandle : delayRender(`text-layer:${layer.id}`);
    firstRun.current = false;
    let cancelled = false;
    // Exactly-once release. The old code returned early on `cancelled` without continuing the
    // handle: on unmount mid-font-load nothing ever settled it and the render sat until the 20s
    // delayRender timeout, then failed.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      continueRender(handle);
    };
    const weight = layer.weight ?? 600;
    const lineHeight = layer.lineHeight ?? 1.15;
    const letterSpacing = layer.letterSpacing ?? 0;
    const autoFit = layer.autoFit !== false;
    (async () => {
      const resolved = await resolveFontFamily(layer.font);
      if (cancelled) return; // cleanup already ran and settled the handle
      const family = resolved.fontFamily;
      setFontFamily(family);
      const fitted = autoFit
        ? computeAutoFitSize({
            initialSize: layer.size,
            boxW,
            boxH,
            measure: (s) =>
              measureWrappedText(
                layer.text,
                family,
                weight,
                s,
                lineHeight,
                letterSpacing,
                boxW,
                layer.maxLines
              )
          })
        : layer.size;
      setSize(fitted);
      setReady(true);
      settle();
    })().catch((err) => {
      settled = true; // cancelRender terminates the render; never continue on top of it
      cancelRender(err);
    });
    return () => {
      cancelled = true;
      settle();
    };
  }, [
    layer.font,
    layer.text,
    layer.size,
    layer.weight,
    layer.lineHeight,
    layer.letterSpacing,
    layer.autoFit,
    layer.maxLines,
    layer.id,
    boxW,
    boxH,
    initialHandle
  ]);

  if (!ready) return null;

  const weight = layer.weight ?? 600;
  const lineHeight = layer.lineHeight ?? 1.15;
  const letterSpacing = layer.letterSpacing ?? 0;

  return (
    <div
      style={{
        ...layerBoxStyle(layer, canvasW, canvasH),
        display: 'flex',
        alignItems: 'center',
        justifyContent:
          layer.align === 'center' ? 'center' : layer.align === 'right' ? 'flex-end' : 'flex-start',
        fontFamily,
        fontWeight: weight,
        fontSize: size,
        color: layer.color,
        textAlign: layer.align ?? 'left',
        lineHeight,
        letterSpacing,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}
    >
      {layer.text}
    </div>
  );
};
