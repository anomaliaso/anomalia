/**
 * The release of the build that is running, as `<semver>+<commit>` — the same
 * tag `svelte.config.js` hands to `$app/environment`, composed here from the
 * same two inputs.
 *
 * It is NOT read from `$app/environment`: no module under `src/lib/server/`
 * imports it, because that would make this file untestable. Both sides derive
 * the tag from `formatRelease`, so the two cannot drift in shape — only in
 * timing (Kit bakes its value at build; this one reads the commit at runtime;
 * on Vercel they are the same value).
 *
 * `APP_RELEASE` overrides everything for self-hosted or scripted runs. Without
 * a tag a sample cannot be attributed to a change, so the fallback is a loud
 * `dev`, never null.
 */
import { env } from '$env/dynamic/private';
import { formatRelease } from '$lib/release';
// Only `version` is read. JSON imports are enabled (tsconfig `resolveJsonModule`)
// and the named import lets the bundler drop the rest of the manifest.
import { version as pkgVersion } from '../../../package.json';

export function releaseTag(): string {
  const explicit = String(env.APP_RELEASE ?? '').trim();
  if (explicit) return explicit.slice(0, 60);
  const commit = String(env.VERCEL_GIT_COMMIT_SHA ?? '').trim().slice(0, 12);
  return formatRelease(pkgVersion, commit || 'dev');
}
