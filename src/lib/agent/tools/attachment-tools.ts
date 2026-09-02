import { tool } from 'ai';
import { z } from 'zod';
import {
	ATTACH_READ_DEFAULT_CHARS,
	ATTACH_READ_MAX_CHARS,
	matchTurnDocument,
	summarizeAttachmentMarkdown,
	type ChatDocument
} from '$lib/chat-documents';
import { grepSource, sliceSource } from '$lib/motion-video/source-ops';

function names(docs: ChatDocument[]): string {
	return docs.map((d) => d.name).join(', ');
}

function resolveDoc(
	docs: ChatDocument[],
	file: string | undefined
): ChatDocument | { error: string } {
	if (!docs.length) return { error: 'No files attached this turn.' };
	if (docs.length === 1 && !file?.trim()) return docs[0];
	if (!file?.trim()) {
		return { error: `Multiple files attached. Pass file as one of: ${names(docs)}` };
	}
	const d = matchTurnDocument(docs, file);
	if (!d) {
		return {
			error: `No attached file matching "${file}". Available: ${names(docs) || '(none)'}`
		};
	}
	return d;
}

export function createAttachmentTools(turnDocuments: ChatDocument[]) {
	return {
		summarize_attachment: tool({
			description:
				'Map a file the user attached this turn: headings with char indexes plus a short excerpt per section. Not an LLM summary. Then grep_attachment / read_attachment for the parts you need. Omit file when only one file is attached.',
			inputSchema: z.object({
				file: z.string().optional().describe('Filename (exact or unique suffix)')
			}),
			execute: async ({ file }) => {
				const d = resolveDoc(turnDocuments, file);
				if ('error' in d) return d;
				return {
					file: d.name,
					title: d.title ?? null,
					...summarizeAttachmentMarkdown(d.markdown),
					hint: `read_attachment start_from = heading index, max_chars ≤ ${ATTACH_READ_MAX_CHARS}. grep_attachment to locate a phrase.`
				};
			}
		}),

		grep_attachment: tool({
			description:
				'Find a word or snippet in a file the user attached this turn. Returns char indexes for read_attachment. Literal match by default. Omit file to search every attached file.',
			inputSchema: z.object({
				query: z.string().min(1).max(500),
				file: z.string().optional().describe('Filename; omit to search all attached files'),
				regex: z.boolean().optional(),
				ignore_case: z.boolean().optional()
			}),
			execute: async ({ query, file, regex, ignore_case }) => {
				if (!turnDocuments.length) return { error: 'No files attached this turn.' };
				const opts = { regex: regex === true, ignoreCase: ignore_case === true };
				const targets = file?.trim()
					? (() => {
							const d = resolveDoc(turnDocuments, file);
							return 'error' in d ? d : [d];
						})()
					: turnDocuments;
				if (!Array.isArray(targets)) return targets;
				try {
					const files = targets.map((d) => ({
						file: d.name,
						...grepSource(d.markdown, query, opts)
					}));
					return { query, files };
				} catch (e) {
					return { error: e instanceof Error ? e.message : String(e) };
				}
			}
		}),

		read_attachment: tool({
			description: `Read a slice of a file the user attached this turn. Default ${ATTACH_READ_DEFAULT_CHARS} chars from start_from (0-based char index from grep_attachment / summarize_attachment). If next_start is set, call again. Cap ${ATTACH_READ_MAX_CHARS}. Never dump the whole file.`,
			inputSchema: z.object({
				file: z.string().optional().describe('Filename; required when several files are attached'),
				start_from: z.number().int().min(0).optional(),
				max_chars: z.number().int().min(1).max(ATTACH_READ_MAX_CHARS).optional()
			}),
			execute: async ({ file, start_from, max_chars }) => {
				const d = resolveDoc(turnDocuments, file);
				if ('error' in d) return d;
				const page = sliceSource(
					d.markdown,
					start_from ?? 0,
					max_chars ?? ATTACH_READ_DEFAULT_CHARS,
					ATTACH_READ_MAX_CHARS
				);
				return {
					file: d.name,
					title: d.title ?? null,
					...page
				};
			}
		})
	};
}
