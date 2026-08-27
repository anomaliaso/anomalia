/**
 * Release identity — one definition of "which build is this", shared by the app and the benchmark.
 *
 * TWO THINGS, ONE STRING. A release tag is `<semver>+<build>`, e.g. `0.2.0+a1b2c3d4e5f6`:
 *   - `0.2.0`        the HUMAN version. Says how big the change is. Bumped deliberately by a
 *                    person (`npm run release`), because "is this a minor or a major" is a
 *                    judgement no script can make honestly.
 *   - `a1b2c3d4e5f6` the BUILD identity. Says which exact code is running. Automatic, from the
 *                    commit SHA, never collides, never needs maintenance.
 *
 * The `+build` suffix is not an invention: semver reserves it for exactly this (build metadata).
 *
 * ORDERING — read this before plotting anything. Semver deliberately says build metadata is NOT
 * ordered, and this module honours that: two builds of the same version compare EQUAL. That is
 * correct, not a gap — SHAs carry no chronology, so nothing here can invent one. To order builds
 * within a version, sort by time at the call site (for benchmark samples: the earliest `sampled_at`
 * seen for that release).
 *
 * No framework imports on purpose. Every module under `src/lib/server/` in this repo stays free of
 * `$app/environment` so it can be unit-tested, and this is imported from there.
 */

/** Stand-in version for a tag with no semver part (legacy sha-only samples, `dev`). Sorts first. */
export const UNVERSIONED = '0.0.0';

export type Release = {
  /** Semver `major.minor.patch`. `UNVERSIONED` when the tag carries no version. */
  version: string;
  /** Commit SHA (or `dev`). Null when the tag is a bare version. */
  build: string | null;
  /** The tag exactly as stored. */
  raw: string;
};

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** True for a plain `major.minor.patch`. Pre-release suffixes are not used in this repo. */
export function isSemver(v: string): boolean {
  return SEMVER_RE.test(v.trim());
}

/** Compose a release tag. A missing build is allowed — the version alone is still a valid tag. */
export function formatRelease(version: string, build?: string | null): string {
  const v = String(version ?? '').trim() || UNVERSIONED;
  const b = String(build ?? '').trim();
  return b ? `${v}+${b}` : v;
}

/**
 * Split a stored tag back into its parts. Total: any string produces a `Release` rather than
 * throwing, because this runs over historical rows written before the convention existed.
 */
export function parseRelease(raw: string | null | undefined): Release {
  const text = String(raw ?? '').trim();
  if (!text) return { version: UNVERSIONED, build: null, raw: '' };

  const plus = text.indexOf('+');
  if (plus > 0) {
    const version = text.slice(0, plus).trim();
    const build = text.slice(plus + 1).trim();
    return {
      version: isSemver(version) ? version : UNVERSIONED,
      build: build || null,
      raw: text
    };
  }

  // No separator: either a bare version, or a legacy sha-only tag.
  return isSemver(text)
    ? { version: text, build: null, raw: text }
    : { version: UNVERSIONED, build: text, raw: text };
}

function versionParts(version: string): [number, number, number] {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Order two releases by their semver part only. Returns 0 for different builds of the same version
 * — see the ordering note in the module header; break those ties by time, not by string.
 */
export function compareReleases(a: string | Release, b: string | Release): number {
  const ra = typeof a === 'string' ? parseRelease(a) : a;
  const rb = typeof b === 'string' ? parseRelease(b) : b;
  const pa = versionParts(ra.version);
  const pb = versionParts(rb.version);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Sort tags oldest-version first. Stable, so same-version builds keep the caller's order — pass
 * them already ordered by time if that matters.
 */
export function sortReleases(tags: string[]): string[] {
  return [...tags].sort(compareReleases);
}

export type BumpKind = 'major' | 'minor' | 'patch';

/** Next version for a bump. Used by `scripts/release.mjs`; pure so it can be tested. */
export function bumpVersion(version: string, kind: BumpKind): string {
  const [major, minor, patch] = versionParts(version);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Short human label for a UI badge: `v0.2.0 (a1b2c3)`. */
export function releaseLabel(raw: string | null | undefined): string {
  const r = parseRelease(raw);
  const version = r.version === UNVERSIONED ? '' : `v${r.version}`;
  const build = r.build ? `(${r.build.slice(0, 7)})` : '';
  return [version, build].filter(Boolean).join(' ') || 'unknown';
}
