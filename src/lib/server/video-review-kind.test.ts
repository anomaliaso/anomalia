import { describe, expect, it } from 'vitest';
import { shouldFetchAsVideo } from './video-review';

describe('shouldFetchAsVideo', () => {
  // The TikTok CDN, verbatim: no extension anywhere in the path or the query.
  const TIKTOK = 'https://v45.tiktokcdn-eu.com/327027fe/6a87291a/video/tos/no1a/tos-no1a-ve-4864/?a=1233&bti=x';

  it('trusts a caller that says it is a video, whatever the url looks like', () => {
    // This one line is what silently emptied the market video bank: 107 of 200 stored clip urls
    // carry no extension, so every one skipped the download, fell through to the stills path — which
    // cannot read a video url — and reported `media_extract_failed` about a file never opened.
    expect(shouldFetchAsVideo(TIKTOK, 'video')).toBe(true);
  });

  it('still recognises an obvious video url with no help from the caller', () => {
    expect(shouldFetchAsVideo('https://cdn/clip.mp4')).toBe(true);
    expect(shouldFetchAsVideo('https://cdn/clip.mov?sig=1')).toBe(true);
  });

  it('does not download an extensionless url nobody vouched for', () => {
    // Guessing in the other direction would spend bandwidth on every image and page we are handed.
    expect(shouldFetchAsVideo(TIKTOK)).toBe(false);
  });

  it('obeys a caller that says it is NOT a video, even when the url ends in .mp4', () => {
    expect(shouldFetchAsVideo('https://cdn/clip.mp4', 'image')).toBe(false);
    expect(shouldFetchAsVideo('https://cdn/clip.mp4', 'carousel')).toBe(false);
  });
});
