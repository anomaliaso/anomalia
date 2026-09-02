import type { Remaining } from '$lib/server/usage';

export type ToolGateDenial = Record<string, unknown> & {
	error: 'credits_exhausted' | 'posts_quota_exhausted';
	message: string;
	action: 'offer_upgrade';
};

export function creditsExhaustedResult(budget: Remaining): ToolGateDenial {
	return {
		error: 'credits_exhausted',
		message:
			'AI credits for this billing period are exhausted. Explain the limit clearly, call offer_upgrade, and do not retry generation.',
		action: 'offer_upgrade',
		resetDate: budget.credits.periodEnd.toISOString(),
		quota: budget.credits.quota,
		used: budget.credits.used,
		remaining: budget.credits.remaining
	};
}

export function postsQuotaExhaustedResult(budget: Remaining): ToolGateDenial {
	return {
		error: 'posts_quota_exhausted',
		message:
			'Monthly post quota reached. Explain the limit clearly, call offer_upgrade, and do not create more posts.',
		action: 'offer_upgrade',
		postsUsed: budget.postsUsed,
		postsQuota: budget.postsQuota,
		remaining: budget.posts
	};
}

const posts = (b: Remaining) => (b.posts <= 0 ? postsQuotaExhaustedResult(b) : null);
const credits = (b: Remaining) => (b.credits.remaining <= 0 ? creditsExhaustedResult(b) : null);

export type CreatePostGateInput = {
	content_type?: string;
	media_mode?: string;
	media_ids?: string[];
	graphic_brief?: string;
};

function createPostMintsImages(input: CreatePostGateInput): boolean {
	const carouselCoercesUseAsIsToComposite =
		input.content_type === 'carousel' && input.media_mode === 'use_as_is';
	const effectiveMediaMode = carouselCoercesUseAsIsToComposite ? 'composite' : input.media_mode;
	const reusesLibraryPixelPerfect = !!input.media_ids?.length && effectiveMediaMode === 'use_as_is';
	const buildsTypographicGraphic = !!input.graphic_brief;
	return !buildsTypographicGraphic && !reusesLibraryPixelPerfect;
}

const TOOL_GATES: Record<
	| 'create_post'
	| 'generate_image'
	| 'produce_week'
	| 'create_campaign'
	| 'youtube_thumbnail'
	| 'refine_video'
	| 'motion_control_video',
	(budget: Remaining, input?: CreatePostGateInput) => ToolGateDenial | null
> = {
	create_post: (b, input = {}) => posts(b) ?? (createPostMintsImages(input) ? credits(b) : null),
	generate_image: credits,
	produce_week: (b) => posts(b) ?? credits(b),
	create_campaign: (b) => posts(b) ?? credits(b),
	youtube_thumbnail: credits,
	// Entrambi spendono crediti e nessuno dei due crea un post: non toccano la quota mensile.
	refine_video: credits,
	motion_control_video: credits
};

export function gateToolCall(
	tool: keyof typeof TOOL_GATES,
	budget: Remaining,
	input?: CreatePostGateInput
): ToolGateDenial | null {
	return TOOL_GATES[tool](budget, input);
}
