import { canvasSize, type Design } from '$lib/design/schema';

export type DesignRenderCapability =
  | { ok: true; warn?: string }
  | { ok: false; reason: string };

/**
 * Gate for the design editor / lab. Still PNG export needs HtmlInCanvas;
 * video codecs are irrelevant for Fase 1 stills.
 */
export async function checkDesignRenderCapability(): Promise<DesignRenderCapability> {
  const { HtmlInCanvas } = await import('remotion');
  if (typeof HtmlInCanvas?.isSupported === 'function' && !HtmlInCanvas.isSupported()) {
    return {
      ok: false,
      reason: 'This browser cannot render Remotion stills (HtmlInCanvas unsupported). Use Chrome.'
    };
  }
  return { ok: true };
}

export type RenderDesignSlideOpts = {
  scale?: number;
};

/** Browser-only still render. Never import this from server code. */
export async function renderDesignSlide(
  doc: Design,
  slide = 0,
  opts?: RenderDesignSlideOpts
): Promise<Blob> {
  const [{ renderStillOnWeb }, { DesignComposition }] = await Promise.all([
    import('@remotion/web-renderer'),
    import('../../remotion/Design')
  ]);
  const size = canvasSize(doc.aspect);
  const still = await renderStillOnWeb({
    composition: {
      id: 'Design',
      component: DesignComposition,
      width: size.width,
      height: size.height,
      fps: 30,
      durationInFrames: 1,
      defaultProps: { doc, slide }
    },
    frame: 0,
    scale: opts?.scale ?? 2,
    inputProps: { doc, slide },
    delayRenderTimeoutInMilliseconds: 20_000
  });
  return still.blob({ format: 'png' });
}

/**
 * Explicit font check: loaded face must differ in metrics from the system stack.
 * A PNG that "looks fine" with a fallback is indistinguishable without measuring.
 */
export async function verifyFontMetrics(
  fontFamily: string,
  sample = 'Hamburgefonstiv'
): Promise<{
  loaded: boolean;
  differsFromSystem: boolean;
  brandWidth: number;
  systemWidth: number;
}> {
  if (typeof document === 'undefined') {
    return { loaded: false, differsFromSystem: false, brandWidth: 0, systemWidth: 0 };
  }
  const face = `600 72px ${fontFamily.includes(',') ? fontFamily : `"${fontFamily}"`}`;
  try {
    await document.fonts.load(face);
  } catch {
    /* ignore */
  }
  const loaded = document.fonts.check(face);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { loaded, differsFromSystem: false, brandWidth: 0, systemWidth: 0 };
  }
  ctx.font = face;
  const brandWidth = ctx.measureText(sample).width;
  ctx.font = '600 72px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const systemWidth = ctx.measureText(sample).width;
  return {
    loaded,
    differsFromSystem: Math.abs(brandWidth - systemWidth) > 0.5,
    brandWidth,
    systemWidth
  };
}
