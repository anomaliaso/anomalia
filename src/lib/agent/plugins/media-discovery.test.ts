import { describe, expect, it } from 'vitest';
import { createContentPlugin } from './content';
import { createUgcPlugin } from './ugc';

const deps = { supabase: {} as never, brandId: 'b1', userId: 'u1' };

describe('a trade that takes media_ids can find them', () => {
	it('every trade whose tools accept media_ids can also list the library', () => {
		// content_create_post's own description says "MEDIA FIRST: pass media_ids to reuse a library
		// asset instead of minting a new AI image (free)". Without a way to LIST the library that
		// rule cannot be followed — the agent has nowhere to get an id, so it generates every time
		// and the brand pays for a photo it already owns.
		for (const [trade, make] of [['content', createContentPlugin], ['ugc', createUgcPlugin]] as const) {
			const names = make(deps).tools.map((t) => t.name);
			const takesMediaIds = names.some((n) =>
				['content_create_post', 'ugc_generate_video', 'create_post_from_asset'].includes(n)
			);
			expect(takesMediaIds, `${trade} accepts media_ids`).toBe(true);
			expect(names, `${trade} can list the library`).toContain('read_media');
		}
	});

	it('and can turn a library asset into a durable url', () => {
		// read_media returns ids; putting one inside a graphic or a Remotion composition needs a
		// signed url that outlives the turn. Listing without this is half the capability.
		expect(createContentPlugin(deps).tools.map((t) => t.name)).toContain('use_library_image');
	});
});
