import { createHash, randomUUID } from 'node:crypto';
import { extractSdkUsage } from '$lib/server/ai-log';

/**
 * Model-visible session log. Anything that reaches a model request is recorded here so a later
 * reader can reconstruct exactly what the agent saw — system prompt, messages, per-step system
 * patches, tool args/results (already truncated the way the model received them), and assistant
 * text. Image bytes are replaced with size/hash descriptors; they are not stored.
 */

export const MAX_VALUE_CHARS = 48_000;
export const MAX_EVENTS = 800;
export const MAX_TRANSCRIPT_CHARS = 1_200_000;
export const MAX_SYSTEM_CHARS = 500_000;

export type HarnessSurface = 'chat' | 'batch' | 'compact' | 'room';
export type HarnessStatus = 'running' | 'finished' | 'failed' | 'aborted';

export type HarnessMeta = {
	brandId?: string | null;
	userId?: string | null;
	threadId?: string | null;
	jobId?: string | null;
	agent: string;
	mode?: string;
	surface?: HarnessSurface;
	model?: string | null;
	provider?: string | null;
	/** Default true. Set false to skip the in-loop session steward. */
	steward?: boolean;
};

export type HarnessEvent =
	| { type: 'turn_start'; at: string }
	| { type: 'system'; text: string; source?: 'request' | 'prepare_step' }
	| { type: 'prompt'; text: string }
	| { type: 'message'; role: string; content: unknown }
	| { type: 'tool_call'; name: string; input: unknown; at: string }
	| { type: 'tool_result'; name: string; output?: unknown; error?: string; ok: boolean; ms: number }
	| {
			type: 'step';
			step: number;
			text?: string;
			toolNames?: string[];
			usage?: HarnessUsage;
	  }
	| { type: 'assistant_text'; text: string }
	| { type: 'usage'; usage: HarnessUsage }
	| {
			type: 'steward';
			notes: Array<{ level: 'warn' | 'block'; code: string; text: string }>;
			at: string;
	  }
	| { type: 'turn_end'; status: HarnessStatus; error?: string; at: string };

export type HarnessUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	thinkingTokens?: number;
};

export type ImageOmitted = {
	type: 'image_omitted';
	mimeType?: string;
	bytes?: number;
	sha256?: string;
};

function sha256Prefix(data: string | Buffer): string {
	return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export function omitImageData(raw: string, mimeType?: string): ImageOmitted {
	let payload: string | Buffer = raw;
	let mime = mimeType;
	if (raw.startsWith('data:')) {
		const comma = raw.indexOf(',');
		const header = comma >= 0 ? raw.slice(5, comma) : '';
		mime = header.split(';')[0] || mime;
		const b64 = comma >= 0 ? raw.slice(comma + 1) : '';
		try {
			payload = Buffer.from(b64, 'base64');
		} catch {
			payload = b64;
		}
	}
	const bytes = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength;
	const sha256 = sha256Prefix(payload);
	return { type: 'image_omitted', mimeType: mime, bytes, sha256 };
}

function looksLikeDataImage(s: string): boolean {
	return s.startsWith('data:image/') || s.startsWith('data:application/octet-stream');
}

function looksLikeRawBase64Image(s: string): boolean {
	if (s.length < 8_000) return false;
	return s.startsWith('/9j/') || s.startsWith('iVBOR') || s.startsWith('UklGR');
}

export function clipText(s: string, max = MAX_VALUE_CHARS): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
}

export function sanitizeVisible(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
	if (value == null) return value;
	if (typeof value === 'string') {
		if (looksLikeDataImage(value) || looksLikeRawBase64Image(value)) return omitImageData(value);
		return clipText(value);
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
		return { type: 'bytes', bytes: value.byteLength, sha256: sha256Prefix(value) };
	}
	if (value instanceof Uint8Array) {
		return { type: 'bytes', bytes: value.byteLength, sha256: sha256Prefix(Buffer.from(value)) };
	}
	if (value instanceof ArrayBuffer) {
		return { type: 'bytes', bytes: value.byteLength };
	}
	if (typeof URL !== 'undefined' && value instanceof URL) return value.toString();
	if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
	if (typeof value !== 'object') return String(value);

	if (seen.has(value)) return '[Circular]';
	seen.add(value);

	if (Array.isArray(value)) return value.map((v) => sanitizeVisible(v, seen));

	const obj = value as Record<string, unknown>;
	if (obj.type === 'image' || ('image' in obj && obj.image != null && obj.type !== 'text')) {
		const image = obj.image;
		const omitted =
			typeof image === 'string'
				? looksLikeDataImage(image) || looksLikeRawBase64Image(image)
					? omitImageData(image)
					: { type: 'image_ref', src: clipText(image, 2_000) }
				: sanitizeVisible(image, seen);
		const rest: Record<string, unknown> = { type: obj.type ?? 'image', image: omitted };
		if (obj.mediaType) rest.mediaType = obj.mediaType;
		if (obj.mimeType) rest.mimeType = obj.mimeType;
		return rest;
	}

	const inline = obj.inlineData;
	if (inline && typeof inline === 'object' && !Array.isArray(inline)) {
		const rec = inline as Record<string, unknown>;
		if (typeof rec.data === 'string' && rec.data.length > 200) {
			return {
				...obj,
				inlineData: {
					mimeType: rec.mimeType,
					data: omitImageData(String(rec.data), typeof rec.mimeType === 'string' ? rec.mimeType : undefined)
				}
			};
		}
	}

	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) out[k] = sanitizeVisible(v, seen);
	return out;
}

function textOfContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) {
		try {
			return JSON.stringify(sanitizeVisible(content));
		} catch {
			return String(content);
		}
	}
	const bits: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			bits.push(String(part));
			continue;
		}
		const p = part as Record<string, unknown>;
		if (p.type === 'text' && typeof p.text === 'string') bits.push(p.text);
		else if (p.type === 'image' || p.type === 'image_omitted' || p.type === 'image_ref') {
			const img = (p.image ?? p) as Record<string, unknown>;
			const meta = img && typeof img === 'object' ? img : p;
			bits.push(
				`[image ${typeof meta.mimeType === 'string' ? meta.mimeType : ''} ${typeof meta.bytes === 'number' ? meta.bytes + 'B' : ''} ${typeof meta.sha256 === 'string' ? meta.sha256 : typeof meta.src === 'string' ? meta.src.slice(0, 80) : ''}]`.trim()
			);
		} else {
			try {
				bits.push(JSON.stringify(p));
			} catch {
				bits.push('[part]');
			}
		}
	}
	return bits.join('\n');
}

export function renderTranscript(events: HarnessEvent[]): string {
	const lines: string[] = [];
	for (const ev of events) {
		switch (ev.type) {
			case 'turn_start':
				lines.push(`=== turn start ${ev.at} ===`);
				break;
			case 'system':
				lines.push(`--- system${ev.source === 'prepare_step' ? ' (prepare_step)' : ''} ---`);
				lines.push(ev.text);
				break;
			case 'prompt':
				lines.push('--- prompt ---');
				lines.push(ev.text);
				break;
			case 'message':
				lines.push(`--- ${ev.role} ---`);
				lines.push(textOfContent(ev.content));
				break;
			case 'tool_call':
				lines.push(`→ ${ev.name}`);
				try {
					lines.push(JSON.stringify(ev.input, null, 2));
				} catch {
					lines.push(String(ev.input));
				}
				break;
			case 'tool_result':
				lines.push(`← ${ev.name}${ev.ok ? '' : ' ERROR'} (${ev.ms}ms)`);
				if (ev.error) lines.push(ev.error);
				if (ev.output !== undefined) {
					try {
						lines.push(typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output, null, 2));
					} catch {
						lines.push(String(ev.output));
					}
				}
				break;
			case 'step':
				lines.push(
					`--- step ${ev.step}${ev.toolNames?.length ? ` [${ev.toolNames.join(', ')}]` : ''} ---`
				);
				if (ev.text) lines.push(ev.text);
				if (ev.usage) {
					lines.push(
						`usage in=${ev.usage.inputTokens ?? '—'} out=${ev.usage.outputTokens ?? '—'} cached=${ev.usage.cachedTokens ?? '—'}`
					);
				}
				break;
			case 'steward':
				lines.push('--- steward ---');
				for (const n of ev.notes) lines.push(`${n.level} ${n.code}: ${n.text}`);
				break;
			case 'assistant_text':
				lines.push('--- assistant ---');
				lines.push(ev.text);
				break;
			case 'usage':
				lines.push(
					`usage in=${ev.usage.inputTokens ?? '—'} out=${ev.usage.outputTokens ?? '—'} cached=${ev.usage.cachedTokens ?? '—'} think=${ev.usage.thinkingTokens ?? '—'}`
				);
				break;
			case 'turn_end':
				lines.push(`=== turn end ${ev.status}${ev.error ? `: ${ev.error}` : ''} ${ev.at} ===`);
				break;
		}
		lines.push('');
	}
	const text = lines.join('\n').trimEnd() + '\n';
	return clipText(text, MAX_TRANSCRIPT_CHARS);
}

