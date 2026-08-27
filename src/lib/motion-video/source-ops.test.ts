import { describe, expect, it } from 'vitest';
import {
	MOTION_GREP_MAX_HITS,
	MOTION_READ_DEFAULT_CHARS,
	applyReplace,
	grepSource,
	newImageUrls,
	sliceSource
} from './source-ops';

describe('sliceSource', () => {
	it('pages by character index', () => {
		const src = 'abcdefghij';
		const a = sliceSource(src, 0, 4);
		expect(a).toEqual({
			start: 0,
			end: 4,
			total: 10,
			next_start: 4,
			source: 'abcd'
		});
		const b = sliceSource(src, a.next_start ?? 0, 4);
		expect(b.source).toBe('efgh');
		expect(b.next_start).toBe(8);
		const c = sliceSource(src, b.next_start ?? 0, 4);
		expect(c.source).toBe('ij');
		expect(c.next_start).toBeNull();
	});

	it('respects a higher hardCap for attachment-sized pages', () => {
		const src = 'a'.repeat(10_000);
		const s = sliceSource(src, 0, 9_000, 12_000);
		expect(s.source.length).toBe(9_000);
		expect(s.next_start).toBe(9_000);
	});
});

describe('applyReplace', () => {
	it('replaces the first occurrence by default', () => {
		const r = applyReplace('aa-aa-aa', 'aa', 'bb');
		expect(r).toEqual({ source: 'bb-aa-aa', replaced: 1 });
	});

	it('replaces the first N occurrences', () => {
		const r = applyReplace('aa-aa-aa', 'aa', 'bb', { count: 2 });
		expect(r).toEqual({ source: 'bb-bb-aa', replaced: 2 });
	});

	it('replaces every occurrence', () => {
		const r = applyReplace('aa-aa-aa', 'aa', 'bb', { replaceAll: true });
		expect(r).toEqual({ source: 'bb-bb-bb', replaced: 3 });
	});

	it('throws when old_str is missing', () => {
		expect(() => applyReplace('hello', 'zzz', 'y')).toThrow(/not found/i);
	});
});

describe('grepSource', () => {
	const src = 'const headline = "Hello";\nconst sub = "Hello world";\n';

	it('returns char index, line, and the matching line', () => {
		const g = grepSource(src, 'Hello');
		expect(g.total).toBe(2);
		expect(g.matches[0]).toMatchObject({ index: 18, line: 1 });
		expect(g.matches[0].preview).toContain('headline');
		expect(g.matches[1].line).toBe(2);
		expect(g.truncated).toBe(false);
	});

	it('supports ignore_case and regex', () => {
		expect(grepSource(src, 'HELLO', { ignoreCase: true }).total).toBe(2);
		expect(grepSource(src, 'Hel+o', { regex: true }).total).toBe(2);
	});

	it('caps hits and reports truncated', () => {
		const many = Array.from({ length: MOTION_GREP_MAX_HITS + 5 }, () => 'foo').join('\n');
		const g = grepSource(many, 'foo');
		expect(g.total).toBe(MOTION_GREP_MAX_HITS + 5);
		expect(g.matches).toHaveLength(MOTION_GREP_MAX_HITS);
		expect(g.truncated).toBe(true);
	});
});

describe('MOTION_READ_DEFAULT_CHARS', () => {
	it('is a 4k page', () => {
		expect(MOTION_READ_DEFAULT_CHARS).toBe(4000);
	});
});

describe('newImageUrls', () => {
	const known = 'logo: https://cdn.brand.com/logo.png';

	it('returns only URLs the patch introduces', () => {
		const src = `<Img src="https://cdn.brand.com/logo.png" /><Img src="https://x.co/a.png" />`;
		expect(newImageUrls(src, known)).toEqual(['https://x.co/a.png']);
	});

	it('dedupes, ignores non-http and relative srcs, and caps the list', () => {
		const src = `<Img src="https://x.co/a.png" /><Img src="https://x.co/a.png" /><Img src={logoUrl} /><Img src="/local.png" />`;
		expect(newImageUrls(src, known)).toEqual(['https://x.co/a.png']);
		const many = Array.from({ length: 12 }, (_, i) => `<Img src="https://x.co/${i}.png" />`).join('');
		expect(newImageUrls(many, known)).toHaveLength(8);
	});

	it('matches through other attributes on the tag', () => {
		const src = `<Img style={{ width: 10 }} src='https://x.co/b.png' alt="" />`;
		expect(newImageUrls(src, known)).toEqual(['https://x.co/b.png']);
	});
});
