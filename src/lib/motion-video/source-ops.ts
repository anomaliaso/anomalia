import { MOTION_SOURCE_MAX_CHARS } from './source';

export const MOTION_READ_DEFAULT_CHARS = 4000;
export const MOTION_READ_MAX_CHARS = 8000;
export const MOTION_GREP_MAX_HITS = 40;

const IMG_SRC_URL = /<Img[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi;

/**
 * http(s) `<Img src>` URLs in `source` that do not already appear in `known` — i.e. the ones the
 * model just introduced, which are the only ones worth verifying before a write lands.
 */
const VIDEO_URL = /https?:\/\/[^\s"'<>()]+\.(?:mp4|mov|webm|m4v)(?:\?[^\s"'<>()]*)?/gi;

/** Video URLs pasted in a prompt — the model can only watch one if it is attached as a file part. */
export function referenceVideoUrls(text: string, limit = 2): string[] {
	return [...new Set(text.match(VIDEO_URL) ?? [])]
		.map((u) => u.replace(/[.,;:]+$/, ''))
		.slice(0, limit);
}

export function newImageUrls(source: string, known: string, limit = 8): string[] {
	return [...new Set([...source.matchAll(IMG_SRC_URL)].map((m) => m[1]))]
		.filter((u) => !known.includes(u))
		.slice(0, limit);
}

export function sliceSource(
	source: string,
	startFrom = 0,
	maxChars = MOTION_READ_DEFAULT_CHARS,
	hardCap = MOTION_READ_MAX_CHARS
): {
	start: number;
	end: number;
	total: number;
	next_start: number | null;
	source: string;
} {
	const start = Math.max(0, Math.min(source.length, Math.floor(Number(startFrom)) || 0));
	const cap = Math.min(
		hardCap,
		Math.max(1, Math.floor(Number(maxChars)) || MOTION_READ_DEFAULT_CHARS)
	);
	const end = Math.min(source.length, start + cap);
	return {
		start,
		end,
		total: source.length,
		next_start: end < source.length ? end : null,
		source: source.slice(start, end)
	};
}

function countOccurrences(source: string, needle: string): number {
	if (!needle) return 0;
	let n = 0;
	let from = 0;
	while (true) {
		const i = source.indexOf(needle, from);
		if (i < 0) return n;
		n += 1;
		from = i + needle.length;
	}
}

/** Replace the first match, the first `count` matches, or every match. Non-overlapping. */
export function applyReplace(
	source: string,
	oldStr: string,
	newStr: string,
	opts: { replaceAll?: boolean; count?: number } = {}
): { source: string; replaced: number } {
	if (!oldStr) throw new Error('old_str is required');
	const total = countOccurrences(source, oldStr);
	if (total === 0) throw new Error('old_str not found in source');
	const n = opts.replaceAll
		? total
		: Math.min(total, Math.max(1, Math.floor(opts.count ?? 1)));
	let next = source;
	let replaced = 0;
	for (let i = 0; i < n; i++) {
		const idx = next.indexOf(oldStr);
		if (idx < 0) break;
		next = next.slice(0, idx) + newStr + next.slice(idx + oldStr.length);
		replaced += 1;
	}
	if (next.length > MOTION_SOURCE_MAX_CHARS) {
		throw new Error(`Source would exceed ${MOTION_SOURCE_MAX_CHARS} characters`);
	}
	return { source: next, replaced };
}

export type GrepHit = {
	index: number;
	line: number;
	column: number;
	preview: string;
};

export function grepSource(
	source: string,
	query: string,
	opts: { regex?: boolean; ignoreCase?: boolean } = {}
): { matches: GrepHit[]; total: number; truncated: boolean } {
	const q = query ?? '';
	if (!q) throw new Error('query is required');
	if (q.length > 500) throw new Error('query too long');

	const matches: GrepHit[] = [];
	let total = 0;

	const push = (index: number) => {
		total += 1;
		if (matches.length >= MOTION_GREP_MAX_HITS) return;
		const pre = source.slice(0, index);
		const line = pre.split('\n').length;
		const nl = pre.lastIndexOf('\n');
		const column = index - (nl + 1) + 1;
		const lineStart = nl + 1;
		const lineEnd = source.indexOf('\n', index);
		const preview = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).slice(0, 200);
		matches.push({ index, line, column, preview });
	};

	if (opts.regex) {
		let re: RegExp;
		try {
			re = new RegExp(q, opts.ignoreCase ? 'gi' : 'g');
		} catch {
			throw new Error('Invalid regex');
		}
		let guard = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) && guard++ < 10_000) {
			if (!m[0]) {
				re.lastIndex += 1;
				continue;
			}
			push(m.index);
		}
	} else {
		const hay = opts.ignoreCase ? source.toLowerCase() : source;
		const needle = opts.ignoreCase ? q.toLowerCase() : q;
		let from = 0;
		while (true) {
			const i = hay.indexOf(needle, from);
			if (i < 0) break;
			push(i);
			from = i + Math.max(1, needle.length);
		}
	}

	return { matches, total, truncated: total > matches.length };
}

/**
 * Hosts whose media must never end up inside a rendered composition.
 *
 * The reference wall (posts.design) hands the agent structure, never pixels — `study_motion_reference`
 * returns text and no URL. But the model has seen the reference's frames in its own context and can
 * write a plausible `/media/posts/…` path from the pattern, and unlike an invented URL that one
 * WOULD load, so the "does this image load" check waves it through. posts.design curates other
 * people's work; hot-linking it into an MP4 a brand publishes is not ours to do.
 */
const REFERENCE_HOSTS = /(?:^|[\s"'`(/])((?:https?:\/\/)?(?:[\w-]+\.)*posts\.design[^\s"'`)<>]*)/i;

/** The offending reference, or null when the source is clean. */
export function referenceHotlink(source: string): string | null {
	const m = REFERENCE_HOSTS.exec(source);
	return m ? m[1] : null;
}
