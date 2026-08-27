import { describe, expect, it } from 'vitest';
import {
  GITHUB_REPO_LIMIT,
  githubNeedsRepoSelection,
  parseGithubRepoFullName,
  parseGithubRepoSelection
} from './github-repos';

describe('github repo selection', () => {
  it('accepts owner/name and rejects junk', () => {
    expect(parseGithubRepoFullName('acme/app')).toBe('acme/app');
    expect(parseGithubRepoFullName('  acme/app  ')).toBe('acme/app');
    expect(parseGithubRepoFullName('acme')).toBeNull();
    expect(parseGithubRepoFullName('../etc/passwd')).toBeNull();
    expect(parseGithubRepoFullName('https://github.com/acme/app')).toBeNull();
  });

  it('keeps unique valid names and caps at the limit', () => {
    const many = Array.from({ length: GITHUB_REPO_LIMIT + 4 }, (_, i) => `acme/repo-${i}`);
    expect(parseGithubRepoSelection({ repos: ['acme/app', 'acme/app', 'nope', 'acme/api'] })).toEqual([
      'acme/app',
      'acme/api'
    ]);
    expect(parseGithubRepoSelection({ repos: many })).toHaveLength(GITHUB_REPO_LIMIT);
    expect(parseGithubRepoSelection(null)).toEqual([]);
    expect(parseGithubRepoSelection({})).toEqual([]);
    expect(githubNeedsRepoSelection({ repos: [] })).toBe(true);
    expect(githubNeedsRepoSelection({ repos: ['acme/app'] })).toBe(false);
  });
});
