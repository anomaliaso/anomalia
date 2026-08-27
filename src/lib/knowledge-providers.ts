/** Catalog of Composio-backed knowledge sources. Shared by UI + server. */

export const KNOWLEDGE_PROVIDERS = ['google-drive', 'notion', 'github', 'google-mail'] as const;
export type KnowledgeProvider = (typeof KNOWLEDGE_PROVIDERS)[number];

export type KnowledgeSourceType = 'drive' | 'notion' | 'github' | 'gmail';

export const SOURCE_TYPE_BY_PROVIDER: Record<KnowledgeProvider, KnowledgeSourceType> = {
  'google-drive': 'drive',
  notion: 'notion',
  github: 'github',
  'google-mail': 'gmail'
};

/**
 * The provider ids above are ours (they are in the `brand_knowledge_sources` check constraint);
 * Composio addresses the same services by toolkit slug.
 */
export const TOOLKIT_BY_PROVIDER: Record<KnowledgeProvider, string> = {
  'google-drive': 'GOOGLEDRIVE',
  notion: 'NOTION',
  github: 'GITHUB',
  'google-mail': 'GMAIL'
};

export function isKnowledgeProvider(v: string): v is KnowledgeProvider {
  return (KNOWLEDGE_PROVIDERS as readonly string[]).includes(v);
}

export function toolkitForProvider(provider: KnowledgeProvider): string {
  return TOOLKIT_BY_PROVIDER[provider];
}

export function providerForToolkit(toolkitSlug: string): KnowledgeProvider | null {
  const slug = toolkitSlug.trim().toUpperCase();
  for (const provider of KNOWLEDGE_PROVIDERS) {
    if (TOOLKIT_BY_PROVIDER[provider] === slug) return provider;
  }
  return null;
}

export function isConnectorSourceType(v: string | null | undefined): v is KnowledgeSourceType {
  return v === 'drive' || v === 'notion' || v === 'github' || v === 'gmail';
}
