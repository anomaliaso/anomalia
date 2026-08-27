import { parse, type HTMLElement, type Node } from 'node-html-parser';
import type { El } from './graphic-tree';
import { parseGraphicCanvasSize, parsePx, unwrapGraphicSource, type GraphicCanvasSize } from './graphic-source';

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT']);
const UNWRAP_TAGS = new Set(['HTML', 'BODY']);
const FLEX_TAGS = new Set([
	'DIV',
	'SECTION',
	'ARTICLE',
	'HEADER',
	'FOOTER',
	'MAIN',
	'NAV',
	'P',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'UL',
	'OL',
	'LI',
	'SPAN',
	'STRONG',
	'B',
	'EM',
	'I',
	'A'
]);

export type HtmlSatoriTree = GraphicCanvasSize & { tree: El };

/**
 * Turn an HTML graphic (optional `<style>` + a canvas root) into the element tree satori rasterises.
 * CSS is a small subset: class / id / tag rules, inline styles, flexbox. No custom properties.
 */
export function htmlToSatori(source: string): HtmlSatoriTree {
	const html = unwrapGraphicSource(source);
	const size = parseGraphicCanvasSize(html);
	const root = parse(html, { comment: false });

	const css = collectCss(root);
	for (const styleEl of root.querySelectorAll('style')) styleEl.remove();

	const canvas =
		root.querySelector('[data-graphic]') ??
		root.querySelector('.canvas') ??
		root.querySelector('#graphic') ??
		firstElement(root);

	if (!canvas) {
		throw new Error('HTML graphic has no root element (.canvas, #graphic, or [data-graphic])');
	}

	applyCss(canvas, css);
	const tree = toEl(canvas, size);
	if (!tree || typeof tree === 'string') {
		throw new Error('HTML graphic root did not produce a renderable tree');
	}

	// Force the canvas box so satori never shrinks to content.
	tree.props.style = {
		display: 'flex',
		flexDirection: (tree.props.style.flexDirection as string) ?? 'column',
		overflow: 'hidden',
		...tree.props.style,
		width: size.width,
		height: size.height
	};

	return { ...size, tree };
}

type CssRule = { selector: string; decls: Record<string, string> };

function collectCss(root: HTMLElement): CssRule[] {
	const rules: CssRule[] = [];
	for (const el of root.querySelectorAll('style')) {
		parseCssRules(el.text, rules);
	}
	return rules;
}

function parseCssRules(css: string, out: CssRule[]) {
	const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(cleaned))) {
		const selectors = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
		const decls = parseDecls(m[2]!);
		for (const selector of selectors) out.push({ selector, decls });
	}
}

function parseDecls(body: string): Record<string, string> {
	const decls: Record<string, string> = {};
	for (const part of body.split(';')) {
		const i = part.indexOf(':');
		if (i < 0) continue;
		const prop = part.slice(0, i).trim();
		const value = part.slice(i + 1).trim();
		if (prop && value) decls[prop] = value;
	}
	return decls;
}

function applyCss(root: HTMLElement, rules: CssRule[]) {
	const walk = (el: HTMLElement) => {
		const merged: Record<string, string> = {};
		for (const rule of rules) {
			if (matches(el, rule.selector)) Object.assign(merged, rule.decls);
		}
		const inline = el.getAttribute('style');
		if (inline) Object.assign(merged, parseDecls(inline));
		const next = Object.entries(merged)
			.map(([k, v]) => `${k}: ${v}`)
			.join('; ');
		if (next) el.setAttribute('style', next);
		for (const child of el.childNodes) {
			if (isElement(child)) walk(child);
		}
	};
	walk(root);
}

function matches(el: HTMLElement, selector: string): boolean {
	const sel = selector.trim();
	if (!sel || sel === '*') return true;
	try {
		if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
		if (sel.startsWith('#')) return el.id === sel.slice(1);
		if (sel.includes('[') || sel.includes(' ') || sel.includes('>') || sel.includes(':')) {
			return el.matches(sel);
		}
		return el.tagName === sel.toUpperCase();
	} catch {
		return false;
	}
}

