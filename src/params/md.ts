import type { ParamMatcher } from '@sveltejs/kit';

// Gates the [...path=md] markdown mirror: only paths ending in .md reach it, so every other
// unknown URL keeps falling through to SvelteKit's normal 404 page instead of our endpoint.
export const match: ParamMatcher = (param) => param.endsWith('.md');
