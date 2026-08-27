import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { peekFfmpegPath } from './ffmpeg-bin';

describe('peekFfmpegPath', () => {
  it('finds the local ffmpeg-static binary without importing the package', () => {
    const expected = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    if (!existsSync(expected)) return; // skip if npm install omitted the binary
    expect(peekFfmpegPath()).toBe(expected);
  });
});
