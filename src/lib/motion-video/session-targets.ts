import {
	MOTION_FPS,
	formatMotionLength,
	motionAspectFromSize,
	type MotionAspectRatio
} from './source';

export type MotionSessionTarget = {
	id: string;
	title: string;
	source: string;
	width?: number;
	height?: number;
	fps?: number;
	durationInFrames?: number;
};

export type MotionSessionMeta = {
	id: string;
	index: number;
	title: string;
	aspect: MotionAspectRatio;
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	length: string;
	headline: string | null;
	chars: number;
};

/** Seed / typical compositions store copy in `const headline = '…'`. */
export function extractMotionHeadline(source: string): string | null {
	const m =
		source.match(/\bconst headline\s*=\s*'((?:\\.|[^'\\])*)'/) ||
		source.match(/\bconst headline\s*=\s*"((?:\\.|[^"\\])*)"/);
	if (!m) return null;
	const text = m[1]
		.replace(/\\n/g, ' ')
		.replace(/\\t/g, ' ')
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
	return text ? text.slice(0, 80) : null;
}

export function motionSessionMeta(
	target: MotionSessionTarget,
	index: number
): MotionSessionMeta {
	const width = target.width && target.width > 0 ? target.width : 1080;
	const height = target.height && target.height > 0 ? target.height : 1080;
	const fps = target.fps && target.fps > 0 ? target.fps : MOTION_FPS;
	const durationInFrames =
		target.durationInFrames && target.durationInFrames > 0 ? target.durationInFrames : 180;
	return {
		id: target.id,
		index,
		title: target.title.trim() || 'Untitled',
		aspect: motionAspectFromSize(width, height),
		width,
		height,
		fps,
		durationInFrames,
		length: formatMotionLength(durationInFrames, fps),
		headline: extractMotionHeadline(target.source),
		chars: target.source.length
	};
}

export function formatMotionTargetSummary(meta: MotionSessionMeta): string {
	const head = meta.headline ? ` — "${meta.headline}"` : '';
	return `#${meta.index} "${meta.title}" · ${meta.aspect} · ${meta.length}${head}`;
}

export function formatMotionSessionRoster(targets: MotionSessionTarget[]): string {
	return targets
		.map((target, i) => {
			const meta = motionSessionMeta(target, i + 1);
			const lines = [
				`--- video ${meta.index} of ${targets.length}`,
				`id: ${meta.id}`,
				`title: ${meta.title}`,
				`canvas: ${meta.aspect} (${meta.width}×${meta.height})`,
				`length: ${meta.length} (${meta.durationInFrames} frames @ ${meta.fps}fps)`
			];
			if (meta.headline) lines.push(`headline: ${meta.headline}`);
			lines.push(`chars: ${meta.chars}`);
			return lines.join('\n');
		})
		.join('\n');
}

export function formatMotionTargetingRules(opts: {
	createMode: boolean;
	reflowAspect: boolean;
	count: number;
}): string {
	if (opts.createMode) {
		return `TARGETING: CREATE. No gallery tiles are selected. Build a NEW composition from the seed. You cannot see or edit other Motion videos this turn. If the user clearly wanted to change an existing tile, tell them to select it in the gallery — do not silently create a second copy unless they asked for a new video.`;
	}
	if (opts.count === 1) {
		return `TARGETING: EDIT exactly 1 selected video (the roster below). That is the only tile you may change.${
			opts.reflowAspect
				? ' This tile is a DUPLICATE — reflow it and leave the original alone (it is not in this session).'
				: ''
		} video_id is optional and defaults to that id. Never invent another id.`;
	}
	return `TARGETING: EDIT ${opts.count} selected videos (the roster below). You cannot see or touch any other gallery tile.
- Default: the SAME change on EVERY listed video (font, color, CTA, copy…). Omit video_id on replace_source / grep_source to hit all of them. Do not finish until every id is updated.
- Named subset: if the user points at one (title, #index like "video 2", canvas 9:16/1:1/16:9, length 6s/1m/1m:30, or headline), pass THAT video_id on every tool and leave the others untouched. If two tiles share the same aspect, disambiguate with title or headline; if still unclear, ask.
- read_source / write_source / set_title always need video_id when more than one tile is listed.
- Never invent a video_id. Never edit a tile that is not listed.`;
}

/** Prefixed onto the user turn so the model sees targets next to the brief. */
export function formatMotionUserTargetingPrefix(targets: MotionSessionTarget[]): string {
	if (!targets.length) {
		return '[Motion session: CREATE. No gallery tiles selected. Make a new video. You cannot edit existing Motion videos this turn.]';
	}
	const lines = targets.map((t, i) => formatMotionTargetSummary(motionSessionMeta(t, i + 1)));
	if (targets.length === 1) {
		return `[Motion session: EDIT exactly 1 selected video — ${lines[0]}. That is the only tile you may change.]`;
	}
	return `[Motion session: EDIT ${targets.length} selected videos. Default = the same change on ALL of them. If the user names one (title / #index / 9:16 / 1m / headline), use that video_id only.\n${lines.join('\n')}]`;
}
