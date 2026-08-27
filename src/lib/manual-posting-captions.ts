import { PLATFORM_KEYS } from '$lib/components/platform-meta';
import { platformLimit, truncateForPlatform } from '$lib/platform-limits';

const KNOWN = new Set<string>(PLATFORM_KEYS);

export type GeneratedCaptions = {
  caption: string;
  captions: Record<string, string>;
  title?: string;
};

function capKey(p: string): string {
  const k = p.toLowerCase().trim();
  return k === 'twitter' ? 'x' : k;
}

export function normalizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const k = capKey(String(item ?? ''));
    if (!k || !KNOWN.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function clampCaption(text: string, platform: string): string {
  const limit = platformLimit(platform);
  const trimmed = text.trim();
  if (!limit || trimmed.length <= limit) return trimmed;
  return truncateForPlatform(trimmed, limit);
}

function pickMainCaption(parsed: Record<string, string>, platforms: string[]): string {
  const preferred = ['linkedin', 'instagram', 'facebook', 'tiktok', ...platforms];
  for (const p of preferred) {
    const t = (parsed[p] ?? '').trim();
    if (t) return t;
  }
  return (parsed.caption ?? '').trim();
}

export function clampGeneratedCaptions(
  parsed: Record<string, unknown>,
  platforms: string[]
): GeneratedCaptions {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string' && v.trim()) raw[capKey(k)] = v.trim();
  }
  const captions: Record<string, string> = {};
  for (const p of platforms) {
    const text = raw[p] || raw.caption || '';
    if (text) captions[p] = clampCaption(text, p);
  }
  const caption =
    pickMainCaption({ ...raw, ...captions }, platforms) ||
    clampCaption(raw.caption ?? '', platforms[0] ?? 'instagram');
  const title =
    typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 300) : undefined;
  return { caption, captions, title };
}
