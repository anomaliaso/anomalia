import { describe, expect, it } from 'vitest';
import {
	MOTION_SLICE_MAX_STEPS,
	mergeDesignerSliceEnd,
	shouldContinueDesignerSlice
} from './designer-limits';

describe('shouldContinueDesignerSlice', () => {
	it('stops when the model called finish even if the clock ran out', () => {
		expect(
			shouldContinueDesignerSlice({
				finished: true,
				steps: MOTION_SLICE_MAX_STEPS,
				timedOut: true
			})
		).toBe(false);
	});

	it('stops when finish is a done tool chip', () => {
		expect(
			shouldContinueDesignerSlice({
				finished: false,
				steps: 8,
				tools: [{ toolName: 'finish', status: 'done' }]
			})
		).toBe(false);
	});

	it('continues after a step-budget stop without finish', () => {
		expect(
			shouldContinueDesignerSlice({
				finished: false,
				steps: MOTION_SLICE_MAX_STEPS,
				timedOut: false
			})
		).toBe(true);
	});

	it('continues after a time-budget stop without finish', () => {
		expect(
			shouldContinueDesignerSlice({
				finished: false,
				steps: 12,
				timedOut: true
			})
		).toBe(true);
	});

	it('does not continue a short natural stop', () => {
		expect(
			shouldContinueDesignerSlice({
				finished: false,
				steps: 6,
				timedOut: false
			})
		).toBe(false);
	});

	it('treats a full tool bar without finish as a step-budget stop', () => {
		const merged = mergeDesignerSliceEnd(
			{ finished: false, steps: 0 },
			Array.from({ length: MOTION_SLICE_MAX_STEPS }, () => ({
				toolName: 'replace_source',
				status: 'done' as const
			}))
		);
		expect(
			shouldContinueDesignerSlice({
				...merged,
				timedOut: false
			})
		).toBe(true);
	});
});
