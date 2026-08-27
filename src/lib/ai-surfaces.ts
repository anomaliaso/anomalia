import { siClaude, siDeepseek, siGoogle, siGooglegemini, siPerplexity } from 'simple-icons';
import {
  siExa,
  siGrok,
  siMicrosoftbing,
  siMicrosoftcopilot,
  siOpenai,
  type BrandIcon
} from '$lib/simple-icons-extra';

// The AI assistants and search engines shown on the pricing cards, next to the social platforms.
// Sibling of $lib/components/platform-meta (socials) — kept separate because these are surfaces
// the brand is MEASURED IN (GEO visibility), not channels we publish to.
//
// simple-icons dropped OpenAI / Bing over trademark; those paths live in simple-icons-extra
// (same shape as a SI entry). Copilot / Exa / Grok were never in SI — silhouette only.

export type AiSurfaceIcon = BrandIcon | { path: string; hex: string; title?: string };

export interface AiSurfaceInfo {
  label: string;
  /** Two/three-char fallback used when no mark is available. */
  short: string;
  bg: string;
  icon?: AiSurfaceIcon;
}

export const AI_SURFACE_META: Record<string, AiSurfaceInfo> = {
  // ChatGPT green for the chip tint (mark is the OpenAI blossom from Simple Icons).
  chatgpt: { label: 'ChatGPT', short: 'GPT', bg: '#10a37f', icon: { ...siOpenai, hex: '10A37F' } },
  // GEO audit engine id
  gpt: { label: 'GPT', short: 'GPT', bg: '#10a37f', icon: { ...siOpenai, hex: '10A37F' } },
  claude: { label: 'Claude', short: 'C', bg: '#d97757', icon: siClaude },
  gemini: { label: 'Gemini', short: 'GG', bg: '#8e75b2', icon: siGooglegemini },
  perplexity: { label: 'Perplexity', short: 'PX', bg: '#1fb8cd', icon: siPerplexity },
  copilot: { label: 'Microsoft Copilot', short: 'CP', bg: '#0078d4', icon: siMicrosoftcopilot },
  grok: { label: 'Grok', short: 'GK', bg: '#111111', icon: siGrok },
  exa: { label: 'Exa', short: 'EX', bg: '#1840ed', icon: siExa },
  deepseek: { label: 'DeepSeek', short: 'DS', bg: '#5786fe', icon: siDeepseek },
  google: { label: 'Google Search', short: 'G', bg: '#4285f4', icon: siGoogle },
  bing: { label: 'Microsoft Bing', short: 'B', bg: '#008373', icon: siMicrosoftbing }
};

export function getAiSurface(key: string | null): AiSurfaceInfo {
  const k = (key ?? '').toLowerCase();
  return AI_SURFACE_META[k] ?? { label: key ?? 'Unknown', short: (key ?? '?').slice(0, 2).toUpperCase(), bg: '#999' };
}

/** Favicon for a domain (sources list). */
export function domainFaviconUrl(domain: string, size = 64): string {
  const host = domain.replace(/^https?:\/\//, '').split('/')[0]?.trim() || domain;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/** Best-effort company favicon from a brand name (guesses name.com). */
export function brandFaviconUrl(name: string, size = 64): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(inc|llc|ltd|corp|co)$/g, '');
  if (!slug) return domainFaviconUrl('example.com', size);
  return domainFaviconUrl(`${slug}.com`, size);
}
