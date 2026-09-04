import { describe, expect, it } from 'vitest';
import { parseGraphic } from './blocks';
import { compileGraphicTsx } from './compile-graphic-tsx';
import {
	detectGraphicSourceKind,
	parseGraphicCanvasSize,
	unwrapGraphicSource,
	defaultGraphicHtml,
	defaultGraphicTsx,
	formatGraphicEditorSystemSuffix
} from './graphic-source';
import { graphicToHtml } from './html-from-blocks';
import { htmlToSatori } from './html-to-satori';

const sample = parseGraphic({
	aspect: '4:5',
	theme: 'light',
	blocks: [
		{ type: 'kicker', text: 'Chiesto a ChatGPT' },
		{ type: 'headline', text: 'Ti ha escluso\ndalla risposta.' },
		{ type: 'footer', brand: 'Anomalia', note: '25€/mese' }
	]
});

describe('graphic source kind', () => {
	it('unwraps a fenced html block', () => {
		expect(unwrapGraphicSource('```html\n<div class="canvas"></div>\n```')).toBe(
			'<div class="canvas"></div>'
		);
	});

	it('detects tsx vs html', () => {
		expect(detectGraphicSourceKind('<div class="canvas"></div>')).toBe('html');
		expect(detectGraphicSourceKind(defaultGraphicTsx({ brandName: 'Acme' }))).toBe('tsx');
	});

	it('reads canvas size from data attributes', () => {
		const size = parseGraphicCanvasSize(defaultGraphicHtml({ aspect: '9:16' }));
		expect(size.aspect).toBe('9:16');
		expect(size.width).toBe(1080);
		expect(size.height).toBe(1920);
	});

	it('formats post-editor meta without dumping the HTML', () => {
		const html = '<div class="canvas">Hi</div>';
		const block = formatGraphicEditorSystemSuffix({
			sourceKind: 'html',
			version: 3,
			aspect: '4:5',
			sourceChars: html.length
		});
		expect(block).toContain('GRAPHIC SOURCE META');
		expect(block).toContain(`chars=${html.length}`);
		expect(block).toContain('grep_source');
		expect(block).toContain('replace_source');
		expect(block).toContain('write_source');
		expect(block).toContain('generate_image');
		expect(block).toContain('read_media');
		expect(block).toContain('use_library_image');
		expect(block).not.toContain(html);
		expect(block).not.toContain('cover slide');
	});

	it('marks carousel cover in the meta line', () => {
		const block = formatGraphicEditorSystemSuffix({
			sourceKind: 'tsx',
			version: 1,
			aspect: '1:1',
			sourceChars: 12000,
			carousel: true
		});
		expect(block).toContain('carousel');
		expect(block).toContain('chars=12000');
	});
});

describe('html from blocks', () => {
	it('emits the headline and brand as real HTML', () => {
		const html = graphicToHtml(sample);
		expect(html).toContain('data-aspect="4:5"');
		expect(html).toContain('Ti ha escluso');
		expect(html).toContain('Anomalia');
		expect(html).toContain('<style>');
	});
});

describe('html to satori', () => {
	it('builds a flex tree from class CSS', () => {
		const { tree, width, height } = htmlToSatori(graphicToHtml(sample));
		expect(width).toBe(1080);
		expect(height).toBe(1350);
		expect(tree.props.style.display).toBe('flex');
		const dumped = JSON.stringify(tree);
		expect(dumped).toContain('Ti ha escluso');
		expect(dumped).toContain('Anomalia');
	});

	it('renders a hand-written canvas with a style tag', () => {
		const { tree } = htmlToSatori(`<div class="canvas" data-width="1080" data-height="1080">
  <style>
    .canvas { width: 1080px; height: 1080px; display: flex; background: #111; color: #fff; }
    .title { font-size: 72px; font-weight: 600; }
  </style>
  <div class="title">Hello</div>
</div>`);
		expect(JSON.stringify(tree)).toContain('Hello');
	});
});

describe('tsx compile', () => {
	it('compiles a default graphic component', () => {
		const compiled = compileGraphicTsx(defaultGraphicTsx({ brandName: 'Acme', headline: 'Ciao' }));
		expect(compiled.width).toBe(1080);
		expect(compiled.height).toBe(1350);
		expect(compiled.element).toBeTruthy();
	});

	it('rejects non-react imports', () => {
		expect(() =>
			compileGraphicTsx(`import fs from 'fs';
export default function Graphic() { return <div />; }`)
		).toThrow(/not allowed/);
	});
});

