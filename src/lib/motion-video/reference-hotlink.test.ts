import { describe, expect, it } from 'vitest';
import { referenceHotlink } from './source-ops';

const CLEAN = `<Img src="https://storage.googleapis.com/anomalia/render_1.png" />`;

describe('referenceHotlink', () => {
  it('catches the plausible reference path a model writes from the pattern', () => {
    expect(
      referenceHotlink(
        `<Img src="https://posts.design/media/posts/x-twitter-cerebras-2089-clip.webp" />`
      )
    ).toBe('https://posts.design/media/posts/x-twitter-cerebras-2089-clip.webp');
  });

  it('catches it without a scheme, and on a subdomain', () => {
    expect(referenceHotlink(`src="posts.design/images/posts/a.webp"`)).toContain('posts.design');
    expect(referenceHotlink(`src="https://cdn.posts.design/a.webp"`)).toContain('posts.design');
  });

  it('is null for a composition that only uses our own assets', () => {
    expect(referenceHotlink(CLEAN)).toBeNull();
  });
});
