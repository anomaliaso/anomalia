import { describe, expect, it, vi } from 'vitest';
import {
	insertMotionVideoPrompt,
	listMotionVideoPrompts,
	saveMotionVideo
} from './persist';

function mockFrom(handlers: {
	insert?: (row: Record<string, unknown>) => { data: unknown; error: null | { message: string } };
	list?: () => { data: unknown; error: null | { message: string } };
}) {
	return {
		from: (table: string) => {
			expect(table).toBe('motion_video_prompts');
			return {
				insert: (row: Record<string, unknown>) => ({
					select: () => ({
						single: async () => handlers.insert?.(row) ?? { data: null, error: { message: 'no insert' } }
					})
				}),
				select: () => ({
					eq: () => ({
						order: () => ({
							limit: async () => handlers.list?.() ?? { data: [], error: null }
						})
					})
				})
			};
		}
	};
}

describe('motion video prompt persist', () => {
	it('truncates prompts to 8000 chars and stores selected_count', async () => {
		const insert = vi.fn((row: Record<string, unknown>) => ({
			data: { id: 'p1' },
			error: null
		}));
		const supabase = mockFrom({ insert }) as never;
		const result = await insertMotionVideoPrompt(supabase, {
			brandId: 'b1',
			userId: 'u1',
			prompt: 'x'.repeat(9000),
			selectedCount: 2
		});
		expect(result).toEqual({ id: 'p1' });
		expect(insert).toHaveBeenCalledOnce();
		const row = insert.mock.calls[0][0];
		expect(row.prompt).toHaveLength(8000);
		expect(row.selected_count).toBe(2);
		expect(row.brand_id).toBe('b1');
		expect(row.user_id).toBe('u1');
	});

	it('lists newest-first prompt rows', async () => {
		const rows = [
			{
				id: 'p2',
				brand_id: 'b1',
				user_id: 'u1',
				prompt: 'later',
				selected_count: 0,
				created_at: '2026-08-13T12:00:00Z'
			},
			{
				id: 'p1',
				brand_id: 'b1',
				user_id: 'u1',
				prompt: 'earlier',
				selected_count: 1,
				created_at: '2026-08-12T12:00:00Z'
			}
		];
		const supabase = mockFrom({ list: () => ({ data: rows, error: null }) }) as never;
		const listed = await listMotionVideoPrompts(supabase, 'b1');
		expect(listed).toEqual(rows);
	});
});

/** Minimal supabase double for the saveMotionVideo update path. */
function mockSave(existing: { width: number; height: number }) {
	const updates: Record<string, unknown>[] = [];
	const supabase = {
		from: () => ({
			select: () => ({
				eq: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) })
				})
			}),
			update: (payload: Record<string, unknown>) => {
				updates.push(payload);
				return {
					eq: () => ({
						eq: () => ({
							select: () => ({
								maybeSingle: async () => ({ data: { id: 'v1', ...payload }, error: null })
							})
						})
					})
				};
			}
		})
	} as never;
	return { supabase, updates };
}

describe('saveMotionVideo preview invalidation', () => {
	const base = {
		brandId: 'b1',
		userId: 'u1',
		id: 'v1',
		title: 'T',
		source: 'export const width = 1;'
	};

	it('drops a preview encoded at the old canvas', async () => {
		const { supabase, updates } = mockSave({ width: 1080, height: 1920 });
		await saveMotionVideo(supabase, {
			...base,
			meta: { fps: 30, durationInFrames: 90, width: 1920, height: 1080 }
		});
		expect(updates[0].preview_url).toBeNull();
	});

	it('keeps the preview when the canvas is unchanged', async () => {
		const { supabase, updates } = mockSave({ width: 1080, height: 1920 });
		await saveMotionVideo(supabase, {
			...base,
			meta: { fps: 30, durationInFrames: 90, width: 1080, height: 1920 }
		});
		expect('preview_url' in updates[0]).toBe(false);
	});

	it('never clobbers a preview the caller passed explicitly', async () => {
		const { supabase, updates } = mockSave({ width: 1080, height: 1920 });
		await saveMotionVideo(supabase, {
			...base,
			meta: { fps: 30, durationInFrames: 90, width: 1920, height: 1080 },
			previewUrl: 'https://x.co/new.mp4'
		});
		expect(updates[0].preview_url).toBe('https://x.co/new.mp4');
	});
});
