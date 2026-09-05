import { describe, it, expect, vi, beforeEach } from 'vitest';

const llmStructured = vi.fn();

vi.mock('$lib/server/llm', () => ({
  llmConfigured: () => true,
  llmStructured: (opts: unknown) => llmStructured(opts)
}));

import { writeCaptions } from './caption-writer';

const ALL = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'threads', 'youtube', 'bluesky', 'reddit'];

const answerFor = (platforms: string[], text: string) => ({
  captions: platforms.map((platform) => ({ platform, text }))
});

type CaptionsSchema = {
  properties: { captions: { items: { properties: { platform: { enum: string[] } } } } };
};

const platformsAskedFor = () => {
  const [{ schema }] = llmStructured.mock.calls[0] as [{ schema: CaptionsSchema }];
  return schema.properties.captions.items.properties.platform.enum;
};

beforeEach(() => {
  vi.clearAllMocks();
  llmStructured.mockResolvedValue(answerFor(ALL, 'a caption'));
});

describe('writeCaptions', () => {
  it('asks the model once for every platform, and returns one caption each', async () => {
    const out = await writeCaptions({ topic: 'a launch', platforms: ALL, format: 'single', voice: '' });

    expect(llmStructured).toHaveBeenCalledTimes(1);
    expect(out.map((c) => c.platform)).toEqual(ALL);
  });

  it('one platform is one platform: the other eight are never generated', async () => {
    llmStructured.mockResolvedValue(answerFor(['x'], 'just for X'));

    const out = await writeCaptions({ topic: 'a launch', platforms: ['x'], format: 'single', voice: '' });

    expect(llmStructured).toHaveBeenCalledTimes(1);
    expect(platformsAskedFor()).toEqual(['x']);
    expect(out).toHaveLength(1);
    expect(out[0].platform).toBe('x');
  });

  it('keeps a single post inside the limit and calls it publishable', async () => {
    llmStructured.mockResolvedValue(answerFor(['x'], 'z'.repeat(400)));

    const [caption] = await writeCaptions({ topic: 't', platforms: ['x'], format: 'single', voice: '' });

    expect(caption.parts).toHaveLength(1);
    expect(caption.parts[0].length).toBeLessThanOrEqual(280);
    expect(caption.limit).toBe(280);
    expect(caption.publishable).toBe(true);
  });

  it('splits X into a numbered sequence on format "thread", and says it is not publishable', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    llmStructured.mockResolvedValue(answerFor(['x'], long));

    const [caption] = await writeCaptions({ topic: 't', platforms: ['x'], format: 'thread', voice: '' });

    expect(caption.parts.length).toBeGreaterThan(1);
    for (const part of caption.parts) {
      expect(part.length).toBeLessThanOrEqual(280);
    }
    expect(caption.publishable).toBe(false);
  });

  it('does not split a caption that already fits, even on format "thread"', async () => {
    llmStructured.mockResolvedValue(answerFor(['x'], 'short enough for X'));

    const [caption] = await writeCaptions({ topic: 't', platforms: ['x'], format: 'thread', voice: '' });

    expect(caption.parts).toEqual(['short enough for X']);
    expect(caption.publishable).toBe(true);
  });

  it('never turns a long-form platform into a sequence', async () => {
    llmStructured.mockResolvedValue(answerFor(['linkedin'], 'z'.repeat(5000)));

    const [caption] = await writeCaptions({
      topic: 't',
      platforms: ['linkedin'],
      format: 'thread',
      voice: ''
    });

    expect(caption.parts).toHaveLength(1);
    expect(caption.publishable).toBe(true);
  });
});
