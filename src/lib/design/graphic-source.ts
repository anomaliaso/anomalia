import { graphicSize, type GraphicAspect } from './blocks';

/** Max HTML/TSX source stored or accepted from the agent / editor. */
export const GRAPHIC_SOURCE_MAX_CHARS = 120_000;

export type GraphicSourceKind = 'html' | 'tsx';

/** Stored in graphic_designs.spec when the editable source is HTML or TSX (not block JSON). */
export type GraphicHtmlMeta = {
	v: 2;
	kind: GraphicSourceKind;
	aspect: GraphicAspect;
};

export function isGraphicHtmlMeta(spec: unknown): spec is GraphicHtmlMeta {
	if (!spec || typeof spec !== 'object') return false;
	const o = spec as Record<string, unknown>;
	return o.v === 2 && (o.kind === 'html' || o.kind === 'tsx');
}

export function graphicHtmlMeta(aspect: GraphicAspect, kind: GraphicSourceKind = 'html'): GraphicHtmlMeta {
	return { v: 2, kind, aspect };
}

/** Metadata-only block for the post-editor prompt. Never include the HTML/TSX itself. */
export function formatGraphicEditorSystemSuffix(opts: {
	sourceKind: GraphicSourceKind;
	version: number;
	aspect: string;
	sourceChars: number;
	carousel?: boolean;
}): string {
	const lines = [
		`GRAPHIC SOURCE META: kind=${opts.sourceKind} version=${opts.version} aspect=${opts.aspect} chars=${opts.sourceChars}${opts.carousel ? ' (carousel — cover is slide 0)' : ''}`,
		'Do not dump or rewrite the whole file. Patch it:',
		'1. grep_source — find copy, colors, classes (char index + line; max 40 hits). Literal match by default; regex / ignore_case optional.',
		'2. read_source — page of 4000 chars from start_from (cap 8000). If next_start is set, call again.',
		'3. replace_source — first match by default; count=N for the first N; replace_all=true for every occurrence. old_str must match exactly.',
		'4. write_source only if the structure must be rebuilt from scratch.',
		'Need a photo in the graphic? read_media first. If a library asset fits, use_library_image then replace_source <img src="https://...">. generate_image only when nothing fits (returns image_url, does NOT change the post). Shortcut for one new photo + restyle: design_graphic generate_prompt. Never regenerate_image on a graphic.',
		'High-level restyle without touching code: design_graphic with a brief.',
		'Never paste the full source into chat. Tools persist on replace/write; do not expect the file back in the result.'
	];
	return lines.join('\n');
}

/** Strip a single markdown fence the model often wraps around source. */
export function unwrapGraphicSource(raw: string): string {
	const trimmed = raw.trim();
	const fenced = trimmed.match(/^```(?:html|tsx|ts|jsx|javascript|css)?\s*\n?([\s\S]*?)\n?```$/i);
	return (fenced ? fenced[1] : trimmed).trim();
}

export function detectGraphicSourceKind(source: string): GraphicSourceKind {
	const t = unwrapGraphicSource(source);
	if (/^\s*(?:import|export)\s/m.test(t) || /\bexport\s+default\b/.test(t)) return 'tsx';
	return 'html';
}

export function aspectFromSize(width: number, height: number): GraphicAspect {
	const r = width / Math.max(1, height);
	const candidates: Array<[GraphicAspect, number]> = [
		['1:1', 1],
		['4:5', 4 / 5],
		['9:16', 9 / 16],
		['16:9', 16 / 9]
	];
	candidates.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r));
	return candidates[0]![0];
}

const PX = /([\d.]+)px/i;

export function parsePx(value: string | undefined | null): number | null {
	if (!value) return null;
	const m = PX.exec(value.trim());
	if (!m) {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	const n = Number(m[1]);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export type GraphicCanvasSize = {
	width: number;
	height: number;
	aspect: GraphicAspect;
};

/**
 * Read canvas size from HTML data-* attributes, inline/CSS width/height, or TSX exported constants.
 * Falls back to 4:5 @ 1080.
 */
export function parseGraphicCanvasSize(source: string): GraphicCanvasSize {
	const kind = detectGraphicSourceKind(source);
	const fallback = { ...graphicSize('4:5'), aspect: '4:5' as const };

	if (kind === 'tsx') {
		const width = exportNumber(source, 'width') ?? fallback.width;
		const height = exportNumber(source, 'height') ?? fallback.height;
		return { width, height, aspect: aspectFromSize(width, height) };
	}

	const html = unwrapGraphicSource(source);
	const dataW = attrNumber(html, 'data-width');
	const dataH = attrNumber(html, 'data-height');
	const dataAspect = attrValue(html, 'data-aspect');
	if (dataW && dataH) {
		return {
			width: dataW,
			height: dataH,
			aspect: isAspect(dataAspect) ? dataAspect : aspectFromSize(dataW, dataH)
		};
	}
	if (isAspect(dataAspect)) {
		const size = graphicSize(dataAspect);
		return { ...size, aspect: dataAspect };
	}

	const w = firstCssPx(html, 'width') ?? fallback.width;
	const h = firstCssPx(html, 'height') ?? fallback.height;
	return { width: w, height: h, aspect: aspectFromSize(w, h) };
}

function isAspect(v: string | null): v is GraphicAspect {
	return v === '1:1' || v === '4:5' || v === '9:16' || v === '16:9';
}

function attrValue(html: string, name: string): string | null {
	const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
	return re.exec(html)?.[1] ?? null;
}

function attrNumber(html: string, name: string): number | null {
	const raw = attrValue(html, name);
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : parsePx(raw);
}

function exportNumber(source: string, name: string): number | null {
	const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)`, 'm');
	const m = re.exec(source);
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function firstCssPx(html: string, prop: string): number | null {
	const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+px)`, 'i');
	return parsePx(re.exec(html)?.[1]);
}

