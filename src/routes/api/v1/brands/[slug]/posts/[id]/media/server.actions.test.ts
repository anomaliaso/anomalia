import { beforeEach, describe, expect, it, vi } from 'vitest';

const regeneratePostImage = vi.fn(async () => ({ success: true }));
const editCarouselSlide = vi.fn(async () => ({ success: true }));
const restructureCarouselSlides = vi.fn(async () => ({ success: true }));
const renderPostVideo = vi.fn(async () => ({ success: true }));

vi.mock('$lib/server/post-media', () => ({
  postMediaTarget: async () => ({ t: {}, brand: { id: 'brand-1' }, apiKey: undefined })
}));
vi.mock('$lib/server/cli-auth', () => ({ gateAiAction: async () => undefined }));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: (_id: string, fn: () => Promise<Response>) => fn()
}));
vi.mock('$lib/agent/tools/post-editor-tools', () => ({
  regeneratePostImage: (...a: unknown[]) => regeneratePostImage(...(a as [])),
  editCarouselSlide: (...a: unknown[]) => editCarouselSlide(...(a as [])),
  restructureCarouselSlides: (...a: unknown[]) => restructureCarouselSlides(...(a as [])),
  renderPostVideo: (...a: unknown[]) => renderPostVideo(...(a as [])),
  readPostState: async () => ({}),
  isAspectRatio: (v: string) => ['9:16', '1:1', '16:9', '4:3', '3:4', '21:9'].includes(v)
}));

import { POST as dispatch } from './+server';
import { POST as order } from './order/+server';
import { POST as regenerate } from './regenerate/+server';
import { POST as slide } from './slide/+server';
import { POST as video } from './video/+server';

const call = (handler: unknown, body: Record<string, unknown>): Promise<Response> =>
  (handler as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/posts/p1/media', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo', id: 'p1' }
  });

beforeEach(() => vi.clearAllMocks());

describe('ogni azione sui media ha la sua rotta', () => {
  it('la rotta fa una cosa sola, e la fa senza leggere nessun `action`', async () => {
    expect((await call(regenerate, { instruction: 'più luce' })).status).toBe(200);
    expect(regeneratePostImage).toHaveBeenCalledTimes(1);

    expect((await call(slide, { index: 1, instruction: 'x' })).status).toBe(200);
    expect(editCarouselSlide.mock.calls[0]?.[1]).toEqual({
      slide_index: 1,
      instruction: 'x',
      new_prompt: undefined
    });

    expect((await call(order, { order: [0, 2, 1] })).status).toBe(200);
    expect(restructureCarouselSlides.mock.calls[0]?.[1]).toEqual({ order: [0, 2, 1] });

    expect((await call(video, { duration: 6 })).status).toBe(200);
    expect(renderPostVideo).toHaveBeenCalledTimes(1);
  });

  it('quello che ciascuna esige lo esige da sola', async () => {
    expect((await call(regenerate, {})).status).toBe(400);
    expect((await call(slide, { instruction: 'x' })).status).toBe(400);
    expect((await call(order, { order: [] })).status).toBe(400);
    expect((await call(video, { aspectRatio: '5:5' })).status).toBe(400);
  });
});

/**
 * Il contratto fra i chiamanti e la vecchia rotta è una stringa, e una stringa nessun compilatore
 * la controlla: `reorder_slides` mandava `action: 'reorder'` e prendeva 400 da sempre. Ora che
 * ogni azione ha la sua rotta, la vecchia resta solo per chi la chiamava: deve continuare a
 * inoltrare ognuna delle quattro, e a dire chiaramente di no a una che non esiste.
 */
describe('la rotta `action` resta, e non fa altro che inoltrare', () => {
  const FORWARDS = [
    { action: 'regenerate', body: { instruction: 'più luce' }, hit: regeneratePostImage },
    { action: 'slide', body: { index: 0, instruction: 'x' }, hit: editCarouselSlide },
    { action: 'restructure', body: { order: [1, 0] }, hit: restructureCarouselSlides },
    { action: 'video', body: { duration: 6 }, hit: renderPostVideo }
  ];

  it('ognuna delle quattro arriva dove arrivava prima', async () => {
    for (const { action, body, hit } of FORWARDS) {
      vi.clearAllMocks();
      const res = await call(dispatch, { action, ...body });

      expect(res.status, action).toBe(200);
      expect(hit, action).toHaveBeenCalledTimes(1);
    }
  });

  it('un’azione che non esiste resta un 400, non un silenzio', async () => {
    const res = await call(dispatch, { action: 'reorder', order: [1, 0] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown action: reorder' });
    expect(restructureCarouselSlides).not.toHaveBeenCalled();
  });
});
