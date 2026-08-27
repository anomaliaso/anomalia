import { error } from '@sveltejs/kit';
import { findPreset } from '$lib/design/presets';
import type { PageLoad } from './$types';

// Only the slug crosses the SSR boundary: a preset carries its `build` function, and a function
// cannot be serialised into the page payload. The component looks the preset up itself.
export const load: PageLoad = ({ params }) => {
  if (!findPreset(params.slug)) error(404, 'Style not found');
  return { slug: params.slug };
};