function toEl(node: Node, size: GraphicCanvasSize): El | string | null {
	if (node.nodeType === 3) {
		const text = (node as { text?: string }).text ?? node.rawText ?? '';
		const trimmed = text.replace(/\s+/g, ' ');
		if (!trimmed.trim()) return null;
		return trimmed;
	}
	if (!isElement(node)) return null;
	const tag = node.tagName;
	if (!tag || SKIP_TAGS.has(tag)) return null;
	if (UNWRAP_TAGS.has(tag)) {
		const kids = childrenOf(node, size);
		if (kids.length === 1 && typeof kids[0] !== 'string') return kids[0] as El;
		return el('div', { display: 'flex', flexDirection: 'column', width: size.width, height: size.height }, kids);
	}
	if (tag === 'BR') {
		return el('div', { display: 'flex', width: '100%', height: 8 }, '');
	}

	const style = styleToObject(node.getAttribute('style') ?? '');
	if (FLEX_TAGS.has(tag) && style.display == null) style.display = 'flex';

	if (tag === 'IMG') {
		const src = node.getAttribute('src') ?? '';
		const width = num(node.getAttribute('width')) ?? parsePx(String(style.width ?? '')) ?? undefined;
		const height = num(node.getAttribute('height')) ?? parsePx(String(style.height ?? '')) ?? undefined;
		if (width != null) style.width = style.width ?? width;
		if (height != null) style.height = style.height ?? height;
		if (!style.display) style.display = 'flex';
		return {
			type: 'img',
			props: { style, src, width, height, children: undefined }
		};
	}

	const kids = childrenOf(node, size);
	const type = tag === 'IMG' ? 'img' : 'div';
	return el(type, style, kids.length === 1 ? kids[0] : kids.length ? kids : undefined);
}

function childrenOf(node: HTMLElement, size: GraphicCanvasSize): Array<El | string> {
	const out: Array<El | string> = [];
	for (const child of node.childNodes) {
		const n = toEl(child, size);
		if (n == null || n === '') continue;
		out.push(n);
	}
	return out;
}

function el(
	type: string,
	style: Record<string, unknown>,
	children?: El | El[] | string | Array<El | string>
): El {
	return { type, props: { style, children: children as El | El[] | string | undefined } };
}

function isElement(node: Node): node is HTMLElement {
	return (node as HTMLElement).nodeType === 1 && typeof (node as HTMLElement).tagName === 'string';
}

function firstElement(root: HTMLElement): HTMLElement | null {
	for (const child of root.childNodes) {
		if (isElement(child) && !SKIP_TAGS.has(child.tagName) && !UNWRAP_TAGS.has(child.tagName)) return child;
		if (isElement(child) && UNWRAP_TAGS.has(child.tagName)) {
			const inner = firstElement(child);
			if (inner) return inner;
		}
	}
	return root.querySelector('div');
}

function num(v: string | undefined | null): number | undefined {
	if (v == null || v === '') return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : parsePx(v) ?? undefined;
}

function styleToObject(inline: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [rawProp, rawVal] of Object.entries(parseDecls(inline))) {
		const prop = camel(rawProp);
		out[prop] = cssValue(prop, rawVal);
	}
	return out;
}

function camel(prop: string): string {
	if (prop.startsWith('--')) return prop;
	return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

const NUMBER_PROPS = new Set([
	'fontWeight',
	'flexGrow',
	'flexShrink',
	'flex',
	'opacity',
	'lineHeight',
	'zIndex',
	'order'
]);

function cssValue(prop: string, value: string): unknown {
	if (value === 'true' || value === 'false') return value === 'true';
	if (NUMBER_PROPS.has(prop)) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	if (prop === 'lineHeight' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
	const px = parsePx(value);
	if (
		px != null &&
		/^(width|height|minWidth|minHeight|maxWidth|maxHeight|fontSize|padding|margin|top|left|right|bottom|gap|rowGap|columnGap|borderRadius|letterSpacing)$/i.test(
			prop
		)
	) {
		return px;
	}
	if (prop === 'flexGrow' || prop === 'flexShrink') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	if (prop === 'flex' && /^\d+(\.\d+)?$/.test(value)) {
		return Number(value);
	}
	return value;
}
