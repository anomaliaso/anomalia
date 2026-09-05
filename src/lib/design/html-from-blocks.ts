import {
	graphicSize,
	paletteFor,
	resolveFill,
	scale,
	IMAGE_SIZE_PCT,
	type Block,
	type Graphic,
	type Palette
} from './blocks';
import { iconDataUri, resolveGraphicIcon } from './graphic-icons';
import { escapeHtml } from './graphic-source';

const RADIUS_PCT = { none: 0, sm: 1.2, md: 2.4, full: 50 } as const;
const MARK_SIZE_PCT = { sm: 4.5, md: 6.5, lg: 9 } as const;

export type GraphicToHtmlOpts = {
	brandColors?: string[] | null;
	fonts?: { display: string; body: string };
};

/**
 * Project a legacy block spec into editable HTML+CSS. Not a pixel-perfect clone of graphic-tree —
 * it is the starting source the human / model can then rewrite freely.
 */
export function graphicToHtml(graphic: Graphic, opts: GraphicToHtmlOpts = {}): string {
	const { width, height } = graphicSize(graphic.aspect);
	const p = paletteFor(graphic.theme, opts.brandColors);
	const fonts = opts.fonts ?? { display: 'Inter', body: 'Inter' };
	const pad = scale(width, 7);
	const contentW = width - pad * 2;
	const s = (pct: number) => scale(width, pct);

	const body: string[] = [];
	if (graphic.background?.src) {
		const dim = graphic.background.dim ?? 0.45;
		const scrim =
			graphic.theme === 'light'
				? `rgba(249,249,249,${dim})`
				: graphic.theme === 'accent'
					? hexToRgba(p.bg, dim)
					: `rgba(29,29,31,${dim})`;
		body.push(
			`<img class="bg" src="${escapeAttr(graphic.background.src)}" width="${width}" height="${height}" />`,
			`<div class="scrim" style="background-color:${scrim}"></div>`
		);
	}

	const blocks = graphic.blocks.map((b) => blockHtml(b, width, contentW, p, fonts, s)).filter(Boolean);
	body.push(`<div class="stack">${blocks.join('\n')}</div>`);

	const bg = graphic.background ? 'transparent' : p.bg;

	return `<div
  class="canvas"
  data-graphic
  data-aspect="${graphic.aspect}"
  data-width="${width}"
  data-height="${height}"
  data-theme="${graphic.theme}"
>
  <style>
    .canvas {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      display: flex;
      flex-direction: column;
      background-color: ${graphic.background ? p.bg : bg};
      overflow: hidden;
      font-family: '${cssFont(fonts.body)}', system-ui, sans-serif;
      color: ${p.ink};
    }
    .bg {
      position: absolute;
      top: 0;
      left: 0;
      width: ${width}px;
      height: ${height}px;
      object-fit: ${graphic.background?.fit ?? 'cover'};
    }
    .scrim {
      position: absolute;
      top: 0;
      left: 0;
      width: ${width}px;
      height: ${height}px;
      display: flex;
    }
    .stack {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      display: flex;
      flex-direction: column;
      padding: ${pad}px;
      gap: ${s(3)}px;
      background-color: ${graphic.background ? 'transparent' : p.bg};
    }
    .space { display: flex; flex-grow: 1; }
    .kicker {
      display: flex;
      font-size: ${s(2.5)}px;
      font-weight: 600;
      letter-spacing: ${s(2.5) * 0.16}px;
      text-transform: uppercase;
      color: ${p.faint};
    }
    .headline {
      display: flex;
      flex-direction: column;
      font-family: '${cssFont(fonts.display)}', system-ui, sans-serif;
      font-weight: 400;
      color: ${p.ink};
      line-height: 1.04;
    }
    .body {
      display: flex;
      font-size: ${s(3.4)}px;
      line-height: 1.4;
      color: ${p.soft};
    }
    .footer {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: flex-end;
      gap: ${s(4)}px;
    }
  </style>
  ${body.join('\n  ')}
</div>
`;
}

