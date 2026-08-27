/** Client-safe GitHub repo selection (owner/name) for a brand. */

export const GITHUB_REPO_LIMIT = 8;

export type GithubRepoOption = { fullName: string; htmlUrl: string; pushedAt: string | null };

export function parseGithubRepoFullName(raw: string): string | null {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) return null;
  return name;
}

export function parseGithubRepoSelection(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const repos = (settings as { repos?: unknown }).repos;
  if (!Array.isArray(repos)) return [];
  const unique: string[] = [];
  for (const raw of repos) {
    if (typeof raw !== 'string') continue;
    const name = parseGithubRepoFullName(raw);
    if (!name || unique.includes(name)) continue;
    unique.push(name);
    if (unique.length >= GITHUB_REPO_LIMIT) break;
  }
  return unique;
}

export function githubNeedsRepoSelection(settings: unknown): boolean {
  return parseGithubRepoSelection(settings).length === 0;
}
