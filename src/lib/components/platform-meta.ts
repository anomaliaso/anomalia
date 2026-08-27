import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';

export interface PlatformInfo {
  label: string;
  short: string;
  bg: string;
  icon?: { path: string; hex: string };
}

export const PLATFORM_META: Record<string, PlatformInfo> = {
  instagram: { label: 'Instagram', short: 'IG', bg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)', icon: siInstagram },
  tiktok: { label: 'TikTok', short: 'TT', bg: '#111', icon: siTiktok },
  facebook: { label: 'Facebook', short: 'f', bg: '#1877f2', icon: siFacebook },
  linkedin: { label: 'LinkedIn', short: 'in', bg: '#0a66c2' },
  x: { label: 'X', short: 'X', bg: '#0a0a0a', icon: siX },
  threads: { label: 'Threads', short: '@', bg: '#000', icon: siThreads },
  youtube: { label: 'YouTube', short: 'YT', bg: '#ff0000', icon: siYoutube },
  bluesky: { label: 'Bluesky', short: 'BS', bg: '#0285ff', icon: siBluesky },
  reddit: { label: 'Reddit', short: 'RD', bg: '#ff4500', icon: siReddit }
};

// The platforms Anomalia operates on, in display order — the single source for every selection surface
// (onboarding, settings, studio). twitter is a legacy alias for x.
// YouTube is one channel: Shorts vs long-form is auto-detected by YouTube (≤3 min + 9:16 → Short).
export const PLATFORM_KEYS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'threads', 'youtube', 'bluesky', 'reddit'];

export function getPlatform(platform: string | null): PlatformInfo {
  const k = (platform ?? '').toLowerCase();
  return PLATFORM_META[k] ?? { label: platform ?? 'Unknown', short: (platform ?? '?').slice(0, 2).toUpperCase(), bg: '#999' };
}