function blockHtml(
	block: Block,
	w: number,
	contentW: number,
	p: Palette,
	fonts: { display: string; body: string },
	s: (pct: number) => number
): string {
	switch (block.type) {
		case 'kicker':
			return `<div class="kicker">${escapeHtml(block.text)}</div>`;
		case 'headline': {
			const n = block.text.replace(/\s+/g, ' ').length;
			const pct = n > 72 ? 5.8 : n > 42 ? 7.1 : 8.4;
			const size = s(pct);
			const lines = block.text.replace(/\\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
			const inner = lines
				.map(
					(line) =>
						`<div style="display:flex;font-family:'${cssFont(fonts.display)}',system-ui,sans-serif;font-size:${size}px;font-weight:400;letter-spacing:${size * -0.038}px;line-height:1.04">${escapeHtml(line)}</div>`
				)
				.join('');
			return `<div class="headline">${inner}</div>`;
		}
		case 'body':
			return `<div class="body">${escapeHtml(block.text)}</div>`;
		case 'list': {
			const items = block.items
				.map((item, i) => {
					const mark =
						block.marker === 'number'
							? `<div style="display:flex;color:${p.faint};font-weight:500;width:${s(3.4)}px;flex-shrink:0">${i + 1}</div>`
							: `<div style="display:flex;width:${s(1.9)}px;height:${s(1.9)}px;border-radius:${s(1.9)}px;background-color:${p.accent};flex-shrink:0"></div>`;
					return `<div style="display:flex;flex-direction:row;align-items:center;gap:${s(2.2)}px;font-size:${s(3.1)}px;color:${p.ink}">${mark}<div style="display:flex">${escapeHtml(item)}</div></div>`;
				})
				.join('');
			return `<div style="display:flex;flex-direction:column;gap:${s(2.2)}px">${items}</div>`;
		}
		case 'stat': {
			const label = block.label
				? `<div style="display:flex;font-size:${s(3.2)}px;color:${p.soft}">${escapeHtml(block.label)}</div>`
				: '';
			return `<div style="display:flex;flex-direction:column;gap:${s(1.6)}px"><div style="display:flex;font-family:'${cssFont(fonts.display)}',system-ui,sans-serif;font-size:${s(20)}px;font-weight:400;letter-spacing:${s(20) * -0.05}px;line-height:1;color:${p.ink}">${escapeHtml(block.value)}</div>${label}</div>`;
		}
		case 'quote': {
			const attr = block.attribution
				? `<div style="display:flex;font-size:${s(3)}px;color:${p.soft}">— ${escapeHtml(block.attribution)}</div>`
				: '';
			return `<div style="display:flex;flex-direction:column;gap:${s(3)}px"><div style="display:flex;font-family:'${cssFont(fonts.display)}',system-ui,sans-serif;font-size:${s(6)}px;font-weight:400;letter-spacing:${s(6) * -0.03}px;line-height:1.16;color:${p.ink}">${escapeHtml(block.text)}</div>${attr}</div>`;
		}
		case 'grid': {
			const rows: string[][] = [];
			for (let i = 0; i < block.items.length; i += 3) rows.push(block.items.slice(i, i + 3));
			const cellW = (contentW - 2) / 3;
			const htmlRows = rows
				.map((cells, r) => {
					const cellsHtml = cells
						.map((cell, c) => {
							const on = block.highlight === r * 3 + c;
							return `<div style="display:flex;flex-grow:1;flex-basis:0;height:${Math.round(cellW * 0.62)}px;align-items:center;justify-content:center;font-size:${s(3.1)}px;font-weight:${on ? 500 : 400};background-color:${on ? p.accent : p.bg};color:${on ? p.onAccent : p.faint}">${escapeHtml(cell)}</div>`;
						})
						.join('');
					return `<div style="display:flex;flex-direction:row;gap:1px">${cellsHtml}</div>`;
				})
				.join('');
			return `<div style="display:flex;flex-direction:column;background-color:${p.hair};gap:1px;border:1px solid ${p.hair}">${htmlRows}</div>`;
		}
		case 'answer': {
			const card = { bg: '#ffffff', ink: '#1d1d1f', faint: '#86868b', hair: '#ededef' };
			const items = block.items
				.map(
					(item, i) =>
						`<div style="display:flex;flex-direction:row;gap:${s(2.4)}px;font-size:${s(3.4)}px;color:${card.ink}"><div style="display:flex;color:${card.faint};width:${s(3.4)}px;flex-shrink:0">${i + 1}</div><div style="display:flex">${escapeHtml(item)}</div></div>`
				)
				.join('');
			const missing = block.missing
				? `<div style="display:flex;flex-direction:row;border-top:1px dashed ${card.faint};padding-top:${s(2.8)}px;gap:${s(2.4)}px;font-size:${s(3.2)}px;color:${card.faint}"><div style="display:flex;color:${p.accent};width:${s(3.4)}px;flex-shrink:0">—</div><div style="display:flex">${escapeHtml(block.missing)}</div></div>`
				: '';
			return `<div style="display:flex;flex-direction:column;background-color:${card.bg};border:1px solid ${card.hair};border-radius:${s(3)}px;padding:${s(5)}px;gap:${s(3.4)}px"><div style="display:flex;font-size:${s(3.5)}px;font-weight:450;color:${card.ink}">“${escapeHtml(block.question)}”</div><div style="display:flex;height:1px;background-color:${card.hair}"></div><div style="display:flex;flex-direction:column;gap:${s(2.6)}px">${items}</div>${missing}</div>`;
		}
		case 'image': {
			const h = s(IMAGE_SIZE_PCT[block.size ?? 'md']);
			const r = s(RADIUS_PCT[block.radius ?? 'md']);
			const img = `<img src="${escapeAttr(block.src)}" width="${contentW}" height="${h}" style="display:flex;width:${contentW}px;height:${h}px;object-fit:${block.fit ?? 'cover'};border-radius:${r}px" />`;
			if (!block.label) return img;
			return `<div style="display:flex;flex-direction:column;gap:${s(1.6)}px">${img}<div style="display:flex;font-size:${s(2.6)}px;color:${p.faint}">${escapeHtml(block.label)}</div></div>`;
		}
		case 'shape': {
			const fill = resolveFill(block.fill ?? 'accent', p);
			const size = block.size ?? 'md';
			const kind = block.kind ?? 'bar';
			if (kind === 'bar') {
				const ww = size === 'lg' ? s(40) : size === 'sm' ? s(16) : s(26);
				return `<div style="display:flex;width:${ww}px;height:${s(0.9)}px;background-color:${fill};border-radius:${s(0.45)}px;flex-shrink:0"></div>`;
			}
			if (kind === 'circle') {
				const d = s(MARK_SIZE_PCT[size]);
				return `<div style="display:flex;width:${d}px;height:${d}px;border-radius:${d}px;background-color:${fill};flex-shrink:0"></div>`;
			}
			if (kind === 'pill') {
				const color = fill === p.accent ? p.onAccent : p.bg === fill ? p.ink : p.bg;
				return `<div style="display:flex;align-items:center;justify-content:center;padding:${s(1.4)}px ${s(3.2)}px;border-radius:${s(10)}px;background-color:${fill};color:${color};font-size:${s(2.6)}px;font-weight:600;letter-spacing:${s(2.6) * 0.04}px;text-transform:uppercase;flex-shrink:0;align-self:flex-start">${escapeHtml(block.label ?? '')}</div>`;
			}
			const minH = s(size === 'lg' ? 18 : size === 'sm' ? 8 : 12);
			const color = fill === p.accent ? p.onAccent : p.ink;
			return `<div style="display:flex;align-items:center;justify-content:center;width:100%;min-height:${minH}px;padding:${s(3)}px;border-radius:${s(2)}px;background-color:${fill};color:${color};font-size:${s(3.2)}px;font-weight:500;flex-shrink:0">${escapeHtml(block.label ?? '')}</div>`;
		}
		case 'icon': {
			const fill = resolveFill(block.fill ?? 'accent', p);
			const resolved = resolveGraphicIcon(block.name, fill, {
				set: block.set ?? 'auto',
				brandColor: block.brand_color
			});
			if (!resolved) return '';
			const d = s(MARK_SIZE_PCT[block.size ?? 'md']);
			const mark = `<img src="${escapeAttr(iconDataUri(resolved))}" width="${d}" height="${d}" style="display:flex;width:${d}px;height:${d}px;flex-shrink:0" />`;
			if (!block.label) return mark;
			return `<div style="display:flex;flex-direction:row;align-items:center;gap:${s(2.2)}px">${mark}<div style="display:flex;font-size:${s(3.1)}px;color:${p.ink};font-weight:500">${escapeHtml(block.label)}</div></div>`;
		}
		case 'rule':
			return `<div style="display:flex;width:${s(26)}px;height:${s(0.9)}px;background-color:${p.accent};flex-shrink:0"></div>`;
		case 'space':
			return `<div class="space"></div>`;
		case 'footer': {
			const note = block.note
				? `<div style="display:flex;font-size:${s(2.9)}px;color:${p.soft}">${escapeHtml(block.note)}</div>`
				: '';
			return `<div class="footer"><div style="display:flex;flex-direction:row;align-items:center;gap:${s(1.6)}px"><div style="display:flex;width:${s(2.6)}px;height:${s(2.6)}px;border-radius:${s(2.6)}px;background-color:${p.accent};flex-shrink:0"></div><div style="display:flex;font-size:${s(3)}px;font-weight:500;letter-spacing:${s(3) * -0.02}px;color:${p.ink}">${escapeHtml(block.brand)}</div></div>${note}</div>`;
		}
	}
}

function cssFont(name: string): string {
	return name.replace(/'/g, '');
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function hexToRgba(hex: string, a: number): string {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!m) return `rgba(0,0,0,${a})`;
	const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16));
	return `rgba(${r},${g},${b},${a})`;
}
