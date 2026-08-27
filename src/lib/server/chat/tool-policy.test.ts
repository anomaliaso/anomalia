import { describe, expect, it } from 'vitest';
import { gateToolCall } from './tool-policy';
import type { Remaining } from '$lib/server/usage';

function budget(over: { posts?: number; credits?: number } = {}): Remaining {
	const creditsRemaining = over.credits ?? 100;
	return {
		posts: over.posts ?? 10,
		videos: 5,
		postsUsed: 2,
		videosUsed: 0,
		postsQuota: 12,
		videosCap: 5,
		credits: {
			used: 100 - creditsRemaining,
			quota: 100,
			bonus: 0,
			remaining: creditsRemaining,
			percent: 100 - creditsRemaining,
			periodStart: new Date('2026-08-01T00:00:00Z'),
			periodEnd: new Date('2026-09-01T00:00:00Z')
		}
	};
}

describe('gateToolCall', () => {
	it('allows every gated tool when budget is open', () => {
		expect(gateToolCall('create_post', budget(), {})).toBeNull();
		expect(gateToolCall('generate_image', budget())).toBeNull();
		expect(gateToolCall('produce_week', budget())).toBeNull();
		expect(gateToolCall('create_campaign', budget())).toBeNull();
		expect(gateToolCall('youtube_thumbnail', budget())).toBeNull();
	});

	it('denies with the canonical posts result when the post quota is gone', () => {
		const denial = gateToolCall('create_post', budget({ posts: 0 }), {});
		expect(denial).toMatchObject({
			error: 'posts_quota_exhausted',
			action: 'offer_upgrade',
			postsUsed: 2,
			postsQuota: 12,
			remaining: 0
		});
	});

	it('denies with the canonical credits result when credits are gone', () => {
		const denial = gateToolCall('generate_image', budget({ credits: 0 }));
		expect(denial).toMatchObject({
			error: 'credits_exhausted',
			action: 'offer_upgrade',
			quota: 100,
			used: 100,
			remaining: 0,
			resetDate: '2026-09-01T00:00:00.000Z'
		});
	});

	it('create_post without credits stays open on the free paths', () => {
		const b = budget({ credits: 0 });
		expect(gateToolCall('create_post', b, { graphic_brief: 'typographic quote' })).toBeNull();
		expect(
			gateToolCall('create_post', b, { media_ids: ['m1'], media_mode: 'use_as_is' })
		).toBeNull();
	});

	it('create_post use_as_is on a carousel still mints slides, so it is not free', () => {
		const denial = gateToolCall('create_post', budget({ credits: 0 }), {
			content_type: 'carousel',
			media_ids: ['m1'],
			media_mode: 'use_as_is'
		});
		expect(denial).toMatchObject({ error: 'credits_exhausted' });
	});

	it('create_post checks the post quota before credits', () => {
		const denial = gateToolCall('create_post', budget({ posts: 0, credits: 0 }), {});
		expect(denial).toMatchObject({ error: 'posts_quota_exhausted' });
	});

	it('produce_week and create_campaign gate on both quotas', () => {
		expect(gateToolCall('produce_week', budget({ posts: 0 }))).toMatchObject({
			error: 'posts_quota_exhausted'
		});
		expect(gateToolCall('produce_week', budget({ credits: 0 }))).toMatchObject({
			error: 'credits_exhausted'
		});
		expect(gateToolCall('create_campaign', budget({ posts: 0 }))).toMatchObject({
			error: 'posts_quota_exhausted'
		});
		expect(gateToolCall('create_campaign', budget({ credits: 0 }))).toMatchObject({
			error: 'credits_exhausted'
		});
	});

	it('youtube_thumbnail gates on credits only, with the canonical shape', () => {
		expect(gateToolCall('youtube_thumbnail', budget({ posts: 0 }))).toBeNull();
		expect(gateToolCall('youtube_thumbnail', budget({ credits: 0 }))).toMatchObject({
			error: 'credits_exhausted',
			action: 'offer_upgrade'
		});
	});
});
