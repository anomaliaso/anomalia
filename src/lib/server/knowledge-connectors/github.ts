/** GitHub README / changelog selection + content decode. */
import { providerGetJson, type ProviderAuth } from './provider-fetch';
import { parseGithubRepoFullName, type GithubRepoOption } from '$lib/github-repos';

export { GITHUB_REPO_LIMIT, parseGithubRepoFullName, parseGithubRepoSelection, githubNeedsRepoSelection } from '$lib/github-repos';

export const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28'
};

const DOC_NAMES = new Set([
  'readme.md',
  'readme',
  'changelog.md',
  'changelog',
  'history.md',
  'contributing.md',
  'code_of_conduct.md'
]);

export function isGithubDocPath(path: string): boolean {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (DOC_NAMES.has(base)) return true;
  if (path.toLowerCase().startsWith('docs/') && /\.(md|mdx|txt)$/i.test(path)) return true;
  return false;
}

export function decodeGithubFileContent(payload: unknown): { text: string; path: string; htmlUrl: string | null } | null {
  const o = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const encoding = String(o.encoding ?? '');
  const path = String(o.path ?? o.name ?? '');
  const htmlUrl = o.html_url ? String(o.html_url) : null;
  if (encoding === 'base64' && typeof o.content === 'string') {
    const buf = Buffer.from(o.content.replace(/\s/g, ''), 'base64');
    return { text: buf.toString('utf8').trim(), path, htmlUrl };
  }
  if (typeof o.content === 'string' && o.content.trim() && encoding !== 'base64') {
    return { text: o.content.trim(), path, htmlUrl };
  }
  return null;
}

export type GithubRepo = GithubRepoOption;

export function parseGithubRepos(data: unknown): GithubRepo[] {
  if (!Array.isArray(data)) return [];
  const out: GithubRepo[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const fullName = String(r.full_name ?? '').trim();
    if (!fullName) continue;
    out.push({
      fullName,
      htmlUrl: String(r.html_url ?? `https://github.com/${fullName}`),
      pushedAt: r.pushed_at ? String(r.pushed_at) : null
    });
  }
  return out;
}

export function parseGithubUser(data: unknown): string | null {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const login = String(o.login ?? '').trim();
  const name = String(o.name ?? '').trim();
  return name && login ? `${name} (@${login})` : login || name || null;
}

/** GitHub App `GET /installation` — account that installed the app. */
export function parseGithubInstallation(data: unknown): string | null {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const account = o.account && typeof o.account === 'object' ? (o.account as Record<string, unknown>) : {};
  const login = String(account.login ?? '').trim();
  if (!login) return null;
  const type = String(account.type ?? '').trim();
  return type === 'Organization' ? `${login} (org)` : login;
}

/** GitHub App `GET /installation/repositories` wraps repos in `{ repositories, total_count }`. */
export function parseGithubInstallationRepos(data: unknown): { repos: GithubRepo[]; totalCount: number } {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const repos = parseGithubRepos(o.repositories);
  const totalCount = Number(o.total_count);
  return {
    repos,
    totalCount: Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : repos.length
  };
}

async function listGithubInstallationRepos(auth: ProviderAuth): Promise<GithubRepo[] | null> {
  const out: GithubRepo[] = [];
  let totalCount = Infinity;
  for (let page = 1; page <= 5; page++) {
    const data = await providerGetJson(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      auth,
      GITHUB_HEADERS
    );
    if (data == null) return null;
    const parsed = parseGithubInstallationRepos(data);
    totalCount = parsed.totalCount;
    out.push(...parsed.repos);
    if (parsed.repos.length < 100 || out.length >= totalCount) break;
  }
  return out;
}

async function listGithubUserRepos(auth: ProviderAuth): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await providerGetJson(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`,
      auth,
      GITHUB_HEADERS
    );
    const batch = parseGithubRepos(data);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export async function listGithubRepos(auth: ProviderAuth): Promise<GithubRepo[]> {
  try {
    const installed = await listGithubInstallationRepos(auth);
    if (installed) return installed;
  } catch {
    // Installation tokens only. Leftover user-OAuth connections still use /user/repos.
  }
  return listGithubUserRepos(auth);
}

export async function githubConnectionLabel(auth: ProviderAuth): Promise<string | null> {
  try {
    const inst = await providerGetJson('https://api.github.com/installation', auth, GITHUB_HEADERS);
    const fromApp = parseGithubInstallation(inst);
    if (fromApp) return fromApp;
  } catch {
    // Installation tokens often cannot call /user.
  }
  try {
    const me = await providerGetJson('https://api.github.com/user', auth, GITHUB_HEADERS);
    return parseGithubUser(me);
  } catch {
    return null;
  }
}

export function githubFileExternalId(fullName: string, path: string): string {
  const repo = parseGithubRepoFullName(fullName) ?? fullName.trim();
  return `${repo}:${path}`;
}

export function githubRepoFromExternalId(externalId: string): string | null {
  const repo = externalId.split(':')[0] ?? '';
  return parseGithubRepoFullName(repo);
}
