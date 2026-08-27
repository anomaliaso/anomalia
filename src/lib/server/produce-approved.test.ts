import { describe, expect, it } from 'vitest';
import { isProduceApproved, markProduceApproved, type PreviewPost } from './content-preview';

describe('isProduceApproved', () => {
  it('is false for a plain post array', () => {
    const posts = [{ platform: 'instagram', caption: 'hi' }] as PreviewPost[];
    expect(isProduceApproved(posts)).toBe(false);
  });

  it('survives rebuilding a produced[] via onPost-style push of the same post refs', () => {
    const posts = [
      { platform: 'instagram', caption: 'a' },
      { platform: 'linkedin', caption: 'b' }
    ] as PreviewPost[];
    markProduceApproved(posts, true);
    expect(isProduceApproved(posts)).toBe(true);

    // Scheduler / generatePreview rebuild: only push post objects into a new array.
    const produced: PreviewPost[] = [];
    for (const p of posts) produced.push(p);
    expect(isProduceApproved(produced)).toBe(true);
  });

  it('is false when produce did not approve', () => {
    const posts = [{ platform: 'instagram', caption: 'hi' }] as PreviewPost[];
    markProduceApproved(posts, false);
    const produced = [...posts];
    expect(isProduceApproved(produced)).toBe(false);
  });
});
