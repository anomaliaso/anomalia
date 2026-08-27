import type { SupabaseClient } from '@supabase/supabase-js';

export type MintStandaloneImageArgs = {
	supabase: SupabaseClient;
	userId: string;
	brandId: string;
	tz?: string;
	prompt: string;
	aspect_ratio?: '1:1' | '4:5' | '9:16' | '16:9';
	media_ids?: string[];
	people_ids?: string[];
	talent_ids?: string[];
	referenceUrls?: string[];
	hint: string;
};

/**
 * Mint a Nano Banana Pro still as a reusable https URL. Never writes a post or motion row —
 * the caller puts the URL into graphic HTML or Remotion TSX.
 */
export async function mintStandaloneImage(args: MintStandaloneImageArgs) {
	const { remaining } = await import('$lib/server/usage');
	const { data: brand } = await args.supabase
		.from('brands')
		.select('plan, timezone, activated_at, status')
		.eq('id', args.brandId)
		.maybeSingle();
	const tz = args.tz ?? (brand?.timezone as string | undefined) ?? 'Europe/Rome';
	const budget = await remaining(
		args.supabase,
		args.brandId,
		brand?.plan as string | null,
		tz,
		brand
			? {
					id: args.brandId,
					plan: brand.plan ?? null,
					activated_at: brand.activated_at ?? null,
					status: brand.status ?? 'active'
				}
			: undefined
	);
	if (budget.credits.remaining <= 0) {
		return {
			error: 'credits_exhausted',
			message:
				'AI credits for this billing period are exhausted. Explain the limit and do not retry generation.',
			quota: budget.credits.quota,
			used: budget.credits.used,
			remaining: budget.credits.remaining
		};
	}

	const { resolvePeopleVisualRefs, resolveTalentVisualRefs } = await import(
		'$lib/server/design-visual-refs'
	);
	const peopleTalent = [
		...(await resolvePeopleVisualRefs(args.supabase, args.brandId, args.people_ids)).map((r) => r.url),
		...(await resolveTalentVisualRefs(args.supabase, args.talent_ids)).map((r) => r.url)
	];
	const referenceUrls = [...peopleTalent, ...(args.referenceUrls ?? [])]
		.filter((u) => typeof u === 'string' && !!u)
		.slice(0, 4);

	const { generateStandaloneImage } = await import('$lib/server/content-preview');
	try {
		const gen = await generateStandaloneImage({
			supabase: args.supabase,
			userId: args.userId,
			brandId: args.brandId,
			prompt: args.prompt,
			aspectRatio: args.aspect_ratio,
			mediaIds: args.media_ids,
			referenceUrls
		});
		if (!gen.imageUrl) return { error: 'Image generation failed' };
		return {
			success: true,
			image_url: gen.imageUrl,
			did_not_change_post: true,
			notes: gen.notes,
			qc_score: gen.qc?.score,
			qc_pass: gen.qc?.pass,
			hint: args.hint
		};
	} catch (e) {
		return { error: e instanceof Error ? e.message : 'generate_failed' };
	}
}
