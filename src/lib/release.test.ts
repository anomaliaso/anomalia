import { describe, expect, it } from 'vitest';
import {
  UNVERSIONED,
  bumpVersion,
  compareReleases,
  formatRelease,
  isSemver,
  parseRelease,
  releaseLabel,
  sortReleases
} from './release';

describe('formatRelease', () => {
  it('composes version + build', () => {
    expect(formatRelease('0.2.0', 'a1b2c3')).toBe('0.2.0+a1b2c3');
  });

  it('allows a bare version when there is no build', () => {
    expect(formatRelease('0.2.0')).toBe('0.2.0');
    expect(formatRelease('0.2.0', null)).toBe('0.2.0');
    expect(formatRelease('0.2.0', '   ')).toBe('0.2.0');
  });

  it('falls back to the unversioned stand-in for an empty version', () => {
    expect(formatRelease('', 'a1b2c3')).toBe(`${UNVERSIONED}+a1b2c3`);
  });
});

describe('parseRelease', () => {
  it('splits a full tag', () => {
    expect(parseRelease('0.2.0+a1b2c3')).toEqual({ version: '0.2.0', build: 'a1b2c3', raw: '0.2.0+a1b2c3' });
  });

  it('reads a bare version', () => {
    expect(parseRelease('1.4.2')).toEqual({ version: '1.4.2', build: null, raw: '1.4.2' });
  });

  it('treats a legacy sha-only tag as an unversioned build', () => {
    // Samples written before the convention existed carry just the SHA.
    expect(parseRelease('a1b2c3d4e5f6')).toEqual({
      version: UNVERSIONED,
      build: 'a1b2c3d4e5f6',
      raw: 'a1b2c3d4e5f6'
    });
  });

  it('treats the local dev tag as an unversioned build', () => {
    expect(parseRelease('dev').build).toBe('dev');
    expect(parseRelease('dev').version).toBe(UNVERSIONED);
  });

  it('never throws on junk — it runs over historical rows', () => {
    expect(parseRelease(null).version).toBe(UNVERSIONED);
    expect(parseRelease(undefined).raw).toBe('');
    expect(parseRelease('   ').raw).toBe('');
    expect(parseRelease('not+a+version').version).toBe(UNVERSIONED);
  });

  it('ignores a non-semver prefix rather than trusting it', () => {
    expect(parseRelease('banana+a1b2c3').version).toBe(UNVERSIONED);
    expect(parseRelease('banana+a1b2c3').build).toBe('a1b2c3');
  });
});

describe('isSemver', () => {
  it('accepts plain major.minor.patch', () => {
    expect(isSemver('0.0.0')).toBe(true);
    expect(isSemver('12.4.99')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSemver('1.4')).toBe(false);
    expect(isSemver('v1.4.0')).toBe(false);
    expect(isSemver('1.4.0-beta')).toBe(false);
    expect(isSemver('')).toBe(false);
  });
});

describe('compareReleases', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareReleases('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareReleases('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareReleases('1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('compares numerically, not as strings', () => {
    // The classic trap: "10" sorts before "9" lexicographically.
    expect(compareReleases('0.10.0', '0.9.0')).toBeGreaterThan(0);
  });

  it('treats two builds of the same version as equal', () => {
    // Semver says build metadata carries no order, and a SHA carries no chronology.
    expect(compareReleases('0.2.0+aaa', '0.2.0+zzz')).toBe(0);
  });

  it('sorts unversioned legacy tags before every real version', () => {
    expect(compareReleases('a1b2c3', '0.1.0')).toBeLessThan(0);
  });
});

describe('sortReleases', () => {
  it('orders oldest version first', () => {
    expect(sortReleases(['1.2.0+c', '0.9.0+a', '1.10.0+d', '1.3.0+b'])).toEqual([
      '0.9.0+a',
      '1.2.0+c',
      '1.3.0+b',
      '1.10.0+d'
    ]);
  });

  it('is stable for same-version builds, so a time-ordered input keeps its order', () => {
    expect(sortReleases(['0.2.0+first', '0.2.0+second', '0.2.0+third'])).toEqual([
      '0.2.0+first',
      '0.2.0+second',
      '0.2.0+third'
    ]);
  });

  it('does not mutate the input', () => {
    const input = ['1.0.0', '0.1.0'];
    sortReleases(input);
    expect(input).toEqual(['1.0.0', '0.1.0']);
  });
});

describe('bumpVersion', () => {
  it('bumps patch', () => {
    expect(bumpVersion('0.2.3', 'patch')).toBe('0.2.4');
  });

  it('bumps minor and resets patch', () => {
    expect(bumpVersion('0.2.3', 'minor')).toBe('0.3.0');
  });

  it('bumps major and resets minor and patch', () => {
    expect(bumpVersion('0.2.3', 'major')).toBe('1.0.0');
  });

  it('starts from 0.0.0 for an unparseable current version', () => {
    expect(bumpVersion('garbage', 'minor')).toBe('0.1.0');
  });
});

describe('releaseLabel', () => {
  it('renders a short badge', () => {
    expect(releaseLabel('0.2.0+a1b2c3d4e5f6')).toBe('v0.2.0 (a1b2c3d)');
  });

  it('shows just the build for a legacy tag', () => {
    expect(releaseLabel('a1b2c3d4e5f6')).toBe('(a1b2c3d)');
  });

  it('shows just the version for a bare version', () => {
    expect(releaseLabel('1.4.0')).toBe('v1.4.0');
  });

  it('degrades to unknown rather than an empty string', () => {
    expect(releaseLabel(null)).toBe('unknown');
    expect(releaseLabel('')).toBe('unknown');
  });
});