function asUsage(raw: unknown): HarnessUsage | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const u = raw as Record<string, unknown>;
	const sdk = extractSdkUsage(raw);
	const usage: HarnessUsage = {
		inputTokens: sdk.inputTokens,
		outputTokens: sdk.outputTokens,
		cachedTokens: sdk.cachedTokens ?? num(u.cachedTokens),
		thinkingTokens: sdk.thinkingTokens ?? num(u.thinkingTokens)
	};
	if (
		usage.inputTokens == null &&
		usage.outputTokens == null &&
		usage.cachedTokens == null &&
		usage.thinkingTokens == null
	) {
		return undefined;
	}
	return usage;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export class HarnessSession {
	readonly id: string;
	readonly meta: Required<Pick<HarnessMeta, 'agent'>> & HarnessMeta;
	status: HarnessStatus = 'running';
	error?: string;
	readonly events: HarnessEvent[] = [];
	readonly createdAt: string;
	private lastSystem = '';
	private stepCount = 0;
	private truncated = false;
	private ended = false;
	private lastStewardKey = '';

	constructor(meta: HarnessMeta) {
		this.id = randomUUID();
		this.meta = { ...meta, agent: meta.agent, surface: meta.surface ?? 'batch' };
		this.createdAt = new Date().toISOString();
	}

	append(event: HarnessEvent): void {
		if (this.truncated) return;
		if (this.events.length >= MAX_EVENTS) {
			this.events.push({
				type: 'assistant_text',
				text: `[harness] further events omitted (cap ${MAX_EVENTS})`
			});
			this.truncated = true;
			return;
		}
		this.events.push(event);
	}

	captureRequest(options: {
		system?: unknown;
		prompt?: unknown;
		messages?: unknown;
	}): void {
		this.append({ type: 'turn_start', at: this.createdAt });
		if (typeof options.system === 'string' && options.system) {
			const text = clipText(options.system, MAX_SYSTEM_CHARS);
			this.lastSystem = text;
			this.append({ type: 'system', text, source: 'request' });
		}
		if (typeof options.prompt === 'string' && options.prompt) {
			this.append({ type: 'prompt', text: clipText(options.prompt, MAX_SYSTEM_CHARS) });
		}
		if (Array.isArray(options.messages)) {
			for (const msg of options.messages) {
				if (!msg || typeof msg !== 'object') continue;
				const m = msg as Record<string, unknown>;
				this.append({
					type: 'message',
					role: String(m.role ?? 'unknown'),
					content: sanitizeVisible(m.content)
				});
			}
		}
	}

	capturePrepareStep(next: unknown): void {
		if (!next || typeof next !== 'object') return;
		const n = next as Record<string, unknown>;
		if (typeof n.system === 'string' && n.system && n.system !== this.lastSystem) {
			const text = clipText(n.system, MAX_SYSTEM_CHARS);
			this.lastSystem = text;
			this.append({ type: 'system', text, source: 'prepare_step' });
		}
	}

	recordToolCall(name: string, input: unknown): void {
		this.append({
			type: 'tool_call',
			name,
			input: sanitizeVisible(input),
			at: new Date().toISOString()
		});
	}

	recordToolResult(name: string, output: unknown, ms: number, ok: boolean, error?: string): void {
		this.append({
			type: 'tool_result',
			name,
			output: ok ? sanitizeVisible(output) : undefined,
			error: error ? clipText(error, 4_000) : undefined,
			ok,
			ms
		});
	}

	recordStep(event: {
		text?: string;
		toolCalls?: Array<{ toolName?: string }>;
		usage?: unknown;
	}): void {
		this.stepCount += 1;
		const text = typeof event.text === 'string' ? event.text.trim() : '';
		this.append({
			type: 'step',
			step: this.stepCount,
			text: text ? clipText(text, 8_000) : undefined,
			toolNames: event.toolCalls?.map((t) => String(t.toolName ?? '')).filter(Boolean),
			usage: asUsage(event.usage)
		});
	}

	recordAssistantText(text: string | undefined): void {
		const t = (text ?? '').trim();
		if (!t) return;
		const clipped = clipText(t, 32_000);
		const last = this.events[this.events.length - 1];
		if (last?.type === 'assistant_text' && last.text === clipped) return;
		this.append({ type: 'assistant_text', text: clipped });
	}

	recordUsage(raw: unknown): void {
		const usage = asUsage(raw);
		if (usage) this.append({ type: 'usage', usage });
	}

	recordSteward(notes: Array<{ level: 'warn' | 'block'; code: string; text: string }>): void {
		if (!notes.length) return;
		const key = notes.map((n) => `${n.level}:${n.code}`).join('|');
		if (key === this.lastStewardKey) return;
		this.lastStewardKey = key;
		this.append({ type: 'steward', notes, at: new Date().toISOString() });
	}

	currentSystem(): string {
		return this.lastSystem;
	}

	stepIndex(): number {
		return this.stepCount;
	}

	finish(status: HarnessStatus, error?: unknown): void {
		if (this.ended) {
			// A later onFinish must not hide abort/failure from an earlier callback.
			if (status === 'failed' || status === 'aborted') {
				this.status = status;
				if (error) this.error = errMsg(error);
			}
			return;
		}
		this.ended = true;
		this.status = status;
		if (error) this.error = errMsg(error);
		this.append({
			type: 'turn_end',
			status,
			error: this.error,
			at: new Date().toISOString()
		});
	}

	systemPrompt(): string | null {
		const first = this.events.find((e): e is Extract<HarnessEvent, { type: 'system' }> => e.type === 'system');
		return first?.text ?? null;
	}

	transcript(): string {
		const head = [
			`agent=${this.meta.agent}`,
			`mode=${this.meta.mode ?? ''}`,
			`surface=${this.meta.surface ?? 'batch'}`,
			`model=${this.meta.model ?? ''}`,
			`provider=${this.meta.provider ?? ''}`,
			`id=${this.id}`
		].join(' ');
		return `=== SESSION ${head} ===\n\n${renderTranscript(this.events)}`;
	}
}

function errMsg(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createHarnessSession(meta: HarnessMeta): HarnessSession {
	return new HarnessSession(meta);
}
