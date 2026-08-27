export type MotionSourceHit = {
	mode: 'create' | 'edit';
	videoId?: string;
	title?: string;
	source?: string;
};

function unwrapObject(output: unknown): Record<string, unknown> | null {
	if (output == null) return null;
	let value: unknown = output;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		try {
			value = JSON.parse(trimmed);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object') return null;
	const o = value as Record<string, unknown>;
	if (o.value && typeof o.value === 'object' && !Array.isArray(o.value)) {
		const inner = o.value as Record<string, unknown>;
		if (inner.ok === true || inner.source != null || inner.mode != null || Array.isArray(inner.results)) {
			return inner;
		}
	}
	return o;
}

/**
 * The same operations arrive under two names.
 *
 * The Motion workbench used to talk only to its own agent, whose tools are bound to the selection
 * in the turn (`write_source`, `set_title`). The chat registry names the same operations with an
 * explicit id instead (`write_motion_source`, `create_motion_video`), because there is no selection
 * there — and a thread opened from the workbench can be reopened and continued in the chat, where
 * the motion agent answers. Both vocabularies drive the same gallery, so both are listed here; a
 * name missing from these sets is not an error, it is a tile that silently stops updating.
 */
const MUTATING_TOOLS = new Set([
	'write_source',
	'edit_source',
	'replace_source',
	'set_title',
	'write_motion_source',
	'replace_motion_source',
	'create_motion_video'
]);
const IGNORE_TOOLS = new Set([
	'read_source',
	'grep_source',
	'generate_image',
	'read_motion_source',
	'grep_motion_source',
	'list_motion_videos',
	'search_motion_references',
	'study_motion_reference'
]);

function hitFromObject(
	o: Record<string, unknown>,
	isMutating: boolean
): MotionSourceHit | null {
	if (o.ok === false) return null;
	if (o.ok !== true && !isMutating) return null;

	const mode = o.mode === 'edit' ? 'edit' : o.mode === 'create' ? 'create' : isMutating ? 'create' : null;
	if (!mode) return null;

	const source = typeof o.source === 'string' && o.source.trim() ? o.source : undefined;
	const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined;
	const videoId = typeof o.video_id === 'string' && o.video_id ? o.video_id : undefined;

	if (!source && !title && !videoId) return null;

	return { mode, videoId, title, source };
}

/**
 * Pull persistable motion-video result(s) out of an AI SDK tool-output event.
 * `read_source` / `grep_source` return slices or indexes without `ok` — ignore those
 * so we don't persist a truncated page as the full composition.
 *
 * Multi-tile `replace_source` returns `{ patched, total, results: [{ video_id, ... }] }`
 * with no top-level `video_id` — collect every successful result.
 */
export function parseMotionToolHits(output: unknown, toolName?: string): MotionSourceHit[] {
	const o = unwrapObject(output);
	if (!o) return [];

	const name = toolName ?? '';
	if (IGNORE_TOOLS.has(name)) return [];
	const isMutating = MUTATING_TOOLS.has(name);

	const hits: MotionSourceHit[] = [];
	const top = hitFromObject(o, isMutating);
	if (top) hits.push(top);

	if (Array.isArray(o.results)) {
		for (const raw of o.results) {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
			const hit = hitFromObject(raw as Record<string, unknown>, true);
			if (!hit) continue;
			if (
				hit.videoId &&
				hits.some((h) => h.videoId === hit.videoId && h.source === hit.source && h.title === hit.title)
			) {
				continue;
			}
			hits.push(hit);
		}
	}

	return hits;
}

export function parseMotionToolOutput(
	output: unknown,
	toolName?: string
): MotionSourceHit | null {
	return parseMotionToolHits(output, toolName)[0] ?? null;
}