export function defaultGraphicHtml(opts: {
	aspect?: GraphicAspect;
	brandName?: string | null;
	headline?: string | null;
	accent?: string | null;
	bg?: string | null;
	ink?: string | null;
	displayFont?: string | null;
	bodyFont?: string | null;
}): string {
	const aspect = opts.aspect ?? '4:5';
	const { width, height } = graphicSize(aspect);
	const brand = (opts.brandName ?? 'Brand').replace(/</g, '');
	const headline = (opts.headline ?? 'Your headline here').replace(/</g, '');
	const accent = (opts.accent ?? '#c485fe').replace(/'/g, '');
	const bg = (opts.bg ?? '#f9f9f9').replace(/'/g, '');
	const ink = (opts.ink ?? '#1d1d1f').replace(/'/g, '');
	const displayFont = (opts.displayFont ?? 'Inter').replace(/'/g, '');
	const bodyFont = (opts.bodyFont ?? 'Inter').replace(/'/g, '');

	return `<div
  class="canvas"
  data-graphic
  data-aspect="${aspect}"
  data-width="${width}"
  data-height="${height}"
>
  <style>
    .canvas {
      width: ${width}px;
      height: ${height}px;
      display: flex;
      flex-direction: column;
      background-color: ${bg};
      color: ${ink};
      font-family: '${bodyFont}', system-ui, sans-serif;
      padding: ${Math.round(width * 0.07)}px;
      overflow: hidden;
    }
    .kicker {
      display: flex;
      font-size: ${Math.round(width * 0.025)}px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #86868b;
    }
    .headline {
      display: flex;
      flex-direction: column;
      font-family: '${displayFont}', system-ui, sans-serif;
      font-size: ${Math.round(width * 0.084)}px;
      font-weight: 400;
      letter-spacing: -0.038em;
      line-height: 1.04;
      color: ${ink};
    }
    .space { display: flex; flex-grow: 1; }
    .footer {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: flex-end;
      font-size: ${Math.round(width * 0.03)}px;
      font-weight: 500;
    }
    .dot {
      width: ${Math.round(width * 0.026)}px;
      height: ${Math.round(width * 0.026)}px;
      border-radius: 999px;
      background-color: ${accent};
    }
  </style>
  <div class="kicker">${brand}</div>
  <div class="space"></div>
  <div class="headline">${escapeHtml(headline)}</div>
  <div class="space"></div>
  <div class="footer">
    <div style="display:flex;flex-direction:row;align-items:center;gap:12px">
      <div class="dot"></div>
      <div>${escapeHtml(brand)}</div>
    </div>
  </div>
</div>
`;
}

export function defaultGraphicTsx(opts: {
	aspect?: GraphicAspect;
	brandName?: string | null;
	headline?: string | null;
	accent?: string | null;
	bg?: string | null;
	ink?: string | null;
	displayFont?: string | null;
	bodyFont?: string | null;
}): string {
	const aspect = opts.aspect ?? '4:5';
	const { width, height } = graphicSize(aspect);
	const brand = escTs(opts.brandName ?? 'Brand');
	const headline = escTs(opts.headline ?? 'Your headline here');
	const accent = (opts.accent ?? '#c485fe').replace(/'/g, '');
	const bg = (opts.bg ?? '#f9f9f9').replace(/'/g, '');
	const ink = (opts.ink ?? '#1d1d1f').replace(/'/g, '');
	const displayFont = escTs(opts.displayFont ?? 'Inter');
	const bodyFont = escTs(opts.bodyFont ?? 'Inter');

	return `import React from 'react';

export const width = ${width};
export const height = ${height};

const brand = '${brand}';
const headline = '${headline}';
const accent = '${accent}';
const bg = '${bg}';
const ink = '${ink}';
const displayFont = '${displayFont}';
const bodyFont = '${bodyFont}';

export default function Graphic() {
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: bg,
        color: ink,
        fontFamily: bodyFont,
        padding: Math.round(width * 0.07),
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: Math.round(width * 0.025),
          fontWeight: 600,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: '#86868b'
        }}
      >
        {brand}
      </div>
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <div
        style={{
          display: 'flex',
          fontFamily: displayFont,
          fontSize: Math.round(width * 0.084),
          fontWeight: 400,
          letterSpacing: '-0.038em',
          lineHeight: 1.04,
          color: ink
        }}
      >
        {headline}
      </div>
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: Math.round(width * 0.03),
          fontWeight: 500
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: Math.round(width * 0.026),
              height: Math.round(width * 0.026),
              borderRadius: 999,
              backgroundColor: accent
            }}
          />
          <div>{brand}</div>
        </div>
      </div>
    </div>
  );
}
`;
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escTs(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/** Visible text inside HTML/TSX source — used by video-review on-screen copy. */
export function textFromGraphicSource(source: string): string[] {
	const html = detectGraphicSourceKind(source) === 'tsx' ? tsxToRoughHtml(source) : source;
	const stripped = html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"');
	return stripped
		.split(/\n+/)
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter((l) => l.length > 1);
}

function tsxToRoughHtml(source: string): string {
	return source
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/style=\{\{[\s\S]*?\}\}/g, '')
		.replace(/<\s*([A-Z][\w.]*)/g, '<div');
}
