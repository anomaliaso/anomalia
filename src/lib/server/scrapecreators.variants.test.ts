import { describe, it, expect } from 'vitest';
import { bestTwitterVariant } from './scrapecreators';

// Shape measured on @uber: one HLS playlist with no bitrate, then four MP4 renditions.
const REAL = [
  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/p.m3u8' },
  { content_type: 'video/mp4', bitrate: 632000, url: 'https://video.twimg.com/320.mp4' },
  { content_type: 'video/mp4', bitrate: 950000, url: 'https://video.twimg.com/480.mp4' },
  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/720.mp4' },
  { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/master.mp4' }
];

describe('bestTwitterVariant', () => {
  it('takes the best delivery rendition, never the master', () => {
    // Everything downstream is downscaled to 360px — the 10Mbps source buys nothing and costs 5x.
    expect(bestTwitterVariant(REAL)).toBe('https://video.twimg.com/720.mp4');
  });

  it('never returns the HLS playlist', () => {
    // It is a manifest, not a file: the archiver would reject it as unsupported, which reads as
    // "this tweet had no video" — indistinguishable from the truth, and wrong.
    expect(bestTwitterVariant([REAL[0]])).toBeNull();
    expect(bestTwitterVariant(REAL)).not.toContain('.m3u8');
  });

  it('falls back to the smallest when every rendition is over the cap', () => {
    const huge = REAL.filter((v) => (v.bitrate ?? 0) > 3_000_000);
    expect(bestTwitterVariant(huge)).toBe('https://video.twimg.com/master.mp4');
  });

  it('handles a single rendition, a bitrate-less mp4, and junk', () => {
    expect(bestTwitterVariant([{ content_type: 'video/mp4', url: 'https://v/only.mp4' }])).toBe('https://v/only.mp4');
    expect(bestTwitterVariant([])).toBeNull();
    expect(bestTwitterVariant(null)).toBeNull();
    expect(bestTwitterVariant('nope')).toBeNull();
    expect(bestTwitterVariant([{ content_type: 'video/mp4' }])).toBeNull();
  });

  it('respects a caller-supplied cap', () => {
    expect(bestTwitterVariant(REAL, 1_000_000)).toBe('https://video.twimg.com/480.mp4');
  });
});
