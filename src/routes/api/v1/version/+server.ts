import { json } from '@sveltejs/kit';
import { parseRelease } from '$lib/release';
import { releaseTag } from '$lib/server/release-tag';

export const GET = () => {
  const { version, build } = parseRelease(releaseTag());
  return json({ version, build, release: releaseTag() });
};
