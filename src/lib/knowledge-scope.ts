import type { KnowledgeProvider } from '$lib/knowledge-providers';
import { driveNeedsFolderSelection } from '$lib/drive-folders';
import { githubNeedsRepoSelection } from '$lib/github-repos';
import { notionNeedsPageSelection } from '$lib/notion-pages';

export function connectorNeedsScope(provider: KnowledgeProvider, settings: unknown): boolean {
  if (provider === 'github') return githubNeedsRepoSelection(settings);
  if (provider === 'google-drive') return driveNeedsFolderSelection(settings);
  if (provider === 'notion') return notionNeedsPageSelection(settings);
  return false;
}

export function connectorScopeSyncError(provider: KnowledgeProvider): string | null {
  if (provider === 'github') return 'Pick which GitHub repositories belong to this brand before syncing.';
  if (provider === 'google-drive') return 'Pick which Drive files belong to this brand before syncing.';
  if (provider === 'notion') return 'Pick which Notion pages belong to this brand before syncing.';
  return null;
}
