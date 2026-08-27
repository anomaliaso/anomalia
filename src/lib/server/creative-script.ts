/**
 * The post's "script" — spoken dialogue and/or on-screen copy — so QC can judge writing
 * separately from generation craft, and later reviews can retrieve what was said vs what scored.
 */
import { isVideoUrl } from '$lib/content-formats';
import { textFromGraphicSource } from '$lib/design/graphic-source';

export type CreativeKind = 'video' | 'image' | 'carousel' | 'graphic';

export type CreativeScript = {
  kind: CreativeKind;
  /** Voiceover / talking-head line. Empty for silent stills. */
  spoken: string;
  /** Headlines, kickers, list items, overlay labels — what a muted viewer can READ. */
  onScreen: string;
  caption: string;
};

export function inferCreativeKind(input: {
  contentType?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: unknown;
  hasGraphic?: boolean;
}): CreativeKind {
  const ct = String(input.contentType ?? '');
  const urls = Array.isArray(input.mediaUrls)
    ? input.mediaUrls.filter((u) => typeof u === 'string' && u.trim())
    : [];
  if (input.hasGraphic || ct === 'generated_graphic') return 'graphic';
  if (ct.includes('video') || isVideoUrl(input.mediaUrl)) return 'video';
  if (urls.length > 1 || ct.includes('carousel')) return 'carousel';
  return 'image';
}

/** Pull readable strings out of a typographic graphic spec, HTML/TSX source, or any nested block JSON. */
export function onScreenFromGraphic(spec: unknown): string[] {
  if (typeof spec === 'string') return textFromGraphicSource(spec);
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    for (const key of ['text', 'value', 'label', 'question', 'missing', 'attribution', 'brand', 'note'] as const) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
    if (Array.isArray(o.items)) {
      for (const it of o.items) {
        if (typeof it === 'string' && it.trim()) out.push(it.trim());
        else walk(it);
      }
    }
    if (Array.isArray(o.blocks)) walk(o.blocks);
  };
  walk(spec);
  return [...new Set(out)];
}

export function joinScriptLines(lines: string[]): string {
  return lines
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function extractCreativeScript(input: {
  contentType?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: unknown;
  caption?: string | null;
  /** Intended spoken line when we already know it (UGC script, chat make_video). */
  spoken?: string | null;
  graphicSpec?: unknown;
}): CreativeScript {
  const kind = inferCreativeKind({
    contentType: input.contentType,
    mediaUrl: input.mediaUrl,
    mediaUrls: input.mediaUrls,
    hasGraphic: !!input.graphicSpec
  });
  const caption = String(input.caption ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const spoken = String(input.spoken ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const onScreen = joinScriptLines(onScreenFromGraphic(input.graphicSpec));
  return { kind, spoken, onScreen, caption };
}

export function formatCreativeScriptForJudge(script: CreativeScript): string {
  const bits = [
    script.spoken ? `INTENDED SPOKEN:\n${script.spoken.slice(0, 1200)}` : null,
    script.onScreen ? `INTENDED ON-SCREEN COPY:\n${script.onScreen.slice(0, 1200)}` : null,
    script.caption ? `CAPTION / PRIMARY TEXT:\n${script.caption.slice(0, 800)}` : 'CAPTION: (none)'
  ].filter(Boolean);
  return bits.join('\n\n');
}
